import { NextRequest, NextResponse } from "next/server";
import { processQueuedMarketAnalyses } from "@/lib/market-intelligence/service";
import { processQueuedMarketResearchRuns } from "@/lib/market-intelligence/research-runtime";
import { runTrackedAutomation } from "@/lib/automation/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runTrackedAutomation("market-intelligence", async () => {
    const manualRuns = await processQueuedMarketResearchRuns(1);
    const outcome = manualRuns.length > 0
      ? {
        attempted: manualRuns.length,
        completed: manualRuns.filter((run) => run?.status === "completed").length,
        failed: manualRuns.filter((run) => run?.status === "failed").length,
      }
      : await processQueuedMarketAnalyses(1);
    return {
      data: outcome,
      processedCount: outcome.attempted,
      succeededCount: outcome.completed,
      failedCount: outcome.failed,
    };
  });
  return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
}
