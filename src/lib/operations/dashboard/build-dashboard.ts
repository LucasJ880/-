/**
 * 运营中心首页聚合（只读）
 * — 底层复用 Task / PendingAction / Reminder
 * — 组织边界 + 项目可见性 + 本人/团队范围
 */

import { db } from "@/lib/db";
import { getTeamApprovalAccessIds } from "@/lib/marketing/team";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { generateReminderLayers } from "@/lib/reminders/generator";
import {
  endOfDayToronto,
  formatDateLongToronto,
  startOfDayToronto,
} from "@/lib/time";
import {
  CLOSED_TASK_STATUSES,
  isTaskActiveWork,
  isTaskBlocked,
  isTaskWaiting,
  isUrgentTask,
  isWaitingUntilDue,
} from "@/lib/tasks";
import {
  listFocusDeliveryProjects,
  type OpsAccessContext,
} from "@/lib/operations/projects";
import {
  isDueTodayDueDate,
  isOpenTaskStatus,
  isOverdueDueDate,
  isStaleOpenTask,
  truncatePreview,
} from "./classify";
import type {
  OpsDashboardData,
  OpsDashboardItem,
  OpsPendingActionSummary,
  OpsRelatedProjectSummary,
  OpsTaskSummary,
} from "./types";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  updatedAt: Date;
  waitingOn: string | null;
  waitingUntil: Date | null;
  blockedReason: string | null;
  projectId: string | null;
  project: { id: string; name: string; updatedAt: Date } | null;
  assignee: { id: string; name: string } | null;
  creatorId: string;
};

