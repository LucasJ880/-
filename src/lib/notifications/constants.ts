/** 站内通知类型（与 Notification.type 一致） */
export const NOTIFICATION_TYPE_KEYS = [
  "task_due",
  "calendar_event",
  "followup",
  "runtime_failed",
  "evaluation_low",
  "feedback",
  "project_update",
  "system",
  "agent_task",
  "agent_approval",
] as const;

export type NotificationTypeKey = (typeof NOTIFICATION_TYPE_KEYS)[number];

export const DEFAULT_ENABLED_TYPES: string[] = [...NOTIFICATION_TYPE_KEYS];

export const PRIORITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

export function priorityAtLeast(priority: string, minimum: string): boolean {
  return (PRIORITY_RANK[priority] ?? 1) >= (PRIORITY_RANK[minimum] ?? 1);
}
