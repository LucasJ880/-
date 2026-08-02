import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTaskAccess } from "@/lib/tasks/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireTaskAccess(request, id);
  if (access instanceof NextResponse) return access;

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
  return NextResponse.json(task);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireTaskAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, task: oldTask } = access;

  const body = await request.json();

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

  return NextResponse.json(task);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireTaskAccess(request, id);
  if (access instanceof NextResponse) return access;

  await db.task.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
