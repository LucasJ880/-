import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { pushEventToGoogle, getGoogleProvider } from "@/lib/google-calendar";
import { startOfDayToronto, endOfDayToronto } from "@/lib/time";
import { onEventCreated } from "@/lib/project-discussion/system-events";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date");

  const ref = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const dayStart = startOfDayToronto(ref);
  const dayEnd = endOfDayToronto(ref);

  const events = await db.calendarEvent.findMany({
    where: {
      OR: [
        { startTime: { gte: dayStart, lt: dayEnd } },
        { endTime: { gt: dayStart, lte: dayEnd } },
        { startTime: { lt: dayStart }, endTime: { gt: dayEnd } },
      ],
    },
    include: {
      task: { select: { id: true, title: true, status: true } },
    },
    orderBy: [{ allDay: "desc" }, { startTime: "asc" }],
  });

  return NextResponse.json(events);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }
  if (!body.startTime) {
    return NextResponse.json({ error: "开始时间不能为空" }, { status: 400 });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const startTime = new Date(body.startTime);
  let endTime: Date;

  if (body.allDay) {
    endTime = new Date(startTime);
    endTime.setHours(23, 59, 59, 999);
  } else if (body.endTime) {
    endTime = new Date(body.endTime);
  } else {
    endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
  }

  const event = await db.calendarEvent.create({
    data: {
      title: body.title.trim(),
      description: body.description || null,
      startTime,
      endTime,
      allDay: Boolean(body.allDay),
      location: body.location || null,
      source: "qingyan",
      taskId: body.taskId || null,
      userId: user.id,
    },
    include: {
      task: { select: { id: true, title: true, status: true } },
    },
  });

  // Write to project discussion if linked to a project via task
  if (event.task?.id) {
    const linkedTask = await db.task.findUnique({
      where: { id: event.task.id },
      select: { projectId: true },
    });
    if (linkedTask?.projectId) {
      onEventCreated(
        linkedTask.projectId,
        event.id,
        event.title,
        event.startTime.toISOString(),
        user.id,
        user.name
      ).catch((err) => console.error("[calendar-api-hook] discussion write failed:", err));
    }
  }

  const googleProvider = await getGoogleProvider(user.id);
  if (googleProvider) {
    const googleId = await pushEventToGoogle(user.id, {
      title: event.title,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      allDay: event.allDay,
      location: event.location,
    });
    if (googleId) {
      await db.calendarEvent.update({
        where: { id: event.id },
        data: { externalId: googleId },
      });
    }
  }

  return NextResponse.json(event, { status: 201 });
}
