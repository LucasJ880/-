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
  // INSTALL-2f：维修单作废 / 关闭不返修；返修逾期提醒
  "install_repair_closed",
  "install_repair_overdue",
  // COLLAB-2：@ 提及；任务指派 / 状态变化 / 新评论；工艺单阶段变化
  "mention",
  "task_assigned",
  "task_status",
  "task_comment",
  "order_stage",
  // T-1：询价进展（报价 / 回信无报价 / 催单待批 / 未响应）
  "rfq_quote_received",
  "rfq_reply_received",
  "rfq_chase_ready",
  "rfq_no_response",
] as const;

export type NotificationTypeKey = (typeof NOTIFICATION_TYPE_KEYS)[number];

export const DEFAULT_ENABLED_TYPES: string[] = [...NOTIFICATION_TYPE_KEYS];

/** 通知类型的中文名称：设置页开关与通知邮件共用 */
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  task_due: "任务截止与逾期",
  calendar_event: "日程与日历提醒",
  followup: "跟进提醒",
  project_update: "项目与配置变更",
  system: "系统通知（预留）",
  agent_task: "AI 任务通知",
  agent_approval: "AI 审批通知",
  quote_signed: "客户签署报价",
  sales_daily_briefing: "每日销售简报",
  install_completed: "安装完工（待收尾款）",
  install_balance_confirmed: "尾款已确认",
  install_warranty_sent: "质保邮件已发出",
  install_warranty_failed: "质保邮件未发出",
  install_repair_submitted: "返修单已提交",
  install_repair_factory_issued: "返修件已出单",
  install_repair_scheduled: "已安排返修",
  install_repair_closed: "维修单作废 / 关闭不返修",
  install_repair_overdue: "返修逾期提醒",
  mention: "@提及",
  task_assigned: "任务指派",
  task_status: "任务状态变化",
  task_comment: "任务新评论",
  order_stage: "工艺单阶段变化",
  rfq_quote_received: "供应商报价了",
  rfq_reply_received: "供应商回信（无报价）",
  rfq_chase_ready: "催单待批",
  rfq_no_response: "供应商未响应",
};

/** 类型名称；没有登记名称的类型统一叫「其他通知」 */
export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? "其他通知";
}

export const PRIORITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

export function priorityAtLeast(priority: string, minimum: string): boolean {
  return (PRIORITY_RANK[priority] ?? 1) >= (PRIORITY_RANK[minimum] ?? 1);
}
