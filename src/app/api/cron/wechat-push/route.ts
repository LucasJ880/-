/**
 * GET /api/cron/wechat-push
 *
 * 微信批量推送 Cron — 兜底机制
 *
 * 正常流程中，简报/跟进/周报生成后会自动触发推送。
 * 此 Cron 作为兜底，确保当天的简报和跟进提醒都已推送。
 *
 * 每小时的 30 分唤醒，仅在多伦多当地 07:30 执行。
 */

import { NextRequest, NextResponse } from "next/server";
import { AUTOMATION_TIMEZONE } from "@/lib/automation/registry";
import { getLocalTimeParts } from "@/lib/automation/local-time";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import {
  pushBriefingToAllUsers,
  pushFollowupsToAllUsers,
} from "@/lib/messaging/push-service";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  if (getLocalTimeParts(now, AUTOMATION_TIMEZONE).hour !== 7) {
    return NextResponse.json({ skipped: true, reason: "尚未到当地 07:30", checkedAt: now.toISOString() });
  }

  const data = await runTrackedAutomation("wechat-push", async () => {
    const orgs = await db.organization.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
    });

    const results: Array<Record<string, unknown>> = [];

    for (const org of orgs) {
      try {
        const briefingResult = await pushBriefingToAllUsers(org.id);
        const followupResult = await pushFollowupsToAllUsers(org.id);

        results.push({
          orgId: org.id,
          orgName: org.name,
          briefing: briefingResult,
          followup: followupResult,
        });
      } catch (e) {
        console.error(`[cron/wechat-push] Failed for org ${org.name}:`, e);
        results.push({ orgId: org.id, orgName: org.name, error: String(e) });
      }
    }

    const failedCount = results.filter((result) => "error" in result).length;
    return {
      data: { pushedAt: new Date().toISOString(), orgs: results },
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
    };
  });
  return NextResponse.json(data);
}
