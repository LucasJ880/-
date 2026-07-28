import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { getProjectProgress } from "@/lib/progress/query";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import {
  isManagementWorkspaceUser,
  type WorkspacePolicyContext,
} from "@/lib/rbac/workspace-policy";
import { transitionTaskStatus } from "@/lib/tasks";

function canAccessTask(
  task: {
    projectId: string | null;
    creatorId: string | null;
    assigneeId: string | null;
  },
  userId: string,
  visibleIds: string[] | null,
): boolean {
  if (visibleIds === null) return true;
  if (task.creatorId === userId || task.assigneeId === userId) return true;
  if (task.projectId && visibleIds.includes(task.projectId)) return true;
  if (!task.projectId) {
    return task.creatorId === userId || task.assigneeId === userId;
  }
  return false;
}

function canEditTask(
  task: { creatorId: string | null; assigneeId: string | null },
  userId: string,
  canManageTeam: boolean,
): boolean {
  if (canManageTeam) return true;
  return task.creatorId === userId || task.assigneeId === userId;
}

export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await db.task.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, color: true } },
      assignee: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
      calendarEvents: {
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          allDay: true,
          location: true,
        },
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
    select: {
      status: true,
      priority: true,
      title: true,
      projectId: true,
      creatorId: true,
      assigneeId: true,
      blockedReason: true,
      waitingOn: true,
      waitingUntil: true,
      completedAt: true,
    },
  });
  if (!oldTask) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const visibleIds = await getVisibleProjectIds(user.id, user.role);
  if (!canAccessTask(oldTask, user.id, visibleIds)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const resolved = await resolvePreferredOrgId(user.id, user.role);
  let orgRole: string | null = null;
  if (resolved.orgId) {
    const member = await db.organizationMember.findUnique({
      where: {
        orgId_userId: { orgId: resolved.orgId, userId: user.id },
      },
      select: { role: true, status: true },
    });
    orgRole = member?.status === "active" ? member.role : null;
  }
  const wsCtx: WorkspacePolicyContext = {
    platformRole: user.role,
    orgRole,
    hasMembership: Boolean(orgRole),
  };
  const canManageTeam = isManagementWorkspaceUser(wsCtx);

  if (!canEditTask(oldTask, user.id, canManageTeam)) {
    return NextResponse.json(
      { error: "无权编辑该任务", code: "EDIT_FORBIDDEN" },
      { status: 403 },
    );
  }

  if (body.projectId) {
    if (visibleIds !== null && !visibleIds.includes(body.projectId)) {
      return NextResponse.json(
        { error: "无权访问目标项目" },
        { status: 403 },
      );
    }
  }

  if (
    body.assigneeId !== undefined &&
    body.assigneeId &&
    body.assigneeId !== user.id &&
    !canManageTeam
  ) {
    return NextResponse.json(
      { error: "无权将任务分配给他人", code: "ASSIGN_FORBIDDEN" },
      { status: 403 },
    );
  }

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.dueDate !== undefined) {
    data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  }
  if (body.projectId !== undefined) data.projectId = body.projectId || null;
  if (body.needReminder !== undefined) {
    data.needReminder = Boolean(body.needReminder);
  }
  if (body.assigneeId !== undefined) {
    data.assigneeId = body.assigneeId || null;
  }

  if (body.status !== undefined) {
    const transition = transitionTaskStatus({
      currentStatus: oldTask.status,
      nextStatus: String(body.status),
      blockedReason:
        body.blockedReason !== undefined
          ? body.blockedReason
          : oldTask.blockedReason,
      waitingOn:
        body.waitingOn !== undefined ? body.waitingOn : oldTask.waitingOn,
      waitingUntil:
        body.waitingUntil !== undefined
          ? body.waitingUntil
          : oldTask.waitingUntil,
      existing: {
        blockedReason: oldTask.blockedReason,
        waitingOn: oldTask.waitingOn,
        waitingUntil: oldTask.waitingUntil,
      },
    });
    if (!transition.ok) {
      return NextResponse.json(
        { error: transition.error, code: transition.code },
        { status: 400 },
      );
    }
    data.status = transition.status;
    data.completedAt = transition.completedAt;
    data.blockedReason = transition.blockedReason;
    data.waitingOn = transition.waitingOn;
    data.waitingUntil = transition.waitingUntil;
  } else {
    // 仅更新等待/阻塞字段（状态不变时）
    if (body.blockedReason !== undefined) {
      data.blockedReason = body.blockedReason?.trim() || null;
    }
    if (body.waitingOn !== undefined) {
      data.waitingOn = body.waitingOn?.trim() || null;
    }
    if (body.waitingUntil !== undefined) {
      data.waitingUntil = body.waitingUntil
        ? new Date(body.waitingUntil)
        : null;
    }
  }

  const task = await db.task.update({
    where: { id },
    data,
    include: {
      project: { select: { id: true, name: true, color: true } },
      assignee: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
    },
  });

  const changes: string[] = [];
  if (body.status !== undefined && body.status !== oldTask.status) {
    changes.push(`状态: ${oldTask.status} → ${task.status}`);
  }
  if (body.priority !== undefined && body.priority !== oldTask.priority) {
    changes.push(`优先级: ${oldTask.priority} → ${body.priority}`);
  }
  if (body.title !== undefined && body.title !== oldTask.title) {
    changes.push(`标题: ${oldTask.title} → ${body.title}`);
  }
  if (
    body.assigneeId !== undefined &&
    body.assigneeId !== oldTask.assigneeId
  ) {
    changes.push(`负责人已更新`);
  }
  if (body.blockedReason !== undefined) changes.push("更新阻塞原因");
  if (body.waitingOn !== undefined) changes.push("更新等待对象");

  await db.taskActivity.create({
    data: {
      action: changes.length > 0 ? "updated" : "edited",
      detail: changes.length > 0 ? changes.join("；") : "更新了任务信息",
      taskId: id,
      actorId: user.id,
    },
  });

  let projectProgress = null;
  if (
    body.status !== undefined &&
    body.status !== oldTask.status &&
    task.projectId
  ) {
    try {
      projectProgress = await getProjectProgress(task.projectId);
    } catch {
      /* non-critical */
    }
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

  const resolved = await resolvePreferredOrgId(user.id, user.role);
  let orgRole: string | null = null;
  if (resolved.orgId) {
    const member = await db.organizationMember.findUnique({
      where: {
        orgId_userId: { orgId: resolved.orgId, userId: user.id },
      },
      select: { role: true, status: true },
    });
    orgRole = member?.status === "active" ? member.role : null;
  }
  if (
    !canEditTask(task, user.id, isManagementWorkspaceUser({
      platformRole: user.role,
      orgRole,
      hasMembership: Boolean(orgRole),
    }))
  ) {
    return NextResponse.json(
      { error: "无权删除该任务", code: "DELETE_FORBIDDEN" },
      { status: 403 },
    );
  }

  await db.task.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
