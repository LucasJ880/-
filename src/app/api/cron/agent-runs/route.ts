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

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("agent-runs", async () => {
    const result = await processQueuedAgentRuns(2);
    const workforce = await processQueuedWorkforceJobs(2);
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
