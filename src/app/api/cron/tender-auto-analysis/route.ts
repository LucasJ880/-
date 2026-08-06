/**
 * GET /api/cron/tender-auto-analysis
 * 消费 TenderAnalysisRun 队列（Bearer CRON_SECRET）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { processQueuedTenderAnalysisRuns } from "@/lib/tender-auto-analysis/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const result = await runTrackedAutomation("tender-auto-analysis", async () => {
    const outcome = await processQueuedTenderAnalysisRuns(2);
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
