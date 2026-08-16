/**
 * GET /api/cron/tender-auto-analysis
 * 消费 TenderAnalysisRun 队列（Bearer CRON_SECRET）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import {
  INVOCATION_BUDGET_MS,
  processQueuedTenderAnalysisRuns,
} from "@/lib/tender-auto-analysis/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  // 硬截止显式从本次请求起算：worker 内部按它分片推进并落检查点，
  // 保证函数在 maxDuration 之前自己收工（被平台硬杀 = 本 tick 成果全丢）。
  const deadlineAt = Date.now() + INVOCATION_BUDGET_MS;

  const result = await runTrackedAutomation("tender-auto-analysis", async () => {
    const outcome = await processQueuedTenderAnalysisRuns(2, {
      deadlineAt,
      tickBudgetMs: INVOCATION_BUDGET_MS,
    });
    return {
      data: outcome,
      processedCount: outcome.processed,
      succeededCount: outcome.succeeded,
      failedCount: outcome.failed,
      metadata: { runIds: outcome.runIds },
    };
  });

  return NextResponse.json({
    ok: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}
