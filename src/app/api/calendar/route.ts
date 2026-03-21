import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { pushEventToGoogle, getGoogleProvider } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date");

  let dayStart: Date;

  if (dateStr) {
    dayStart = new Date(dateStr);
    dayStart.setHours(0, 0, 0, 0);
  } else {
    dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
  }
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayStart.getDate() + 1);

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
