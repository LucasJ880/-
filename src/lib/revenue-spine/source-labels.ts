/**
 * Revenue Spine — 商机来源的中文标签、等待时长说法（页面与微信早报 / 提醒共用）
 *
 * 取值见 inquiry-intake OPPORTUNITY_SOURCES，另加其他入口写入的值（外贸线索转商机 "trade"、CRM 表格导入 "csv_import"）。
 * 本文件不引入 db，客户端页面可直接用。
 * 其余旧数据（如 CSV 里手填的来源）不在词表里时一律显示「其他」，不把原始值透传到微信。
 */

import type { OpportunitySource } from "./inquiry-intake";

export const OPPORTUNITY_SOURCE_LABELS: Record<OpportunitySource, string> = {
  website_inquiry: "官网",
  trade_show: "展会",
  email: "邮件",
  trade_intelligence: "企业情报",
  outbound: "主动开发",
  referral: "转介绍",
  existing_customer: "老客户",
  manual: "手工录入",
  import: "导入",
  whatsapp: "WhatsApp",
  wechat: "微信",
};

/** 另加不经 inquiry-intake 写入的来源值：trade（sales-conversion 外贸线索转商机）、csv_import（csv-import 未填来源列） */
const SOURCE_LABELS: Record<string, string> = { ...OPPORTUNITY_SOURCE_LABELS, trade: "外贸线索", csv_import: "表格导入" };

export function opportunitySourceLabel(source: string | null | undefined): string {
  if (!source) return "来源未知";
  return SOURCE_LABELS[source] ?? "其他";
}

/** 等待时长的中文说法（页面与 SLA 提醒共用）：不足 1 小时按分钟，不足 48 小时按小时，否则按天 */
export function formatWaitZh(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.floor(minutes))} 分钟`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} 小时`;
  return `${Math.floor(minutes / 1440)} 天`;
}
