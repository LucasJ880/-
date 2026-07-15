/**
 * POST /api/trade/cron
 *
 * 每日定时任务入口（跟进提醒、报价过期、无回复检测、页面监控等）。
 * 必须通过 CRON_SECRET + Authorization: Bearer，禁止无密钥或仅靠用户角色触发。
 */

import { NextRequest, NextResponse } from "next/server";
import { runDailyCron } from "@/lib/trade/cron-jobs";
import { requireTradeCronSecret } from "@/lib/trade/access";
import { AUTOMATION_TIMEZONE } from "@/lib/automation/registry";
import { isLocalScheduleHour } from "@/lib/automation/local-time";
import { runTrackedAutomation } from "@/lib/automation/runner";

export async function POST(request: NextRequest) {
  const denied = requireTradeCronSecret(request);
  if (denied) return denied;

  const now = new Date();
  if (!isLocalScheduleHour(now, AUTOMATION_TIMEZONE, [8])) {
    return NextResponse.json({ skipped: true, reason: "尚未到当地 08:00", checkedAt: now.toISOString() });
  }
  const result = await runTrackedAutomation("trade-daily", async () => {
    const outcome = await runDailyCron();
    const processedCount = outcome.overdueFollowUps + outcome.expiredQuotes + outcome.noResponseProspects + outcome.watchChecked;
    return { data: outcome, processedCount, succeededCount: processedCount };
  });
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return POST(request);
}
