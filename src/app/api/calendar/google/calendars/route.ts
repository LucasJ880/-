import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  listGoogleCalendars,
  GoogleTokenExpiredError,
} from "@/lib/google-calendar";
import { withAuth } from "@/lib/common/api-helpers";

/**
 * GET  — 获取用户所有 Google 日历列表（含共享日历）
 * POST — 保存用户选择的日历 ID
 */

export const GET = withAuth(async (request, ctx, user) => {
  try {
    const calendars = await listGoogleCalendars(user.id);

    const provider = await db.calendarProvider.findFirst({
      where: { userId: user.id, type: "google", enabled: true },
      select: { calendarId: true },
    });

    const rawIds = (provider?.calendarId || "primary")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Google calendarList 里 primary 日历的 id 是邮箱而不是字面量 "primary"，
    // 存储层遗留的 "primary" 别名在此展开为真实 id，否则前端 UI 会匹配不上
    // 导致显示"未选择日历"但后端实际又用 "primary" 别名正常拉数据，用户困惑。
    const primaryCal = calendars.find((c) => c.primary);
    const selectedIds = rawIds.map((id) =>
      id === "primary" && primaryCal ? primaryCal.id : id,
    );

    const result = calendars.map((c) => ({
      ...c,
      selected: selectedIds.includes(c.id),
    }));

    return NextResponse.json({ calendars: result, selectedIds });
  } catch (err) {
    if (err instanceof GoogleTokenExpiredError) {
      return NextResponse.json({ error: "token_expired" }, { status: 401 });
    }
    throw err;
  }
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
