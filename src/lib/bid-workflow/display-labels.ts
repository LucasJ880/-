/** 调查室展示用中文标签（禁止前端直接展示开发者 enum） */

export const CONFIDENCE_LABELS: Record<string, string> = {
  CONFIRMED: "已确认",
  HIGH_CONFIDENCE: "高可信",
  INFERRED: "推断",
  UNKNOWN: "未确认",
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  tender_document: "招标文件",
  historical: "历史采购",
  ai_inference: "AI 推断",
  manual: "人工录入",
};

export const MODULE_FIELD_LABELS: Record<string, string> = {
  projectName: "项目名称",
  tenderNumber: "招标编号",
  procuringAgency: "采购机构",
  endUser: "最终用户",
  product: "产品/服务",
  quantity: "数量",
  contractTerm: "合同期限",
  deliveryLocation: "交付地点",
  submissionPlatform: "提交平台",
  closeDate: "提交截止",
  questionCloseDate: "提问截止",
  mandatoryHighlights: "强制要点",
  initialAwardAmount: "初始中标金额",
  amendmentAmount: "变更金额",
  finalContractCeiling: "最终合同上限",
  currency: "币种",
  estimatedAnnualVolume: "预估年度采购额",
  guaranteedPurchase: "保证采购额",
  aiExplanation: "AI 说明",
  officialSource: "官方来源",
  awards: "中标记录",
  items: "交付物清单",
  humanDecision: "人工决定",
  aiSuggestion: "AI 建议",
  note: "备注",
  decidedById: "决定人",
  decidedAt: "决定时间",
};

/**
 * 项目 AI 对话深链。`?tab=ai` 是永久别名：详情页解析为
 * 「工作台 + 打开问青砚抽屉」（见 lib/tender/detail-tabs.ts 的 LEGACY_TAB_ALIASES）。
 */
export const PROJECT_AI_TAB_HREF_SUFFIX = "?tab=ai";

export function projectAiTabHref(projectId: string): string {
  return `/projects/${projectId}${PROJECT_AI_TAB_HREF_SUFFIX}`;
}

export function confidenceLabel(code: string | null | undefined): string {
  if (!code) return CONFIDENCE_LABELS.UNKNOWN;
  return CONFIDENCE_LABELS[code] || code;
}

export function sourceTypeLabel(code: string | null | undefined): string {
  if (!code) return "未注明";
  return SOURCE_TYPE_LABELS[code] || code;
}

export function fieldLabel(key: string): string {
  return MODULE_FIELD_LABELS[key] || key;
}

export function formatDisplayValue(value: unknown): string {
  if (value == null || value === "") return "暂无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "暂无";
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return value.map(String).join("；");
    }
    return `${value.length} 项`;
  }
  if (typeof value === "object") return "见详情";
  return String(value);
}
