/**
 * INSTALL-2d：安装阶段（纯函数，查表）
 *
 * UI、接口、通知、维修单列表与工艺单状态卡共用这一张表（任务书 §5；design D8）。
 * "待收尾款"与 2b 的会计列表同一规则：已安装；或已完工且当前安装预约有完成收口记录（§12 Q11）。
 * 2e 在此表上补"已出单 / 已排返修"。
 */

export const INSTALL_STAGES = [
  "not_scheduled",
  "scheduled",
  "repair_open",
  "repair_ready_to_schedule",
  "awaiting_balance",
  "closed",
  "cancelled",
] as const;
export type InstallStage = (typeof INSTALL_STAGES)[number];

export const STAGE_LABEL: Record<InstallStage, string> = {
  not_scheduled: "未排安装",
  scheduled: "已排期",
  repair_open: "返修待出单",
  repair_ready_to_schedule: "返修待排期",
  awaiting_balance: "待收尾款",
  closed: "已结清",
  cancelled: "已取消",
};

export type StageInput = {
  orderStatus: string;
  /** 有尾款确认记录（install.balance.confirmed） */
  balanceConfirmed: boolean;
  /** 当前安装预约有完成收口记录（install.task.completed，结果不是 needs_repair） */
  closedOut: boolean;
  /** 未关闭的维修单（2d：所有已提交的都未关闭）；needsFactory = 含需工厂行 */
  openRepair: { needsFactory: boolean } | null;
};

export function installStage(i: StageInput): InstallStage {
  if (i.orderStatus === "cancelled") return "cancelled";
  if (i.balanceConfirmed) return "closed";
  if (i.orderStatus === "installed") return "awaiting_balance";
  if (i.orderStatus === "completed") return i.closedOut ? "awaiting_balance" : "closed";
  if (i.orderStatus === "scheduled") {
    if (!i.openRepair) return "scheduled";
    return i.openRepair.needsFactory ? "repair_open" : "repair_ready_to_schedule";
  }
  // draft / confirmed / in_production / ready
  return "not_scheduled";
}

export type WarrantyBrief = "sent" | "pending_approval" | "not_sent";

const WARRANTY_TEXT: Record<WarrantyBrief, string> = {
  sent: "质保邮件已发送",
  pending_approval: "质保邮件待批准",
  not_sent: "质保邮件未发出",
};

/** 销售文案（spec「阶段文案」）；日期为 YYYY-MM-DD */
export function salesStageText(
  stage: InstallStage,
  ctx: { installDate?: string | null; targetDate?: string | null; balanceConfirmed?: boolean; warranty?: WarrantyBrief | null } = {},
): string {
  switch (stage) {
    case "not_scheduled":
      return "未排安装";
    case "scheduled":
      return ctx.installDate ? `已排 ${ctx.installDate} 安装` : "已排期";
    case "repair_open":
    case "repair_ready_to_schedule":
      return ctx.targetDate ? `返修中，目标 ${ctx.targetDate}` : "返修中";
    case "awaiting_balance":
      return "已装完，收尾款";
    case "closed":
      if (!ctx.balanceConfirmed) return "已完工";
      return `已结清 · ${WARRANTY_TEXT[ctx.warranty ?? "not_sent"]}`;
    case "cancelled":
      return "已取消";
  }
}
