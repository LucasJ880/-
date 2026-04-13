/**
 * GET /api/cron/wechat-push
 *
 * 微信批量推送 Cron — 兜底机制
 *
 * 正常流程中，简报/跟进/周报生成后会自动触发推送。
 * 此 Cron 作为兜底，确保当天的简报和跟进提醒都已推送。
 *
 * 建议调度：每日 09:30（简报生成后 30 分钟）
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  pushBriefingToAllUsers,
  pushFollowupsToAllUsers,
} from "@/lib/messaging/push-service";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgs = await db.organization.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    take: 20,
  });

  const results = [];

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
      results.push({
        orgId: org.id,
        orgName: org.name,
        error: String(e),
      });
    }
  }

  return NextResponse.json({
    pushedAt: new Date().toISOString(),
    orgs: results,
  });
}
