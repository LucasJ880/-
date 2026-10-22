/**
 * GET /api/cron/followup
 *
 * 每小时唤醒，只处理当地时间 09:00 和 14:00 的组织（组织时区 settingsJson.timezone，默认多伦多）。
 * 扫描外贸客户时间线，自动生成跟进建议并推送通知。
 *
 * 鉴权方式：Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { orgsAtLocalHour } from "@/lib/automation/registry";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import { runFollowupEngine } from "@/lib/secretary/followup-engine";

export const maxDuration = 60;

interface FollowupCronResponse {
  scannedAt: string;
  orgs: Array<Record<string, string | number>>;
}

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const now = new Date();
  const orgs = orgsAtLocalHour(
    await db.organization.findMany({
      where: { status: "active" },
      select: { id: true, name: true, settingsJson: true },
    }),
    now,
    [9, 14],
  );
  if (orgs.length === 0) {
    return NextResponse.json({ skipped: true, reason: "没有组织处于当地跟进时段", checkedAt: now.toISOString() });
  }

  const data = await runTrackedAutomation<FollowupCronResponse>("trade-followup", async () => {
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
