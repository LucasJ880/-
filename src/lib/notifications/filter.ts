import { DEFAULT_ENABLED_TYPES, priorityAtLeast } from "./constants";
import type { EffectiveProjectRule } from "./project-rules";

export interface PreferenceContext {
  enableInAppNotifications: boolean;
  onlyHighPriority: boolean;
  onlyMyItems: boolean;
  includeWatchedProjects: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  enabledTypes: Set<string>;
}

export function buildPreferenceContext(row: {
  enableInAppNotifications: boolean;
  onlyHighPriority: boolean;
  onlyMyItems: boolean;
  includeWatchedProjects: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  enabledTypesJson: string | null;
}): PreferenceContext {
  let types = new Set(DEFAULT_ENABLED_TYPES);
  if (row.enabledTypesJson) {
    try {
      const arr = JSON.parse(row.enabledTypesJson) as unknown;
      if (Array.isArray(arr) && arr.length > 0) {
        types = new Set(arr.filter((x) => typeof x === "string"));
      }
    } catch {
      /* keep default */
    }
  }
  return {
    enableInAppNotifications: row.enableInAppNotifications,
    onlyHighPriority: row.onlyHighPriority,
    onlyMyItems: row.onlyMyItems,
    includeWatchedProjects: row.includeWatchedProjects,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    enabledTypes: types,
  };
}

/** 解析 "HH:mm" 为当天分钟数 */
function toMinutes(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/** 当前是否处于静默时段（支持跨午夜，如 22:00–08:00） */
export function isInQuietHours(
  start: string | null,
  end: string | null,
  enabled: boolean,
  now: Date = new Date()
): boolean {
  if (!enabled || !start || !end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === b) return false;
  if (a < b) return cur >= a && cur < b;
  return cur >= a || cur < b;
}

export function breaksQuietHours(priority: string): boolean {
  return priority === "urgent" || priority === "high";
}

function passesGlobalPref(pref: PreferenceContext, notifType: string, priority: string): boolean {
  if (!pref.enableInAppNotifications) return false;
  if (!pref.enabledTypes.has(notifType)) return false;
  if (pref.onlyHighPriority && priority !== "high" && priority !== "urgent") return false;
  if (
    pref.quietHoursEnabled &&
    isInQuietHours(pref.quietHoursStart, pref.quietHoursEnd, true) &&
    !breaksQuietHours(priority)
  ) {
    return false;
  }
  return true;
}

function getRuleOrDefault(
  rulesMap: Map<string, EffectiveProjectRule>,
  projectId: string | null
): EffectiveProjectRule | null {
  if (!projectId) return null;
  return rulesMap.get(projectId) ?? null;
}

/** 提醒类通知（任务截止、日程、跟进） */
export function shouldAcceptReminderCandidate(
  pref: PreferenceContext,
  rulesMap: Map<string, EffectiveProjectRule>,
  input: {
    userId: string;
    notifType: "task_due" | "calendar_event" | "followup";
    priority: string;
    projectId: string | null;
    taskAssigneeId: string | null;
    taskCreatorId: string | null;
  }
): boolean {
  if (!passesGlobalPref(pref, input.notifType, input.priority)) return false;

  const rule = getRuleOrDefault(rulesMap, input.projectId);
  if (rule && !priorityAtLeast(input.priority, rule.minimumPriority)) return false;

  if (rule && !rule.notifyTaskDue) return false;

  if (pref.onlyMyItems) {
    if (input.notifType === "calendar_event") {
      return true;
    }
    if (input.taskAssigneeId || input.taskCreatorId) {
      const mine =
        input.taskAssigneeId === input.userId || input.taskCreatorId === input.userId;
      if (!mine) return false;
    }
  }

  return true;
}

export interface AuditFilterContext {
  action: string;
  notifType: "runtime_failed" | "feedback" | "project_update" | "evaluation_low";
  priority: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId?: string | null;
  /** 反馈相关：会话归属用户，无则 undefined */
  conversationUserId: string | null | undefined;
}

/** 审计类通知 */
export function shouldAcceptAuditCandidate(
  pref: PreferenceContext,
  rulesMap: Map<string, EffectiveProjectRule>,
  input: AuditFilterContext,
  recipientUserId: string
): boolean {
  if (!passesGlobalPref(pref, input.notifType, input.priority)) return false;

  const rule = getRuleOrDefault(rulesMap, input.projectId);
  if (!rule) {
    if (input.notifType === "project_update") return false;
    return true;
  }

  if (!priorityAtLeast(input.priority, rule.minimumPriority)) return false;

  switch (input.notifType) {
    case "runtime_failed":
      if (!rule.notifyRuntimeFailed) return false;
      break;
    case "evaluation_low":
      if (!rule.notifyLowEvaluations) return false;
      break;
    case "feedback":
      if (!rule.notifyFeedbackCreated) return false;
      break;
    case "project_update":
      if (!rule.notifyProjectUpdates) return false;
      if (input.projectOwnerId !== recipientUserId && !rule.watchEnabled) return false;
      break;
    default:
      return false;
  }

  if (pref.onlyMyItems) {
    if (input.notifType === "runtime_failed") {
      if (input.projectOwnerId === recipientUserId) return true;
      return pref.includeWatchedProjects && rule.watchEnabled;
    }
    if (input.notifType === "evaluation_low") {
      const mine =
        input.actorUserId === recipientUserId ||
        input.conversationUserId === recipientUserId;
      if (mine) return true;
      return pref.includeWatchedProjects && rule.watchEnabled;
    }
    if (input.notifType === "feedback") {
      const convMine = input.conversationUserId === recipientUserId;
      const watchedFeedback =
        pref.includeWatchedProjects && rule.watchEnabled && rule.notifyFeedbackCreated;
      if (convMine) return true;
      if (watchedFeedback) return true;
      return false;
    }
    if (input.notifType === "project_update") {
      if (input.projectOwnerId === recipientUserId) return true;
      return pref.includeWatchedProjects && rule.watchEnabled;
    }
  }

  return true;
}

type NotificationCandidate =
  | {
      kind: "reminder";
      payload: Parameters<typeof shouldAcceptReminderCandidate>[2];
    }
  | {
      kind: "audit";
      payload: AuditFilterContext;
    };

export function shouldCreateNotification(
  pref: PreferenceContext,
  rulesMap: Map<string, EffectiveProjectRule>,
  candidate: NotificationCandidate,
  userId: string
): boolean {
  if (candidate.kind === "reminder") {
    return shouldAcceptReminderCandidate(pref, rulesMap, candidate.payload);
  }
  return shouldAcceptAuditCandidate(pref, rulesMap, candidate.payload, userId);
}
