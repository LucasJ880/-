/**
 * GET /api/cron/agent-runs
 * 消费后台 AgentRun 队列（Bearer CRON_SECRET）
 * Phase 2A：同一 cron 内分流消费 workforce_job durable 队列（改动最小方案）
 */

import { NextRequest, NextResponse, after } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { processQueuedAgentRuns } from "@/lib/agent-runtime/queue";
import { processQueuedWorkforceJobs } from "@/lib/workforce-runtime/processor";
import {
  AGENT_RUNS_INVOCATION_BUDGET_MS,
  WORKFORCE_CONTINUATION_MAX_DEPTH,
} from "@/lib/workforce-runtime/constants";
import {
  shouldFireContinuationTrigger,
  fireContinuationTrigger,
} from "@/lib/workforce-runtime/self-trigger";

/**
 * T5-P1.1 §3：60s 不足以容纳一次 Analyst 长调用（真实 t3 实测 126–507s）。
 * 提到 300s（与 #113 的 Tender cron 同一安全模型），但**这不是新的 one-shot 上限**——
 * 长任务仍必须可续跑；300s 只保证单个安全切片里塞得下一次完整模型调用。
 */
// 注意：Next.js 的 route segment config 必须是**静态字面量**，
// 不能写成导入常量（否则 build 期 "Invalid segment configuration export"）。
// 与 AGENT_RUNS_MAX_DURATION_S 的一致性由 P11-BUDGET-01 断言守住。
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  // §4：绝对 deadline 必须从 **HTTP invocation 开始**算起，
  // 否则前面 processQueuedAgentRuns 的耗时不会计入 serverless 总预算。
  const requestStartedAt = Date.now();
  const executionBudget = {
    deadlineAt: requestStartedAt + AGENT_RUNS_INVOCATION_BUDGET_MS,
    tickBudgetMs: AGENT_RUNS_INVOCATION_BUDGET_MS,
  };

  // 观察期包1：continuation = 让出链式自触发的 child invocation。
  // 跳过 legacy processQueuedAgentRuns（消除实测 ~48s 前置偏移），直奔
  // workforce 队列。depth 随链递增，防御性 clamp 到硬上限。
  const params = request.nextUrl.searchParams;
  const isContinuation = params.get("trigger") === "continuation";
  const depthRaw = Number.parseInt(params.get("depth") ?? "0", 10);
  const depth =
    Number.isInteger(depthRaw) && depthRaw > 0
      ? Math.min(depthRaw, WORKFORCE_CONTINUATION_MAX_DEPTH)
      : 0;

  const data = await runTrackedAutomation("agent-runs", async () => {
    const result = isContinuation
      ? { processed: 0, runIds: [] as string[] }
      : await processQueuedAgentRuns(2);
    const workforce = await processQueuedWorkforceJobs(2, { executionBudget });

    // 包1：本批有让出 → after() 在响应发出后 fire-and-forget 自触发下一
    // tick（不占本 invocation 的处理预算，也绝不等 child 的完整响应）。
    // 防风暴五层见 self-trigger.ts 头注释；env 未配置默认 OFF。
    if (
      shouldFireContinuationTrigger({
        yieldedContinuations: workforce.yieldedContinuations,
        depth,
      })
    ) {
      after(() => fireContinuationTrigger({ depth }));
    }

    return {
      data: { ...result, workforce },
      processedCount: result.processed + workforce.processed,
      succeededCount: result.processed + workforce.processed,
      failedCount: 0,
      metadata: {
        runIds: result.runIds,
        workforceRunIds: workforce.runIds,
        workforceExhaustedFailed: workforce.exhaustedFailed,
        trigger: isContinuation ? "continuation" : "schedule",
        depth,
        workforceYieldedContinuations: workforce.yieldedContinuations,
      },
    };
  });

  return NextResponse.json({ ok: true, ...data });
}
