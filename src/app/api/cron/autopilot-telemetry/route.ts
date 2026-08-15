/**
 * GET /api/cron/autopilot-telemetry
 * Drain Autopilot durable outbox（Bearer CRON_SECRET）。
 * Processor flag 默认 OFF：直接 skipped，不访问 Outbox 表。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { processAutopilotTelemetryOutbox } from "@/lib/autopilot/processor";
import { AUTOPILOT_OUTBOX_BATCH_LIMIT } from "@/lib/autopilot/outbox";

export const maxDuration = 60;

const MAX_LIMIT = 50;

function parseLimit(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("limit");
  if (!raw) return AUTOPILOT_OUTBOX_BATCH_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return AUTOPILOT_OUTBOX_BATCH_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const limit = parseLimit(request);
  const data = await runTrackedAutomation("autopilot-telemetry", async () => {
    const result = await processAutopilotTelemetryOutbox({ limit });
    return {
      data: result,
      processedCount: result.processed,
      succeededCount: result.processed,
      failedCount: result.dead + result.lost,
      metadata: {
        skipped: result.skipped,
        claimed: result.claimed,
        retried: result.retried,
        limit,
      },
    };
  });

  return NextResponse.json({ ok: true, ...data });
}
