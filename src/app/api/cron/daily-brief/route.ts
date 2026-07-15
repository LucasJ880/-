/**
 * GET /api/cron/daily-brief
 *
 * 每日主动简报 Cron：
 * 为所有活跃组织的成员生成当日简报 →
 * 写入 Notification + 置顶「每日简报」对话线程 + 微信推送（既有链路）。
 *
 * 调度：每小时唤醒，仅在多伦多当地 07:00 执行。
 */

import { NextRequest, NextResponse } from "next/server";
import { AUTOMATION_TIMEZONE } from "@/lib/automation/registry";
import { isLocalScheduleHour } from "@/lib/automation/local-time";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import { generateBriefingsForOrg } from "@/lib/secretary/briefing";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  if (!isLocalScheduleHour(now, AUTOMATION_TIMEZONE, [7])) {
    return NextResponse.json({ skipped: true, reason: "尚未到当地 07:00", checkedAt: now.toISOString() });
  }

  const data = await runTrackedAutomation("daily-brief", async () => {
    const orgs = await db.organization.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
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

    const failedCount = results.filter((result) => result.error).length;
    return {
      data: { generatedAt: new Date().toISOString(), orgs: results },
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
    };
  });
  return NextResponse.json(data);
}
