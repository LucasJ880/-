/**
 * GET /api/cron/followup
 *
 * 每小时唤醒，仅在多伦多当地 09:00 和 14:00 执行。
 * 扫描外贸客户时间线，自动生成跟进建议并推送通知。
 *
 * 鉴权方式：Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { AUTOMATION_TIMEZONE } from "@/lib/automation/registry";
import { isLocalScheduleHour } from "@/lib/automation/local-time";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import { runFollowupEngine } from "@/lib/secretary/followup-engine";

export const maxDuration = 60;

interface FollowupCronResponse {
  scannedAt: string;
  orgs: Array<Record<string, string | number>>;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  if (!isLocalScheduleHour(now, AUTOMATION_TIMEZONE, [9, 14])) {
    return NextResponse.json({ skipped: true, reason: "尚未到当地跟进时段", checkedAt: now.toISOString() });
  }

  const data = await runTrackedAutomation<FollowupCronResponse>("trade-followup", async () => {
    const orgs = await db.organization.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
    });

    if (orgs.length === 0) {
      return { data: { scannedAt: new Date().toISOString(), orgs: [] }, status: "skipped" };
    }

    const results: Array<Record<string, string | number>> = [];
    for (const org of orgs) {
      try {
        const result = await runFollowupEngine(org.id);
        results.push({
          orgId: org.id,
          orgName: org.name,
          candidates: result.candidates.length,
          suggestions: result.suggestions.length,
          notifications: result.notificationsCreated,
        });
      } catch (e) {
        console.error(`[cron/followup] Failed for org ${org.name}:`, e);
        results.push({ orgId: org.id, orgName: org.name, error: String(e) });
      }
    }

    const failedCount = results.filter((result) => "error" in result).length;
    return {
      data: { scannedAt: new Date().toISOString(), orgs: results },
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
    };
  });
  return NextResponse.json(data);
}
