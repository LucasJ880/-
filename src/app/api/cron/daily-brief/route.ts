/**
 * GET /api/cron/daily-brief
 *
 * 每日主动简报 Cron：
 * 为所有活跃组织的成员生成当日简报 →
 * 写入 Notification + 置顶「每日简报」对话线程 + 微信推送（既有链路）。
 *
 * 调度：每日 11:00 UTC（多伦多早上 7 点左右）
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateBriefingsForOrg } from "@/lib/secretary/briefing";

export const maxDuration = 300;

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

  const results: Array<{ orgId: string; orgName: string; generated?: number; error?: string }> = [];

  for (const org of orgs) {
    try {
      const count = await generateBriefingsForOrg(org.id);
      results.push({ orgId: org.id, orgName: org.name, generated: count });
    } catch (e) {
      console.error(`[cron/daily-brief] Failed for org ${org.name}:`, e);
      results.push({ orgId: org.id, orgName: org.name, error: String(e) });
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    orgs: results,
  });
}
