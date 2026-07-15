import { NextRequest, NextResponse } from "next/server";
import { processQueuedMarketAnalyses } from "@/lib/market-intelligence/service";
import { runTrackedAutomation } from "@/lib/automation/runner";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runTrackedAutomation("market-intelligence", async () => {
    const outcome = await processQueuedMarketAnalyses(3);
    return {
      data: outcome,
      processedCount: outcome.attempted,
      succeededCount: outcome.completed,
      failedCount: outcome.failed,
    };
  });
  return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
}
