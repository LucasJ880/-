/**
 * AI 秘书每日简报 API
 *
 * GET  — 获取当日简报（从 Notification 读取）
 * POST — 触发生成简报（手动 or Cron）
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateDailyBriefing, generateBriefingsForOrg } from "@/lib/secretary/briefing";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const sourceKey = `daily_briefing:${user.id}:${today}`;

  const notification = await db.notification.findUnique({
    where: { sourceKey },
  });

  if (!notification) {
    return NextResponse.json({ briefing: null, message: "今日简报尚未生成" });
  }

  let metadata = null;
  try {
    metadata = notification.metadata ? JSON.parse(notification.metadata) : null;
  } catch { /* ignore */ }

  return NextResponse.json({
    briefing: {
      id: notification.id,
      title: notification.title,
      summary: notification.summary,
      priority: notification.priority,
      status: notification.status,
      createdAt: notification.createdAt.toISOString(),
      ...(metadata ?? {}),
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const orgId = body.orgId ?? "default";

  if (body.action === "cron_all") {
    if (user.role !== "super_admin" && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const count = await generateBriefingsForOrg(orgId);
    return NextResponse.json({ success: true, usersNotified: count });
  }

  const briefing = await generateDailyBriefing(user.id, orgId);

  return NextResponse.json({
    success: true,
    briefing: {
      summary: briefing.summary,
      totalUrgent: briefing.totalUrgent,
      totalWarning: briefing.totalWarning,
      totalItems: briefing.totalItems,
      domains: briefing.domains.map((d) => ({
        domain: d.domain,
        itemCount: d.items.length,
        stats: d.stats,
      })),
      items: briefing.domains.flatMap((d) => d.items).slice(0, 20),
    },
  });
}
