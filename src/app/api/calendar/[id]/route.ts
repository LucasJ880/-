import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";

export const PATCH = withAuth(async (request, ctx) => {
  const { id } = await ctx.params;
  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.startTime !== undefined) data.startTime = new Date(body.startTime);
  if (body.endTime !== undefined) data.endTime = new Date(body.endTime);
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
});

export const DELETE = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;
  await db.calendarEvent.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
