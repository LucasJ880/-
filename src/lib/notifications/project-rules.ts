import { db } from "@/lib/db";

export const DEFAULT_PROJECT_RULE = {
  watchEnabled: false,
  notifyProjectUpdates: true,
  notifyRuntimeFailed: true,
  notifyFeedbackCreated: true,
  notifyLowEvaluations: true,
  notifyTaskDue: true,
  minimumPriority: "medium",
} as const;

export interface ProjectNotificationRuleDTO {
  id: string | null;
  userId: string;
  projectId: string;
  projectName?: string;
  watchEnabled: boolean;
  notifyProjectUpdates: boolean;
  notifyRuntimeFailed: boolean;
  notifyFeedbackCreated: boolean;
  notifyLowEvaluations: boolean;
  notifyTaskDue: boolean;
  minimumPriority: string;
  createdAt: string | null;
  updatedAt: string | null;
}

function mergeWithDefaults(row: {
  id: string;
  userId: string;
  projectId: string;
  watchEnabled: boolean;
  notifyProjectUpdates: boolean;
  notifyRuntimeFailed: boolean;
  notifyFeedbackCreated: boolean;
  notifyLowEvaluations: boolean;
  notifyTaskDue: boolean;
  minimumPriority: string;
  createdAt: Date;
  updatedAt: Date;
}): ProjectNotificationRuleDTO {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    watchEnabled: row.watchEnabled,
    notifyProjectUpdates: row.notifyProjectUpdates,
    notifyRuntimeFailed: row.notifyRuntimeFailed,
    notifyFeedbackCreated: row.notifyFeedbackCreated,
    notifyLowEvaluations: row.notifyLowEvaluations,
    notifyTaskDue: row.notifyTaskDue,
    minimumPriority: row.minimumPriority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function defaultRuleDTO(userId: string, projectId: string): ProjectNotificationRuleDTO {
  return {
    id: null,
    userId,
    projectId,
    watchEnabled: DEFAULT_PROJECT_RULE.watchEnabled,
    notifyProjectUpdates: DEFAULT_PROJECT_RULE.notifyProjectUpdates,
    notifyRuntimeFailed: DEFAULT_PROJECT_RULE.notifyRuntimeFailed,
    notifyFeedbackCreated: DEFAULT_PROJECT_RULE.notifyFeedbackCreated,
    notifyLowEvaluations: DEFAULT_PROJECT_RULE.notifyLowEvaluations,
    notifyTaskDue: DEFAULT_PROJECT_RULE.notifyTaskDue,
    minimumPriority: DEFAULT_PROJECT_RULE.minimumPriority,
    createdAt: null,
    updatedAt: null,
  };
}

/** 用于过滤逻辑：与 DB 行结构一致 */
export type EffectiveProjectRule = {
  watchEnabled: boolean;
  notifyProjectUpdates: boolean;
  notifyRuntimeFailed: boolean;
  notifyFeedbackCreated: boolean;
  notifyLowEvaluations: boolean;
  notifyTaskDue: boolean;
  minimumPriority: string;
};

export async function getEffectiveProjectRule(
  userId: string,
  projectId: string
): Promise<EffectiveProjectRule> {
  const row = await db.projectNotificationRule.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!row) {
    return { ...DEFAULT_PROJECT_RULE };
  }
  return {
    watchEnabled: row.watchEnabled,
    notifyProjectUpdates: row.notifyProjectUpdates,
    notifyRuntimeFailed: row.notifyRuntimeFailed,
    notifyFeedbackCreated: row.notifyFeedbackCreated,
    notifyLowEvaluations: row.notifyLowEvaluations,
    notifyTaskDue: row.notifyTaskDue,
    minimumPriority: row.minimumPriority,
  };
}

export async function loadProjectRulesMap(
  userId: string,
  projectIds: string[]
): Promise<Map<string, EffectiveProjectRule>> {
  const map = new Map<string, EffectiveProjectRule>();
  if (projectIds.length === 0) return map;
  const rows = await db.projectNotificationRule.findMany({
    where: { userId, projectId: { in: projectIds } },
  });
  for (const pid of projectIds) {
    map.set(pid, { ...DEFAULT_PROJECT_RULE });
  }
  for (const row of rows) {
    map.set(row.projectId, {
      watchEnabled: row.watchEnabled,
      notifyProjectUpdates: row.notifyProjectUpdates,
      notifyRuntimeFailed: row.notifyRuntimeFailed,
      notifyFeedbackCreated: row.notifyFeedbackCreated,
      notifyLowEvaluations: row.notifyLowEvaluations,
      notifyTaskDue: row.notifyTaskDue,
      minimumPriority: row.minimumPriority,
    });
  }
  return map;
}

