import { db } from "@/lib/db";
import { normalizePagination } from "@/lib/common/validation";
import { generateReminderLayers } from "@/lib/reminders/generator";
import type { ReminderItem } from "@/lib/reminders/generator";
import { ensureUserNotificationPreference } from "./preferences";
import { loadProjectRulesMap } from "./project-rules";
import {
  buildPreferenceContext,
  shouldCreateNotification,
  type AuditFilterContext,
} from "./filter";
import { extractName, formatAuditTitle, serializeNotification, type NotificationItem } from "./formatters";

export type { NotificationItem } from "./formatters";

export interface NotificationQuery {
  status?: string;
  category?: string;
  type?: string;
  priority?: string;
  projectId?: string;
  page?: number;
  pageSize?: number;
}

export interface NotificationListResult {
  data: NotificationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Sync: Reminders → Notifications ───────────────────────────

function reminderToType(r: ReminderItem): "task_due" | "calendar_event" | "followup" {
  if (r.type === "deadline") return "task_due";
  if (r.type === "event") return "calendar_event";
  return "followup";
}

function reminderToCategory(r: ReminderItem): string {
  if (r.type === "deadline") return "reminder";
  if (r.type === "event") return "alert";
  return "reminder";
}

function reminderToPriority(r: ReminderItem): string {
  if (r.priority === "urgent") return "urgent";
  if (r.priority === "high") return "high";
  return "medium";
}

export async function syncRemindersToNotifications(userId: string): Promise<void> {
  const prefRow = await ensureUserNotificationPreference(userId);
  if (!prefRow.enableInAppNotifications) return;

  const prefCtx = buildPreferenceContext(prefRow);
  const layers = await generateReminderLayers(userId);
  const allItems = [...layers.immediate, ...layers.today, ...layers.upcoming];

  if (allItems.length === 0) return;

  const projectIds = [
    ...new Set(
      allItems
        .map((i) => i.projectId ?? i.project?.id)
        .filter((x): x is string => !!x)
    ),
  ];
  const rulesMap = await loadProjectRulesMap(userId, projectIds);

  const taskIds = [...new Set(allItems.map((i) => i.taskId).filter((x): x is string => !!x))];
  const taskMetaMap = new Map<
    string,
    { assigneeId: string | null; creatorId: string | null; projectId: string | null }
  >();
  if (taskIds.length > 0) {
    const tasks = await db.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, assigneeId: true, creatorId: true, projectId: true },
    });
    for (const t of tasks) {
      taskMetaMap.set(t.id, {
        assigneeId: t.assigneeId,
        creatorId: t.creatorId,
        projectId: t.projectId,
      });
    }
  }

  const sourceKeys = allItems.map((i) => i.sourceKey);
  const existing = await db.notification.findMany({
    where: { userId, sourceKey: { in: sourceKeys } },
    select: { sourceKey: true, status: true },
  });
  const existingMap = new Map(existing.map((e) => [e.sourceKey, e.status]));

  const toCreate: Array<{
    userId: string;
    type: string;
    category: string;
    title: string;
    summary: string;
    entityType: string | null;
    entityId: string | null;
    projectId: string | null;
    status: string;
    priority: string;
    sourceKey: string;
  }> = [];

  for (const item of allItems) {
    const existStatus = existingMap.get(item.sourceKey);
    if (existStatus) continue;

    const notifType = reminderToType(item);
    const priority = reminderToPriority(item);
    const projectId = item.projectId ?? item.project?.id ?? null;
    let assigneeId: string | null = null;
    let creatorId: string | null = null;
    if (item.taskId) {
      const meta = taskMetaMap.get(item.taskId);
      assigneeId = meta?.assigneeId ?? null;
      creatorId = meta?.creatorId ?? null;
    }

    const ok = shouldCreateNotification(
      prefCtx,
      rulesMap,
      {
        kind: "reminder",
        payload: {
          userId,
          notifType,
          priority,
          projectId,
          taskAssigneeId: assigneeId,
          taskCreatorId: creatorId,
        },
      },
      userId
    );
    if (!ok) continue;

    toCreate.push({
      userId,
      type: notifType,
      category: reminderToCategory(item),
      title: item.title,
      summary: item.subtitle,
      entityType: item.taskId ? "task" : item.eventId ? "calendar_event" : null,
      entityId: item.taskId ?? item.eventId ?? null,
      projectId,
      status: "unread",
      priority,
      sourceKey: item.sourceKey,
    });
  }

  if (toCreate.length > 0) {
    await db.notification.createMany({ data: toCreate, skipDuplicates: true });
  }
}

