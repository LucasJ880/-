/**
 * GET /api/cron/agent-runs
 * 消费后台 AgentRun 队列（Bearer CRON_SECRET）
 * Phase 2A：同一 cron 内分流消费 workforce_job durable 队列（改动最小方案）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { processQueuedAgentRuns } from "@/lib/agent-runtime/queue";
import { processQueuedWorkforceJobs } from "@/lib/workforce-runtime/processor";
import { AGENT_RUNS_INVOCATION_BUDGET_MS } from "@/lib/workforce-runtime/constants";

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

  const data = await runTrackedAutomation("agent-runs", async () => {
    const result = await processQueuedAgentRuns(2);
    const workforce = await processQueuedWorkforceJobs(2, { executionBudget });
    return {
      data: { ...result, workforce },
      processedCount: result.processed + workforce.processed,
      succeededCount: result.processed + workforce.processed,
      failedCount: 0,
      metadata: {
        runIds: result.runIds,
        workforceRunIds: workforce.runIds,
        workforceExhaustedFailed: workforce.exhaustedFailed,
      },
    };
  });

  return NextResponse.json({ ok: true, ...data });
}
