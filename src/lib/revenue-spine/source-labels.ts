/**
 * Revenue Spine — 商机来源的中文标签（页面与微信早报共用）
 *
 * 取值见 inquiry-intake OPPORTUNITY_SOURCES。本文件不引入 db，客户端页面可直接用。
 * 旧数据（如销售 CRM 手填的来源）不在词表里时一律显示「其他」，不把原始值透传到微信。
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
};

export function opportunitySourceLabel(source: string | null | undefined): string {
  if (!source) return "来源未知";
  return (OPPORTUNITY_SOURCE_LABELS as Record<string, string>)[source] ?? "其他";
}