async function resolveOrgProjectIds(
  userId: string,
  role: string,
  orgId: string,
): Promise<string[]> {
  const visible = await getVisibleProjectIds(userId, role);
  const projects = await db.project.findMany({
    where: {
      orgId,
      ...(visible !== null ? { id: { in: visible } } : {}),
    },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}

function buildTaskWhere(
  userId: string,
  orgProjectIds: string[],
  ownOnly: boolean,
): Record<string, unknown> {
  const visibility: Record<string, unknown> = {
    OR: [
      ...(orgProjectIds.length
        ? [{ projectId: { in: orgProjectIds } }]
        : []),
      {
        projectId: null,
        OR: [{ creatorId: userId }, { assigneeId: userId }],
      },
    ],
  };

  if (!ownOnly) return visibility;

  return {
    AND: [
      visibility,
      { OR: [{ assigneeId: userId }, { creatorId: userId }] },
    ],
  };
}

function toTaskSummary(task: TaskRow): OpsTaskSummary {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueDate?.toISOString() ?? null,
    projectId: task.project?.id ?? task.projectId,
    projectName: task.project?.name ?? null,
    assigneeName: task.assignee?.name ?? null,
    sourceLabel: "项目任务",
    updatedAt: task.updatedAt.toISOString(),
  };
}

function taskUrgentItem(
  task: TaskRow,
  kind: "overdue_task" | "due_today_task" | "stale_task",
  statusLabel: string,
): OpsDashboardItem {
  const projectId = task.project?.id ?? task.projectId;
  return {
    id: `task:${task.id}:${kind}`,
    kind,
    title: task.title,
    projectId,
    projectName: task.project?.name ?? null,
    assigneeName: task.assignee?.name ?? null,
    dueAt: task.dueDate?.toISOString() ?? null,
    statusLabel,
    sourceLabel: "项目任务",
    href: `/tasks?focus=${task.id}&due=${kind === "overdue_task" ? "overdue" : kind === "due_today_task" ? "today" : ""}`.replace(
      /&due=$/,
      "",
    ),
    secondaryHref: projectId ? `/projects/${projectId}` : null,
    priority: task.priority,
  };
}

export async function buildOpsDashboard(params: {
  userId: string;
  userName: string;
  userRole: string;
  orgId: string;
  /** true = 仅本人相关任务；false = 可见项目内团队任务 */
  ownOnly: boolean;
  canToggleTeamView: boolean;
  /** Phase 4：团队/执行项目权限上下文 */
  opsCtx?: OpsAccessContext;
}): Promise<OpsDashboardData> {
  const {
    userId,
    userName,
    userRole,
    orgId,
    ownOnly,
    canToggleTeamView,
    opsCtx,
  } = params;

  const now = new Date();
  const todayStart = startOfDayToronto(now);
  const todayEnd = endOfDayToronto(now);

  const orgProjectIds = await resolveOrgProjectIds(userId, userRole, orgId);
  const taskWhere = buildTaskWhere(userId, orgProjectIds, ownOnly);

  const [openTasks, pendingRaw, reminderLayers] = await Promise.all([
    db.task.findMany({
      where: {
        ...taskWhere,
        status: { notIn: [...CLOSED_TASK_STATUSES] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        updatedAt: true,
        waitingOn: true,
        waitingUntil: true,
        blockedReason: true,
        projectId: true,
        creatorId: true,
        project: { select: { id: true, name: true, updatedAt: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    (async () => {
      const access = await getTeamApprovalAccessIds(userId);
      return db.pendingAction.findMany({
        where: {
          status: "pending",
          AND: [
            {
              OR: [
                {
                  createdById: userId,
                  orgId: null,
                  projectId: null,
                  approverUserId: null,
                },
                { approverUserId: userId },
                ...(access.orgIds.length
                  ? [{ orgId: { in: access.orgIds } }]
                  : []),
                ...(access.projectIds.length
                  ? [{ projectId: { in: access.projectIds } }]
                  : []),
              ],
            },
            {
              OR: [
                { orgId },
                { orgId: null, createdById: userId },
                ...(orgProjectIds.length
                  ? [{ projectId: { in: orgProjectIds } }]
                  : []),
              ],
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          type: true,
          title: true,
          preview: true,
          status: true,
          createdAt: true,
          projectId: true,
          agentRunId: true,
        },
      });
    })(),
    generateReminderLayers(userId),
  ]);

  const tasks = openTasks as TaskRow[];

  const overdueTasks = tasks.filter((t) =>
    isOverdueDueDate(t.dueDate, todayStart),
  );
  const dueTodayTasks = tasks.filter((t) =>
    isDueTodayDueDate(t.dueDate, todayStart, todayEnd),
  );
  const inProgressTasks = tasks.filter((t) => isTaskActiveWork(t.status));
  const blockedTasks = tasks.filter((t) => isTaskBlocked(t.status));
  const waitingDueTasks = tasks.filter(
    (t) => isTaskWaiting(t.status) && isWaitingUntilDue(t.waitingUntil, now),
  );
  const waitingNotDueTasks = tasks.filter(
    (t) => isTaskWaiting(t.status) && !isWaitingUntilDue(t.waitingUntil, now),
  );
  const staleTasks = tasks.filter(
    (t) =>
      isOpenTaskStatus(t.status) &&
      !isUrgentTask(t, now) &&
      isStaleOpenTask(t.updatedAt, now),
  );

  const projectNameById = new Map<string, string>();
  for (const t of tasks) {
    if (t.project) projectNameById.set(t.project.id, t.project.name);
  }
  const pendingProjectIds = [
    ...new Set(
      pendingRaw
        .map((a) => a.projectId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (pendingProjectIds.length) {
    const allowed = new Set(orgProjectIds);
    const safeIds = pendingProjectIds.filter(
      (id) => allowed.has(id) || userRole === "super_admin" || userRole === "admin",
    );
    if (safeIds.length) {
      const rows = await db.project.findMany({
        where: { id: { in: safeIds }, orgId },
        select: { id: true, name: true },
      });
      for (const r of rows) projectNameById.set(r.id, r.name);
    }
  }

  const urgentItems: OpsDashboardItem[] = [];
  for (const t of overdueTasks.slice(0, 8)) {
    urgentItems.push(taskUrgentItem(t, "overdue_task", "已经逾期"));
  }
  for (const t of blockedTasks.slice(0, 6)) {
    if (urgentItems.some((u) => u.id.startsWith(`task:${t.id}:`))) continue;
    urgentItems.push(
      taskUrgentItem(
        t,
        "stale_task",
        t.blockedReason ? `阻塞：${t.blockedReason}` : "阻塞",
      ),
    );
  }
  for (const t of dueTodayTasks.slice(0, 6)) {
    if (urgentItems.some((u) => u.id.startsWith(`task:${t.id}:`))) continue;
    urgentItems.push(taskUrgentItem(t, "due_today_task", "今天到期"));
  }
  for (const t of waitingDueTasks.slice(0, 4)) {
    if (urgentItems.some((u) => u.id.startsWith(`task:${t.id}:`))) continue;
    urgentItems.push(
      taskUrgentItem(
        t,
        "stale_task",
        t.waitingOn ? `等待到期：${t.waitingOn}` : "等待跟进已到期",
      ),
    );
  }
  for (const t of staleTasks.slice(0, 4)) {
    if (urgentItems.some((u) => u.id.startsWith(`task:${t.id}:`))) continue;
    urgentItems.push(taskUrgentItem(t, "stale_task", "长时间未更新"));
  }
  for (const a of pendingRaw.slice(0, 6)) {
    urgentItems.push({
      id: `pa:${a.id}`,
      kind: "pending_action",
      title: a.title || a.type,
      projectId: a.projectId,
      projectName: a.projectId
        ? (projectNameById.get(a.projectId) ?? null)
        : null,
      assigneeName: null,
      dueAt: null,
      statusLabel: "等待审批",
      sourceLabel: "AI PendingAction",
      href: `/capabilities/approvals`,
      secondaryHref: a.projectId ? `/projects/${a.projectId}` : null,
      priority: null,
    });
  }

  // 今日队列：逾期 + 今日到期 + 进行中 + 最近更新（去重，最多 12）
  const todayQueueMap = new Map<string, OpsTaskSummary>();
  for (const t of [...overdueTasks, ...dueTodayTasks, ...inProgressTasks]) {
    todayQueueMap.set(t.id, toTaskSummary(t));
  }
  const recentSorted = [...tasks].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  for (const t of recentSorted) {
    if (todayQueueMap.size >= 12) break;
    if (!todayQueueMap.has(t.id)) todayQueueMap.set(t.id, toTaskSummary(t));
  }
  const todayTasks = [...todayQueueMap.values()].slice(0, 12);

  const waitingItems: OpsDashboardItem[] = [];
  for (const t of waitingNotDueTasks.slice(0, 8)) {
    waitingItems.push(
      taskUrgentItem(
        t,
        "stale_task",
        t.waitingOn ? `等待：${t.waitingOn}` : "等待中（缺少等待对象）",
      ),
    );
  }
  for (const a of pendingRaw.slice(0, 10)) {
    waitingItems.push({
      id: `wait-pa:${a.id}`,
      kind: "pending_action",
      title: a.title || a.type,
      projectId: a.projectId,
      projectName: a.projectId
        ? (projectNameById.get(a.projectId) ?? null)
        : null,
      assigneeName: null,
      dueAt: null,
      statusLabel: "等待内部审批",
      sourceLabel: "AI PendingAction",
      href: "/capabilities/approvals",
      secondaryHref: a.projectId ? `/projects/${a.projectId}` : null,
      priority: null,
    });
  }

  // follow-up：immediate/today/高优先级 → 立即处理；其余 → 等待中
  const urgentFollowups = [
    ...reminderLayers.immediate,
    ...reminderLayers.today,
  ].filter(
    (r) =>
      r.type === "followup" &&
      !r.isRead &&
      (!r.projectId ||
        !orgProjectIds.length ||
        orgProjectIds.includes(r.projectId)),
  );
  for (const r of urgentFollowups.slice(0, 4)) {
    urgentItems.push({
      id: `urg-rem:${r.sourceKey}`,
      kind: "followup_reminder",
      title: r.title,
      projectId: r.projectId ?? null,
      projectName: r.project?.name ?? null,
      assigneeName: null,
      dueAt: null,
      statusLabel:
        r.priority === "urgent" || r.priority === "high"
          ? "高优先跟进"
          : "今日跟进",
      sourceLabel: "系统提醒",
      href: r.taskId
        ? `/tasks?focus=${r.taskId}`
        : r.projectId
          ? `/projects/${r.projectId}`
          : "/notifications",
      secondaryHref: r.projectId ? `/projects/${r.projectId}` : null,
      priority: r.priority ?? null,
    });
  }

  const laterFollowups = reminderLayers.upcoming.filter(
    (r) =>
      r.type === "followup" &&
      !r.isRead &&
      (!r.projectId ||
        !orgProjectIds.length ||
        orgProjectIds.includes(r.projectId)),
  );
  for (const r of laterFollowups.slice(0, 8)) {
    waitingItems.push({
      id: `wait-rem:${r.sourceKey}`,
      kind: "followup_reminder",
      title: r.title,
      projectId: r.projectId ?? null,
      projectName: r.project?.name ?? null,
      assigneeName: null,
      dueAt: null,
      statusLabel: "跟进提醒",
      sourceLabel: "系统提醒",
      href: r.taskId
        ? `/tasks?focus=${r.taskId}`
        : r.projectId
          ? `/projects/${r.projectId}`
          : "/notifications",
      secondaryHref: r.projectId ? `/projects/${r.projectId}` : null,
      priority: r.priority ?? null,
    });
  }

  const pendingActions: OpsPendingActionSummary[] = pendingRaw
    .slice(0, 12)
    .map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title || a.type,
      status: a.status,
      projectId: a.projectId,
      projectName: a.projectId
        ? (projectNameById.get(a.projectId) ?? null)
        : null,
      createdAt: a.createdAt.toISOString(),
      agentRunId: a.agentRunId,
      reasonPreview: truncatePreview(a.preview, 120),
      href: "/capabilities/approvals",
    }));

  // Phase 4：重点执行项目仅来自 workDomain=delivery
  const focusCtx: OpsAccessContext = opsCtx ?? {
    platformRole: userRole,
    userId,
  };
  const focusRows = await listFocusDeliveryProjects({
    orgId,
    ctx: focusCtx,
    limit: 6,
  });
  const focusDeliveryProjects: OpsRelatedProjectSummary[] = focusRows.map(
    (p) => ({
      id: p.id,
      name: p.name,
      openTaskCount: p.openTaskCount,
      overdueTaskCount: p.overdueTaskCount,
      updatedAt: p.updatedAt,
      deliveryStage: p.deliveryStage,
      deliveryStageLabel: p.deliveryStageLabel,
      health: p.health,
      healthLabel: p.healthLabel,
      ownerName: p.ownerName,
      plannedCompletionDate: p.plannedCompletionDate,
      primaryRisk: p.primaryRisk,
      href: p.href,
    }),
  );

  const counts = {
    overdue: overdueTasks.length,
    dueToday: dueTodayTasks.length,
    pendingApproval: pendingRaw.length,
    inProgress: inProgressTasks.length,
  };

  return {
    generatedAt: now.toISOString(),
    dateLabel: formatDateLongToronto(now),
    userName,
    viewMode: ownOnly ? "mine" : "team",
    canToggleTeamView,
    urgentItems: urgentItems.slice(0, 16),
    todayTasks,
    waitingItems: waitingItems.slice(0, 16),
    pendingActions,
    relatedProjects: focusDeliveryProjects,
    focusDeliveryProjects,
    counts,
    notes: [
      "重点执行项目仅包含 workDomain=delivery 的正式执行项目。",
      "招投标项目任务可出现在「我的工作」，但不会投影为执行项目。",
    ],
  };
}
