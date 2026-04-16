/**
 * GET /api/cron/followup
 *
 * Vercel Cron 定时调用（建议每日 2 次：早 9 点 + 下午 2 点）
 * 扫描外贸客户时间线，自动生成跟进建议并推送通知。
 *
 * 鉴权方式：Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runFollowupEngine } from "@/lib/secretary/followup-engine";

export const maxDuration = 60;

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

  if (orgs.length === 0) {
    // 没有组织时也支持 default orgId
    const result = await runFollowupEngine("default");
    return NextResponse.json({
      scannedAt: result.scannedAt,
      orgs: [{ orgId: "default", candidates: result.candidates.length, notifications: result.notificationsCreated }],
    });
  }

  const results = [];
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

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    orgs: results,
  });
}
