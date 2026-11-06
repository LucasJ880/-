import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { sweepTenderWatches } from "@/lib/tender-intel/watch";
import { processProcurementScans } from "@/lib/procurement-records/scan-run";

/**
 * 公告盯梢 cron（每小时）：Addenda/Q&A 变更 → 站内通知（sourceKey 幂等）
 * PROC-1：第二步「采购监控」——按多伦多本地排程建到期运行并执行（暗合并闸关时跳过；不新建 cron）。
 */
export const maxDuration = 300;

/** 采购监控步骤的墙钟预算（与盯梢步骤共享 300 秒） */
const PROCUREMENT_STEP_BUDGET_MS = 150_000;

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
  const procurement = await runTrackedAutomation("procurement-watch", async () => {
    const result = await processProcurementScans({ deadline: new Date(Date.now() + PROCUREMENT_STEP_BUDGET_MS) });
    if (result.skipped) {
      return { data: result, status: "skipped" as const, processedCount: 0, succeededCount: 0, failedCount: 0, metadata: { skipped: result.skipped } };
    }
    return {
      data: result,
      processedCount: result.processed,
      succeededCount: result.finished + result.yielded,
      failedCount: result.failed,
      metadata: result,
    };
  });
  return NextResponse.json({ ok: true, ...data, procurement });
}