// ─── Sync: Recent AuditLogs → Notifications ────────────────────

const AUDIT_NOTIFICATION_TYPES: Record<string, "runtime_failed" | "feedback" | "project_update"> = {
  runtime_fail: "runtime_failed",
  create_conversation_feedback: "feedback",
  update_conversation_feedback: "feedback",
  create_message_feedback: "feedback",
  update_message_feedback: "feedback",
  status_change: "project_update",
};

const AUDIT_NOTIFY_ACTIONS = new Set(Object.keys(AUDIT_NOTIFICATION_TYPES));

function auditPriority(action: string): string {
  if (action === "runtime_fail") return "high";
  if (action === "status_change") return "medium";
  return "medium";
}

export async function syncAuditToNotifications(userId: string): Promise<void> {
  const prefRow = await ensureUserNotificationPreference(userId);
  if (!prefRow.enableInAppNotifications) return;

  const prefCtx = buildPreferenceContext(prefRow);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const projectIds = await getUserProjectIds(userId);
  if (projectIds.length === 0) return;

  const projects = await db.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, ownerId: true },
  });
  const ownerByProject = new Map(projects.map((p) => [p.id, p.ownerId]));

  const rulesMap = await loadProjectRulesMap(userId, projectIds);

  const recentLogs = await db.auditLog.findMany({
    where: {
      projectId: { in: projectIds },
      action: { in: Array.from(AUDIT_NOTIFY_ACTIONS) },
      createdAt: { gte: since },
      userId: { not: userId },
    },
    select: {
      id: true,
      userId: true,
      action: true,
      targetType: true,
      targetId: true,
      projectId: true,
      afterData: true,
      createdAt: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  if (recentLogs.length === 0) return;

  const cfIds = recentLogs
    .filter((l) => l.targetType === "conversation_feedback" && l.targetId)
    .map((l) => l.targetId!);
  const mfIds = recentLogs
    .filter((l) => l.targetType === "message_feedback" && l.targetId)
    .map((l) => l.targetId!);

  const convUserByTarget = new Map<string, string | null>();

  if (cfIds.length > 0) {
    const cfs = await db.conversationFeedback.findMany({
      where: { id: { in: cfIds } },
      select: { id: true, conversationId: true },
    });
    const cids = [...new Set(cfs.map((c) => c.conversationId))];
    const convs = await db.conversation.findMany({
      where: { id: { in: cids } },
      select: { id: true, userId: true },
    });
    const convMap = new Map(convs.map((c) => [c.id, c.userId]));
    for (const f of cfs) {
      convUserByTarget.set(f.id, convMap.get(f.conversationId) ?? null);
    }
  }
  if (mfIds.length > 0) {
    const mfs = await db.messageFeedback.findMany({
      where: { id: { in: mfIds } },
      select: { id: true, conversationId: true },
    });
    const cids = [...new Set(mfs.map((m) => m.conversationId))];
    const convs = await db.conversation.findMany({
      where: { id: { in: cids } },
      select: { id: true, userId: true },
    });
    const convMap = new Map(convs.map((c) => [c.id, c.userId]));
    for (const f of mfs) {
      convUserByTarget.set(f.id, convMap.get(f.conversationId) ?? null);
    }
  }

  const sourceKeys = recentLogs.map((l) => `audit:${l.id}`);
  const existing = await db.notification.findMany({
    where: { userId, sourceKey: { in: sourceKeys } },
    select: { sourceKey: true },
  });
  const existingSet = new Set(existing.map((e) => e.sourceKey));

  const toCreate: Array<{
    userId: string;
    orgId: string | null;
    projectId: string;
    type: string;
    category: string;
    title: string;
    summary: string | null;
    entityType: string | null;
    entityId: string | null;
    activityId: string;
    status: string;
    priority: string;
    sourceKey: string;
  }> = [];

  for (const l of recentLogs) {
    if (existingSet.has(`audit:${l.id}`)) continue;
    if (!l.projectId) continue;

    const notifType = AUDIT_NOTIFICATION_TYPES[l.action];
    if (!notifType) continue;

    const priority = auditPriority(l.action);
    const projectOwnerId = ownerByProject.get(l.projectId) ?? "";

    let conversationUserId: string | null | undefined;
    if (l.targetId && (l.targetType === "conversation_feedback" || l.targetType === "message_feedback")) {
      conversationUserId = convUserByTarget.get(l.targetId) ?? null;
    }

    const auditCtx: AuditFilterContext = {
      action: l.action,
      notifType,
      priority,
      projectId: l.projectId,
      projectOwnerId,
      actorUserId: l.userId,
      conversationUserId,
    };

    const ok = shouldCreateNotification(
      prefCtx,
      rulesMap,
      { kind: "audit", payload: auditCtx },
      userId
    );
    if (!ok) continue;

    const targetName = extractName(l.afterData);
    const actorName = l.user.name;
    const typeLabel = notifType;

    toCreate.push({
      userId,
      orgId: null,
      projectId: l.projectId,
      type: typeLabel,
      category: l.action === "runtime_fail" ? "alert" : "update",
      title: formatAuditTitle(l.action, l.targetType, targetName, actorName),
      summary: null,
      entityType: l.targetType,
      entityId: l.targetId,
      activityId: l.id,
      status: "unread",
      priority,
      sourceKey: `audit:${l.id}`,
    });
  }

  if (toCreate.length > 0) {
    await db.notification.createMany({ data: toCreate, skipDuplicates: true });
  }
}

function evaluationPriority(score: number | null): string {
  if (score === null) return "medium";
  if (score <= 1.5) return "urgent";
  if (score <= 2.5) return "high";
  return "medium";
}

export async function syncLowEvaluationNotifications(userId: string): Promise<void> {
  const prefRow = await ensureUserNotificationPreference(userId);
  if (!prefRow.enableInAppNotifications) return;

  const prefCtx = buildPreferenceContext(prefRow);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const projectIds = await getUserProjectIds(userId);
  if (projectIds.length === 0) return;

  const rulesMap = await loadProjectRulesMap(userId, projectIds);
  const projects = await db.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, ownerId: true, name: true },
  });
  const ownerByProject = new Map(projects.map((p) => [p.id, p.ownerId]));
  const nameByProject = new Map(projects.map((p) => [p.id, p.name]));

  const lowEvalRows = await db.evaluationRun.findMany({
    where: {
      projectId: { in: projectIds },
      createdAt: { gte: since },
      score: { lte: 3 },
    },
    select: {
      id: true,
      projectId: true,
      conversationId: true,
      score: true,
      createdById: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });
  if (lowEvalRows.length === 0) return;

  const sourceKeys = lowEvalRows.map((r) => `eval_low:${r.id}`);
  const existing = await db.notification.findMany({
    where: { userId, sourceKey: { in: sourceKeys } },
    select: { sourceKey: true },
  });
  const existingSet = new Set(existing.map((e) => e.sourceKey));

  const convIds = [
    ...new Set(lowEvalRows.map((r) => r.conversationId).filter((x): x is string => !!x)),
  ];
  const convUserMap = new Map<string, string | null>();
  if (convIds.length > 0) {
    const convRows = await db.conversation.findMany({
      where: { id: { in: convIds } },
      select: { id: true, userId: true },
    });
    for (const c of convRows) convUserMap.set(c.id, c.userId ?? null);
  }

  const toCreate: Array<{
    userId: string;
    orgId: string | null;
    projectId: string;
    type: string;
    category: string;
    title: string;
    summary: string | null;
    entityType: string | null;
    entityId: string | null;
    activityId: string;
    status: string;
    priority: string;
    sourceKey: string;
  }> = [];

  for (const row of lowEvalRows) {
    if (existingSet.has(`eval_low:${row.id}`)) continue;
    const projectOwnerId = ownerByProject.get(row.projectId) ?? "";
    const projectName = nameByProject.get(row.projectId) ?? "项目";
    const priority = evaluationPriority(row.score);

    const auditCtx: AuditFilterContext = {
      action: "evaluation_low",
      notifType: "evaluation_low",
      priority,
      projectId: row.projectId,
      projectOwnerId,
      actorUserId: row.createdById,
      conversationUserId: row.conversationId
        ? (convUserMap.get(row.conversationId) ?? null)
        : null,
    };

    const ok = shouldCreateNotification(
      prefCtx,
      rulesMap,
      { kind: "audit", payload: auditCtx },
      userId
    );
    if (!ok) continue;

    toCreate.push({
      userId,
      orgId: null,
      projectId: row.projectId,
      type: "evaluation_low",
      category: "alert",
      title: `检测到低分评估 · ${projectName}`,
      summary:
        row.score !== null
          ? `评估分 ${row.score.toFixed(1)}，建议排查 Prompt / 知识库 / 工具链路`
          : "检测到低分评估，建议尽快复核",
      entityType: "evaluation_run",
      entityId: row.id,
      activityId: row.id,
      status: "unread",
      priority,
      sourceKey: `eval_low:${row.id}`,
    });
  }

  if (toCreate.length > 0) {
    await db.notification.createMany({ data: toCreate, skipDuplicates: true });
  }
}


