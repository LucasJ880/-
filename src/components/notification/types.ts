export interface NotificationItem {
  id: string;
  userId: string;
  orgId: string | null;
  projectId: string | null;
  type: string;
  category: string;
  title: string;
  summary: string | null;
  entityType: string | null;
  entityId: string | null;
  activityId: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  snoozeUntil: string | null;
  readAt: string | null;
  doneAt: string | null;
  sourceKey: string | null;
  metadata: string | null;
  createdAt: string;
}

export type NotificationStatus = "unread" | "read" | "done" | "snoozed";
export type NotificationAction = "mark_read" | "mark_done" | "snooze";
