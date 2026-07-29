import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { onTaskCreated } from "@/lib/project-discussion/system-events";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import { type WorkspacePolicyContext } from "@/lib/rbac/workspace-policy";
import { canViewTeamTasks } from "@/lib/operations/projects";
import {
  buildTaskFilterWhere,
  buildTaskVisibilityWhere,
  clampPageSize,
  mergeTaskWhere,
  normalizeTaskStatus,
  transitionTaskStatus,
  type TaskProjectDomainFilter,
} from "@/lib/tasks";

const taskInclude = {
  project: { select: { id: true, name: true, color: true } },
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
} as const;

async function resolveOrgRole(
  userId: string,
  orgId: string | null,
): Promise<string | null> {
  if (!orgId) return null;
  const member = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true, status: true },
  });
  return member?.status === "active" ? member.role : null;
}

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const viewParam = searchParams.get("view");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const due = searchParams.get("due");
  const bucket = searchParams.get("bucket");
  const assigneeId = searchParams.get("assigneeId");
  const projectId = searchParams.get("projectId") || searchParams.get("project");
  const search = searchParams.get("search") || searchParams.get("q");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = clampPageSize(
    Number(searchParams.get("pageSize") || searchParams.get("limit") || 30),
  );
  // 兼容旧 cursor 分页：若传 cursor 则忽略 page
  const cursor = searchParams.get("cursor");

  const resolved = await resolvePreferredOrgId(user.id, user.role);
  const orgRole = await resolveOrgRole(user.id, resolved.orgId);
  const wsCtx: WorkspacePolicyContext = {
    platformRole: user.role,
    orgRole,
    hasMembership: Boolean(orgRole),
  };
  const canTeam = canViewTeamTasks({ ...wsCtx, userId: user.id });
  const wantTeam = viewParam === "team";
  if (wantTeam && !canTeam) {
    return NextResponse.json(
      { error: "无权查看团队工作", code: "TEAM_VIEW_FORBIDDEN" },
      { status: 403 },
    );
  }
  const ownOnly = canTeam ? !wantTeam : true;

  const domainRaw = searchParams.get("projectDomain");
  const projectDomain = (
    ["delivery", "tender", "general", "unassigned"] as const
  ).includes(domainRaw as TaskProjectDomainFilter)
    ? (domainRaw as TaskProjectDomainFilter)
    : null;

  // 项目筛选越权防护
  if (projectId) {
    const visible = await getVisibleProjectIds(user.id, user.role);
    if (visible !== null && !visible.includes(projectId)) {
      return NextResponse.json(
        { error: "无权访问该项目", code: "PROJECT_FORBIDDEN" },
        { status: 403 },
      );
    }
  }

  const visibilityWhere = await buildTaskVisibilityWhere(
    user.id,
    user.role,
    ownOnly,
  );
  const filterWhere = buildTaskFilterWhere({
    view: ownOnly ? "mine" : "team",
    status,
    due,
    bucket,
    assigneeId,
    projectId,
    projectDomain,
    search,
    priority,
  });
  const where = mergeTaskWhere(visibilityWhere, filterWhere);

  if (cursor) {
    const take = pageSize;
    const tasks = await db.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
      cursor: { id: cursor },
      skip: 1,
    });
    const hasMore = tasks.length > take;
    if (hasMore) tasks.pop();
    return NextResponse.json({
      items: tasks,
      nextCursor: hasMore ? tasks[tasks.length - 1]?.id ?? null : null,
      page: null,
      pageSize: take,
      total: null,
      view: ownOnly ? "mine" : "team",
      canToggleTeamView: canTeam,
    });
  }

  const [total, tasks] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    items: tasks,
    nextCursor: null,
    page,
    pageSize,
    total,
    view: ownOnly ? "mine" : "team",
    canToggleTeamView: canTeam,
  });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();

  if (body.projectId) {
    const projectIds = await getVisibleProjectIds(user.id, user.role);
    if (projectIds !== null && !projectIds.includes(body.projectId)) {
      return NextResponse.json({ error: "无权访问该项目" }, { status: 403 });
    }
  }

  const requestedStatus = body.status
    ? normalizeTaskStatus(String(body.status))
    : "todo";
  if (!requestedStatus) {
    return NextResponse.json({ error: "无效任务状态" }, { status: 400 });
  }

  const transition = transitionTaskStatus({
    currentStatus: "todo",
    nextStatus: requestedStatus,
    blockedReason: body.blockedReason,
    waitingOn: body.waitingOn,
    waitingUntil: body.waitingUntil,
  });
  if (!transition.ok) {
    return NextResponse.json(
      { error: transition.error, code: transition.code },
      { status: 400 },
    );
  }

  const resolved = await resolvePreferredOrgId(user.id, user.role);
  const orgRole = await resolveOrgRole(user.id, resolved.orgId);
  const canAssignOthers = canViewTeamTasks({
    platformRole: user.role,
    orgRole,
    hasMembership: Boolean(orgRole),
    userId: user.id,
  });

  let assigneeId = user.id;
  if (typeof body.assigneeId === "string" && body.assigneeId.trim()) {
    if (body.assigneeId !== user.id && !canAssignOthers) {
      return NextResponse.json(
        { error: "无权将任务分配给他人", code: "ASSIGN_FORBIDDEN" },
        { status: 403 },
      );
    }
    assigneeId = body.assigneeId.trim();
  }

  const task = await db.task.create({
    data: {
      title: body.title,
      description: body.description || null,
      status: transition.status,
      priority: body.priority || "medium",
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      needReminder: Boolean(body.needReminder),
      projectId: body.projectId || null,
      creatorId: user.id,
      assigneeId,
      blockedReason: transition.blockedReason,
      waitingOn: transition.waitingOn,
      waitingUntil: transition.waitingUntil,
      completedAt: transition.completedAt,
    },
    include: taskInclude,
  });

  await db.taskActivity.create({
    data: {
      action: "created",
      detail: task.title,
      taskId: task.id,
      actorId: user.id,
    },
  });

  if (task.projectId) {
    onTaskCreated(
      task.projectId,
      task.id,
      task.title,
      user.id,
      user.name,
      task.priority,
    ).catch((err) =>
      console.error("[task-api-hook] discussion write failed:", err),
    );
  }

  return NextResponse.json(task, { status: 201 });
});
