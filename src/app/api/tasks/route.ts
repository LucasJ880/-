import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getVisibleProjectIds } from "@/lib/projects/visibility";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");

  const projectIds = await getVisibleProjectIds(user.id, user.role);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;

  if (projectIds !== null) {
    where.OR = [
      { projectId: { in: projectIds } },
      { projectId: null, creatorId: user.id },
      { assigneeId: user.id },
    ];
  }

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

  if (body.projectId) {
    const projectIds = await getVisibleProjectIds(user.id, user.role);
    if (projectIds !== null && !projectIds.includes(body.projectId)) {
      return NextResponse.json({ error: "无权访问该项目" }, { status: 403 });
    }
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
