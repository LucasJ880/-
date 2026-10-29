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
  "quote_signed",
  "sales_daily_briefing",
  // INSTALL-2b：装完待收尾款 / 尾款已确认
  "install_completed",
  "install_balance_confirmed",
  // INSTALL-2c：质保邮件已发出 / 未发出
  "install_warranty_sent",
  "install_warranty_failed",
  // INSTALL-2d：维修单已提交（出单 / 运营 / 会计 → 维修单详情；销售 → 工艺单状态卡）
  "install_repair_submitted",
  // INSTALL-2e：返修件已出单 / 已安排返修
  "install_repair_factory_issued",
  "install_repair_scheduled",
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
