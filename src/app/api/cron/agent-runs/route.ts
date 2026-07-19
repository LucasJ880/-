/**
 * GET /api/cron/agent-runs
 * 消费后台 AgentRun 队列（Bearer CRON_SECRET）
 */

import { NextRequest, NextResponse } from "next/server";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { processQueuedAgentRuns } from "@/lib/agent-runtime/queue";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await runTrackedAutomation("agent-runs", async () => {
    const result = await processQueuedAgentRuns(2);
    return {
      data: result,
      processedCount: result.processed,
      succeededCount: result.processed,
      failedCount: 0,
      metadata: { runIds: result.runIds },
    };
  });

  return NextResponse.json({ ok: true, ...data });
}
