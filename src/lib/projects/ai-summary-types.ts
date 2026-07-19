/** AI 建议态（不覆盖正式 tenderStatus） */
export const AI_ADVICE_STATUSES = [
  "advance",
  "conditional",
  "wait_info",
  "abandon",
] as const;
export type AiAdviceStatus = (typeof AI_ADVICE_STATUSES)[number];

export const AI_ADVICE_LABELS: Record<AiAdviceStatus, string> = {
  advance: "推进",
  conditional: "条件推进",
  wait_info: "等待信息",
  abandon: "放弃",
};

export const PROJECT_TYPE_TAGS = [
  "standard_supply",
  "long_term_supply",
  "install",
  "china_sourcing",
  "custom_manufacture",
] as const;
export type ProjectTypeTag = (typeof PROJECT_TYPE_TAGS)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectTypeTag, string> = {
  standard_supply: "标准产品供货",
  long_term_supply: "长期供应",
  install: "工程供货与安装",
  china_sourcing: "中国采购与进口",
  custom_manufacture: "定制制造",
};

/** 写入 ProjectIntelligence.structuredSummaryJson */
export type StructuredProjectSummary = {
  version: 1;
  aiAdviceStatus: AiAdviceStatus;
  projectTypes: ProjectTypeTag[];
  currentAdvice: string;
  biggestOpportunity: string | null;
  biggestRisk: string | null;
  missingInfo: string[];
  nextSteps: string[];
  similarCount: number;
  baseAnalysis: Record<string, unknown>;
  sections: {
    longTermSupply?: Record<string, unknown>;
    install?: Record<string, unknown>;
    chinaSourcing?: Record<string, unknown>;
  };
  updatedAt: string;
};

export function mapRecommendationToAdvice(
  recommendation: string | null | undefined,
): AiAdviceStatus {
  const r = (recommendation || "").toLowerCase();
  if (r === "pursue" || r.includes("投标") && r.includes("建议")) return "advance";
  if (r === "skip" || r.includes("放弃")) return "abandon";
  if (r === "low_probability") return "wait_info";
  if (r === "review_carefully" || r.includes("审慎")) return "conditional";
  return "conditional";
}
