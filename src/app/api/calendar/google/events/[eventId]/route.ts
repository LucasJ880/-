import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  updateGoogleEvent,
  deleteGoogleEvent,
  GoogleTokenExpiredError,
} from "@/lib/google-calendar";

/**
 * PATCH /api/calendar/google/events/[eventId]
 *   body: { calendarId?: string; scope?: "single"|"series"; data: {...} }
 *
 * DELETE /api/calendar/google/events/[eventId]?calendarId=...&scope=...
 */

function parseScope(raw: unknown): "single" | "series" {
  return raw === "series" ? "series" : "single";
}

export const PATCH = withAuth(async (request, ctx, user) => {
  const { eventId } = await ctx.params;
  if (!eventId) {
    return NextResponse.json({ error: "缺少 eventId" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    calendarId?: string;
    scope?: string;
    data?: {
      title?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      location?: string | null;
      description?: string | null;
    };
  } | null;

  if (!body || !body.data || !body.data.title || !body.data.startTime || !body.data.endTime) {
    return NextResponse.json({ error: "缺少必要字段（title/startTime/endTime）" }, { status: 400 });
  }

  try {
    const { ok, error } = await updateGoogleEvent(user.id, {
      eventId,
      calendarId: body.calendarId,
      scope: parseScope(body.scope),
      data: {
        title: body.data.title,
        startTime: body.data.startTime,
        endTime: body.data.endTime,
        allDay: Boolean(body.data.allDay),
        location: body.data.location ?? null,
        description: body.data.description ?? null,
      },
    });

    if (!ok) {
      return NextResponse.json({ error: error || "更新失败" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GoogleTokenExpiredError) {
      return NextResponse.json({ error: "token_expired" }, { status: 401 });
    }
    throw err;
  }
});

export const DELETE = withAuth(async (request, ctx, user) => {
  const { eventId } = await ctx.params;
  if (!eventId) {
    return NextResponse.json({ error: "缺少 eventId" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const calendarId = searchParams.get("calendarId") || undefined;
  const scope = parseScope(searchParams.get("scope"));

  try {
    const { ok, error } = await deleteGoogleEvent(user.id, {
      eventId,
      calendarId,
      scope,
    });
    if (!ok) {
      return NextResponse.json({ error: error || "删除失败" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GoogleTokenExpiredError) {
      return NextResponse.json({ error: "token_expired" }, { status: 401 });
    }
    throw err;
  }
});
