import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { sweepTenderWatches } from "@/lib/tender-intel/watch";

/** 公告盯梢 cron（每小时）：Addenda/Q&A 变更 → 站内通知（sourceKey 幂等） */
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const data = await runTrackedAutomation("tender-watch", async () => {
    const result = await sweepTenderWatches();
    return {
      data: result,
      processedCount: result.checked,
      succeededCount: result.checked,
      failedCount: 0,
      metadata: result,
    };
  });
  return NextResponse.json({ ok: true, ...data });
}
