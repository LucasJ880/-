import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";

/** 日程归属校验：仅本人的日程可改/删，其他一律 404（不暴露存在性） */
async function requireOwnEvent(
  request: NextRequest,
  eventId: string
): Promise<{ user: AuthUser } | NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const event = await db.calendarEvent.findUnique({
    where: { id: eventId },
    select: { userId: true },
  });
  if (!event || event.userId !== user.id) {
    return NextResponse.json({ error: "日程不存在" }, { status: 404 });
  }

  return { user };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireOwnEvent(request, id);
  if (access instanceof NextResponse) return access;

  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.startTime !== undefined) {
    const startTime = new Date(body.startTime);
    if (Number.isNaN(startTime.getTime())) {
      return NextResponse.json({ error: "开始时间格式无效" }, { status: 400 });
    }
    data.startTime = startTime;
  }
  if (body.endTime !== undefined) {
    const endTime = new Date(body.endTime);
    if (Number.isNaN(endTime.getTime())) {
      return NextResponse.json({ error: "结束时间格式无效" }, { status: 400 });
    }
    data.endTime = endTime;
  }
  if (body.allDay !== undefined) data.allDay = Boolean(body.allDay);
  if (body.location !== undefined) data.location = body.location || null;
  if (body.taskId !== undefined) data.taskId = body.taskId || null;

  const event = await db.calendarEvent.update({
    where: { id },
    data,
    include: {
      task: { select: { id: true, title: true, status: true } },
    },
  });

  return NextResponse.json(event);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireOwnEvent(request, id);
  if (access instanceof NextResponse) return access;

  await db.calendarEvent.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
