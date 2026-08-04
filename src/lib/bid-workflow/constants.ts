/** Phase 1 投标工作流状态（Project.bidPhaseStatus） */
export const BID_PHASE_STATUSES = [
  "DISCOVERED",
  "INTAKE_INCOMPLETE",
  "READY_FOR_QUALIFICATION",
  "INTELLIGENCE_IN_PROGRESS",
  "GO",
  "HOLD",
  "NO_GO",
  "BID_PREPARATION",
  "SUBMITTED",
  "AWARDED",
  "LOST",
  "WITHDRAWN",
] as const;

export type BidPhaseStatus = (typeof BID_PHASE_STATUSES)[number];

export const GO_DECISIONS = ["GO", "HOLD", "NO_GO"] as const;
export type GoDecision = (typeof GO_DECISIONS)[number];

export const FACT_CONFIDENCE = [
  "CONFIRMED",
  "HIGH_CONFIDENCE",
  "INFERRED",
  "UNKNOWN",
] as const;
export type FactConfidence = (typeof FACT_CONFIDENCE)[number];

export const MODULE_STATUS = [
  "confirmed",
  "investigating",
  "risk",
  "unknown",
] as const;
export type ModuleStatus = (typeof MODULE_STATUS)[number];

export const INTELLIGENCE_MODULES = [
  {
    key: "project_understanding",
    title: "项目理解",
    sortOrder: 1,
  },
  {
    key: "series_identification",
    title: "项目系列识别",
    sortOrder: 2,
  },
  {
    key: "contract_value",
    title: "合同价值解释",
    sortOrder: 3,
  },
  {
    key: "historical_awards",
    title: "历史中标调查",
    sortOrder: 4,
  },
  {
    key: "competitor_profile",
    title: "竞争对手画像",
    sortOrder: 5,
  },
  {
    key: "supply_chain",
    title: "供应链调查",
    sortOrder: 6,
  },
  {
    key: "commercial_judgment",
    title: "商业判断",
    sortOrder: 7,
  },
  {
    key: "deliverables",
    title: "执行文件",
    sortOrder: 8,
  },
] as const;

export type IntelligenceModuleKey =
  (typeof INTELLIGENCE_MODULES)[number]["key"];

export const TASK_TEMPLATE_KEYS = {
  summary: "bid_intel:initial_summary",
  historical: "bid_intel:historical_procurement",
  supplier_match: "bid_intel:supplier_match",
  go_analysis: "bid_intel:go_hold_nogo_analysis",
} as const;

/** GO 决策 → 既有 aiAdviceStatus 映射（不直改 tenderStatus） */
export function goDecisionToAiAdvice(
  d: GoDecision,
): "advance" | "conditional" | "abandon" {
  if (d === "GO") return "advance";
  if (d === "HOLD") return "conditional";
  return "abandon";
}

export function isBidPhaseStatus(v: string): v is BidPhaseStatus {
  return (BID_PHASE_STATUSES as readonly string[]).includes(v);
}

export function isGoDecision(v: string): v is GoDecision {
  return (GO_DECISIONS as readonly string[]).includes(v);
}
