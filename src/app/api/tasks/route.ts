import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { onTaskCreated } from "@/lib/project-discussion/system-events";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);
  const cursor = searchParams.get("cursor");

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
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = tasks.length > limit;
  if (hasMore) tasks.pop();
  const nextCursor = hasMore ? tasks[tasks.length - 1]?.id : null;

  return NextResponse.json({ items: tasks, nextCursor });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();

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

  if (task.projectId) {
    onTaskCreated(
      task.projectId,
      task.id,
      task.title,
      user.id,
      user.name,
      task.priority
    ).catch((err) => console.error("[task-api-hook] discussion write failed:", err));
  }

  return NextResponse.json(task, { status: 201 });
});