export async function getProjectRuleDTO(
  userId: string,
  projectId: string,
  projectName?: string
): Promise<ProjectNotificationRuleDTO> {
  const row = await db.projectNotificationRule.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!row) {
    return { ...defaultRuleDTO(userId, projectId), projectName };
  }
  return { ...mergeWithDefaults(row), projectName };
}

export async function upsertProjectRule(
  userId: string,
  projectId: string,
  patch: Partial<{
    watchEnabled: boolean;
    notifyProjectUpdates: boolean;
    notifyRuntimeFailed: boolean;
    notifyFeedbackCreated: boolean;
    notifyLowEvaluations: boolean;
    notifyTaskDue: boolean;
    minimumPriority: string;
  }>
): Promise<ProjectNotificationRuleDTO> {
  const existing = await db.projectNotificationRule.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  const base = existing ?? {
    watchEnabled: DEFAULT_PROJECT_RULE.watchEnabled,
    notifyProjectUpdates: DEFAULT_PROJECT_RULE.notifyProjectUpdates,
    notifyRuntimeFailed: DEFAULT_PROJECT_RULE.notifyRuntimeFailed,
    notifyFeedbackCreated: DEFAULT_PROJECT_RULE.notifyFeedbackCreated,
    notifyLowEvaluations: DEFAULT_PROJECT_RULE.notifyLowEvaluations,
    notifyTaskDue: DEFAULT_PROJECT_RULE.notifyTaskDue,
    minimumPriority: DEFAULT_PROJECT_RULE.minimumPriority,
  };
  const row = await db.projectNotificationRule.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: {
      userId,
      projectId,
      watchEnabled: patch.watchEnabled ?? base.watchEnabled,
      notifyProjectUpdates: patch.notifyProjectUpdates ?? base.notifyProjectUpdates,
      notifyRuntimeFailed: patch.notifyRuntimeFailed ?? base.notifyRuntimeFailed,
      notifyFeedbackCreated: patch.notifyFeedbackCreated ?? base.notifyFeedbackCreated,
      notifyLowEvaluations: patch.notifyLowEvaluations ?? base.notifyLowEvaluations,
      notifyTaskDue: patch.notifyTaskDue ?? base.notifyTaskDue,
      minimumPriority: patch.minimumPriority ?? base.minimumPriority,
    },
    update: {
      ...(patch.watchEnabled !== undefined ? { watchEnabled: patch.watchEnabled } : {}),
      ...(patch.notifyProjectUpdates !== undefined
        ? { notifyProjectUpdates: patch.notifyProjectUpdates }
        : {}),
      ...(patch.notifyRuntimeFailed !== undefined
        ? { notifyRuntimeFailed: patch.notifyRuntimeFailed }
        : {}),
      ...(patch.notifyFeedbackCreated !== undefined
        ? { notifyFeedbackCreated: patch.notifyFeedbackCreated }
        : {}),
      ...(patch.notifyLowEvaluations !== undefined
        ? { notifyLowEvaluations: patch.notifyLowEvaluations }
        : {}),
      ...(patch.notifyTaskDue !== undefined ? { notifyTaskDue: patch.notifyTaskDue } : {}),
      ...(patch.minimumPriority !== undefined ? { minimumPriority: patch.minimumPriority } : {}),
    },
  });
  return mergeWithDefaults(row);
}

export async function listUserProjectRules(
  userId: string,
  filters?: { projectId?: string; watchEnabled?: boolean }
): Promise<ProjectNotificationRuleDTO[]> {
  const where: Record<string, unknown> = { userId };
  if (filters?.projectId) where.projectId = filters.projectId;
  if (filters?.watchEnabled !== undefined) where.watchEnabled = filters.watchEnabled;

  const rows = await db.projectNotificationRule.findMany({
    where,
    include: { project: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    ...mergeWithDefaults({
      id: r.id,
      userId: r.userId,
      projectId: r.projectId,
      watchEnabled: r.watchEnabled,
      notifyProjectUpdates: r.notifyProjectUpdates,
      notifyRuntimeFailed: r.notifyRuntimeFailed,
      notifyFeedbackCreated: r.notifyFeedbackCreated,
      notifyLowEvaluations: r.notifyLowEvaluations,
      notifyTaskDue: r.notifyTaskDue,
      minimumPriority: r.minimumPriority,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }),
    projectName: r.project.name,
  }));
}