async function getUserProjectIds(userId: string): Promise<string[]> {
  const memberships = await db.projectMember.findMany({
    where: { userId, status: "active" },
    select: { projectId: true },
  });
  const owned = await db.project.findMany({
    where: { ownerId: userId, status: "active" },
    select: { id: true },
  });
  const candidateIds = [
    ...new Set([
      ...memberships.map((m) => m.projectId),
      ...owned.map((p) => p.id),
    ]),
  ];
  if (candidateIds.length === 0) return [];

  const dispatched = await db.project.findMany({
    where: { id: { in: candidateIds }, intakeStatus: "dispatched" },
    select: { id: true },
  });
  return dispatched.map((p) => p.id);
}

// ─── Full Sync ─────────────────────────────────────────────────

export async function syncNotifications(userId: string): Promise<void> {
  const pref = await ensureUserNotificationPreference(userId);
  if (pref.enableInAppNotifications) {
    await Promise.all([
      syncRemindersToNotifications(userId),
      syncAuditToNotifications(userId),
      syncLowEvaluationNotifications(userId),
    ]);
  }

  await db.notification.updateMany({
    where: {
      userId,
      status: "snoozed",
      snoozeUntil: { lte: new Date() },
    },
    data: { status: "unread", snoozeUntil: null },
  });
}

