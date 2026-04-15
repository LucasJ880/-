import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listGoogleCalendars } from "@/lib/google-calendar";
import { withAuth } from "@/lib/common/api-helpers";

/**
 * GET  — 获取用户所有 Google 日历列表（含共享日历）
 * POST — 保存用户选择的日历 ID
 */

export const GET = withAuth(async (request, ctx, user) => {
  const calendars = await listGoogleCalendars(user.id);

  const provider = await db.calendarProvider.findFirst({
    where: { userId: user.id, type: "google", enabled: true },
    select: { calendarId: true },
  });

  const selectedIds = (provider?.calendarId || "primary")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = calendars.map((c) => ({
    ...c,
    selected: selectedIds.includes(c.id),
  }));

  return NextResponse.json({ calendars: result, selectedIds });
});

export const POST = withAuth(async (request, ctx, user) => {
  const body = await request.json();
  const { calendarIds } = body as { calendarIds: string[] };

  if (!calendarIds || !Array.isArray(calendarIds) || calendarIds.length === 0) {
    return NextResponse.json({ error: "请至少选择一个日历" }, { status: 400 });
  }

  const provider = await db.calendarProvider.findFirst({
    where: { userId: user.id, type: "google", enabled: true },
  });

  if (!provider) {
    return NextResponse.json({ error: "请先连接 Google Calendar" }, { status: 400 });
  }

  await db.calendarProvider.update({
    where: { id: provider.id },
    data: { calendarId: calendarIds.join(",") },
  });

  return NextResponse.json({ ok: true, selectedIds: calendarIds });
});
