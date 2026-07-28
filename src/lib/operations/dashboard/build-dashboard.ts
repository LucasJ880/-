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
    href: `/tasks?focus=${task.id}`,
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
}): Promise<OpsDashboardData> {
  const {
    userId,
    userName,
    userRole,
    orgId,
    ownOnly,
    canToggleTeamView,
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
        status: { notIn: ["done", "cancelled"] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        updatedAt: true,
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
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const staleTasks = tasks.filter(
    (t) =>
      isOpenTaskStatus(t.status) &&
      !isOverdueDueDate(t.dueDate, todayStart) &&
      !isDueTodayDueDate(t.dueDate, todayStart, todayEnd) &&
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
  for (const t of dueTodayTasks.slice(0, 6)) {
    if (urgentItems.some((u) => u.id.startsWith(`task:${t.id}:`))) continue;
    urgentItems.push(taskUrgentItem(t, "due_today_task", "今天到期"));
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

  const followups = [
    ...reminderLayers.immediate,
    ...reminderLayers.today,
    ...reminderLayers.upcoming,
  ].filter((r) => r.type === "followup" && !r.isRead);

  for (const r of followups.slice(0, 8)) {
    // 仅展示用户可见项目上的提醒，避免串项目
    if (r.projectId && !orgProjectIds.includes(r.projectId) && orgProjectIds.length) {
      continue;
    }
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

  // 重点工作对象：仅来自当前可见任务关联的项目投影
  const projectAgg = new Map<
    string,
    {
      name: string;
      open: number;
      overdue: number;
      updatedAt: Date;
    }
  >();
  for (const t of tasks) {
    const pid = t.project?.id ?? t.projectId;
    if (!pid || !t.project) continue;
    if (orgProjectIds.length && !orgProjectIds.includes(pid)) continue;
    const cur = projectAgg.get(pid) ?? {
      name: t.project.name,
      open: 0,
      overdue: 0,
      updatedAt: t.project.updatedAt,
    };
    cur.open += 1;
    if (isOverdueDueDate(t.dueDate, todayStart)) cur.overdue += 1;
    if (t.updatedAt.getTime() > cur.updatedAt.getTime()) {
      cur.updatedAt = t.updatedAt;
    }
    projectAgg.set(pid, cur);
  }

  const relatedProjects: OpsRelatedProjectSummary[] = [...projectAgg.entries()]
    .map(([id, v]) => ({
      id,
      name: v.name,
      openTaskCount: v.open,
      overdueTaskCount: v.overdue,
      updatedAt: v.updatedAt.toISOString(),
    }))
    .sort((a, b) => {
      if (b.overdueTaskCount !== a.overdueTaskCount) {
        return b.overdueTaskCount - a.overdueTaskCount;
      }
      return b.openTaskCount - a.openTaskCount;
    })
    .slice(0, 6);

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
    relatedProjects,
    counts,
    notes: [
      "重点工作对象由当前可见任务关联投影，不是正式运营执行项目列表。",
      "当前任务模型不支持独立 BLOCKED 状态；阻塞类信号仅在有可靠字段时展示。",
    ],
  };
}
