/**
 * POST /api/trade/cron
 *
 * 每日定时任务入口（跟进提醒、报价过期、无回复检测、页面监控等）。
 * 每小时唤醒，只处理当地时间 08:00 的组织（组织时区 settingsJson.timezone，默认多伦多）。
 * 必须通过 CRON_SECRET + Authorization: Bearer，禁止无密钥或仅靠用户角色触发。
 */

import { NextRequest, NextResponse } from "next/server";
import { runDailyCron } from "@/lib/trade/cron-jobs";
import { requireTradeCronSecret } from "@/lib/trade/access";
import { orgsAtLocalHour } from "@/lib/automation/registry";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const denied = requireTradeCronSecret(request);
  if (denied) return denied;

  const now = new Date();
  const orgs = orgsAtLocalHour(
    await db.organization.findMany({
      where: { status: "active" },
      select: { id: true, settingsJson: true },
    }),
    now,
    [8],
  );
  if (orgs.length === 0) {
    return NextResponse.json({ skipped: true, reason: "没有组织处于当地 08:00", checkedAt: now.toISOString() });
  }
  const result = await runTrackedAutomation("trade-daily", async () => {
    const outcome = await runDailyCron({ orgIds: orgs.map((org) => org.id) });
    const processedCount = outcome.overdueFollowUps + outcome.expiredQuotes + outcome.noResponseProspects + outcome.watchChecked;
    return { data: outcome, processedCount, succeededCount: processedCount };
  });
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return POST(request);
}