async function userInAppEnabled(userId: string): Promise<boolean> {
  const p = await db.userNotificationPreference.findUnique({ where: { userId } });
  if (!p) return true;
  return p.enableInAppNotifications;
}

// ─── Query ─────────────────────────────────────────────────────

export async function listNotifications(
  userId: string,
  params?: NotificationQuery
): Promise<NotificationListResult> {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  if (!(await userInAppEnabled(userId))) {
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }

  const pref = await db.userNotificationPreference.findUnique({ where: { userId } });

  const where: Record<string, unknown> = { userId };
  if (params?.status) {
    if (params.status === "active") {
      where.status = { in: ["unread", "read"] };
    } else {
      where.status = params.status;
    }
  }
  if (params?.category) where.category = params.category;
  if (params?.type) where.type = params.type;
  if (params?.projectId) where.projectId = params.projectId;

  if (!params?.status) {
    where.status = { notIn: ["archived", "snoozed"] };
  }

  if (params?.priority) {
    where.priority = params.priority;
  } else if (pref?.onlyHighPriority) {
    where.priority = { in: ["high", "urgent"] };
  }

  const [data, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
    db.notification.count({ where }),
  ]);

  return {
    data: data.map(serializeNotification),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  if (!(await userInAppEnabled(userId))) return 0;
  const pref = await db.userNotificationPreference.findUnique({ where: { userId } });
  const where: Record<string, unknown> = { userId, status: "unread" };
  if (pref?.onlyHighPriority) {
    where.priority = { in: ["high", "urgent"] };
  }
  return db.notification.count({ where });
}

export async function markRead(notificationId: string, userId: string): Promise<boolean> {
  const n = await db.notification.findFirst({ where: { id: notificationId, userId } });
  if (!n) return false;
  if (n.status === "done") return true;
  await db.notification.update({
    where: { id: notificationId },
    data: { status: "read", readAt: new Date() },
  });
  return true;
}

export async function markDone(notificationId: string, userId: string): Promise<boolean> {
  const n = await db.notification.findFirst({ where: { id: notificationId, userId } });
  if (!n) return false;
  await db.notification.update({
    where: { id: notificationId },
    data: { status: "done", doneAt: new Date() },
  });
  return true;
}

export async function snoozeNotification(
  notificationId: string,
  userId: string,
  until: Date
): Promise<boolean> {
  const n = await db.notification.findFirst({ where: { id: notificationId, userId } });
  if (!n) return false;
  await db.notification.update({
    where: { id: notificationId },
    data: { status: "snoozed", snoozeUntil: until },
  });
  return true;
}

export async function batchAction(
  userId: string,
  ids: string[],
  action: "mark_read" | "mark_done" | "snooze",
  snoozeUntil?: Date
): Promise<number> {
  if (ids.length === 0) return 0;

  const data: Record<string, unknown> = {};
  if (action === "mark_read") {
    data.status = "read";
    data.readAt = new Date();
  } else if (action === "mark_done") {
    data.status = "done";
    data.doneAt = new Date();
  } else if (action === "snooze") {
    data.status = "snoozed";
    data.snoozeUntil = snoozeUntil ?? new Date(Date.now() + 4 * 60 * 60 * 1000);
  }

  const result = await db.notification.updateMany({
    where: { id: { in: ids }, userId },
    data,
  });
  return result.count;
}

