import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");

  const where: Record<string, string> = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;

  const tasks = await db.task.findMany({
    where,
    include: {
      project: { select: { id: true, name: true, color: true } },
      assignee: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const task = await db.task.create({
    data: {
      title: body.title,
      description: body.description || null,
      status: body.status || "todo",
      priority: body.priority || "medium",
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      needReminder: Boolean(body.needReminder),
      projectId: body.projectId || null,
      creatorId: user.id,
      assigneeId: user.id,
    },
    include: {
      project: { select: { id: true, name: true, color: true } },
      assignee: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
    },
  });

  await db.taskActivity.create({
    data: { action: "created", detail: task.title, taskId: task.id, actorId: user.id },
  });

  return NextResponse.json(task, { status: 201 });
}
