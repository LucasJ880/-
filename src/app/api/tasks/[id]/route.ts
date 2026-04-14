import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { getProjectProgress } from "@/lib/progress/query";

function canAccessTask(
  task: { projectId: string | null; creatorId: string | null; assigneeId: string | null },
  userId: string,
  visibleIds: string[] | null
): boolean {
  if (visibleIds === null) return true;
  if (task.creatorId === userId || task.assigneeId === userId) return true;
  if (task.projectId && visibleIds.includes(task.projectId)) return true;
  if (!task.projectId) return task.creatorId === userId || task.assigneeId === userId;
  return false;
}

export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await db.task.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, color: true } },
      assignee: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
      calendarEvents: {
        select: { id: true, title: true, startTime: true, endTime: true, allDay: true, location: true },
        orderBy: { startTime: "asc" },
      },
    },
  });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const visibleIds = await getVisibleProjectIds(user.id, user.role);
  if (!canAccessTask(task, user.id, visibleIds)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  return NextResponse.json(task);
});

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();

  const oldTask = await db.task.findUnique({
    where: { id },
    select: { status: true, priority: true, title: true, projectId: true, creatorId: true, assigneeId: true },
  });
  if (!oldTask) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const visibleIds = await getVisibleProjectIds(user.id, user.role);
  if (!canAccessTask(oldTask, user.id, visibleIds)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  if (body.projectId) {
    if (visibleIds !== null && !visibleIds.includes(body.projectId)) {
      return NextResponse.json({ error: "无权访问目标项目" }, { status: 403 });
    }
  }

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.status !== undefined) {
    data.status = body.status;
    if (body.status === "done") data.completedAt = new Date();
    if (body.status !== "done") data.completedAt = null;
  }
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.dueDate !== undefined)
    data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.projectId !== undefined) data.projectId = body.projectId || null;
  if (body.needReminder !== undefined) data.needReminder = Boolean(body.needReminder);

  const task = await db.task.update({
    where: { id },
    data,
    include: {
      project: { select: { id: true, name: true, color: true } },
      assignee: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
    },
  });

  const changes: string[] = [];
  if (body.status !== undefined && body.status !== oldTask.status)
    changes.push(`状态: ${oldTask.status} → ${body.status}`);
  if (body.priority !== undefined && body.priority !== oldTask.priority)
    changes.push(`优先级: ${oldTask.priority} → ${body.priority}`);
  if (body.title !== undefined && body.title !== oldTask.title)
    changes.push(`标题: ${oldTask.title} → ${body.title}`);

  const action = changes.length > 0 ? "updated" : "edited";
  await db.taskActivity.create({
    data: {
      action,
      detail: changes.length > 0 ? changes.join("；") : "更新了任务信息",
      taskId: id,
      actorId: user.id,
    },
  });

  let projectProgress = null;
  if (body.status !== undefined && body.status !== oldTask.status && task.projectId) {
    try {
      projectProgress = await getProjectProgress(task.projectId);
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ ...task, projectProgress });
});

export const DELETE = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await db.task.findUnique({
    where: { id },
    select: { projectId: true, creatorId: true, assigneeId: true },
  });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const visibleIds = await getVisibleProjectIds(user.id, user.role);
  if (!canAccessTask(task, user.id, visibleIds)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  await db.task.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
