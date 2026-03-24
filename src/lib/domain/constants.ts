/**
 * 业务常量单一真相源
 *
 * 所有状态枚举值、合法值集合集中在此。
 * 不要在代码中直接写 "pending_dispatch" 等字面量，统一引用这里。
 *
 * 当前场景：招投标项目管理（Tender / BidToGo）
 */

// ── 项目进线状态（intakeStatus） ─────────────────────────────

export const INTAKE_STATUS = {
  PENDING: "pending_dispatch",
  DISPATCHED: "dispatched",
} as const;

export type IntakeStatus = (typeof INTAKE_STATUS)[keyof typeof INTAKE_STATUS];

// ── 内部项目阶段键 ──────────────────────────────────────────

export const STAGES = {
  INITIATION: "initiation",
  DISTRIBUTION: "distribution",
  INTERPRETATION: "interpretation",
  SUPPLIER_INQUIRY: "supplier_inquiry",
  SUPPLIER_QUOTE: "supplier_quote",
  SUBMISSION: "submission",
} as const;

export type InternalStage = (typeof STAGES)[keyof typeof STAGES];

// ── 可放弃的阶段（从"项目解读"开始） ─────────────────────────

export const ABANDONABLE_STAGES: readonly string[] = [
  STAGES.INTERPRETATION,
  STAGES.SUPPLIER_INQUIRY,
  STAGES.SUPPLIER_QUOTE,
  STAGES.SUBMISSION,
];

// ── AI 推荐合法值 ────────────────────────────────────────────

export const VALID_RECOMMENDATIONS = [
  "pursue",
  "review_carefully",
  "low_probability",
  "skip",
] as const;

// ── AI 风险合法值 ────────────────────────────────────────────

export const VALID_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "unassessed",
] as const;

// ── 项目来源系统 ─────────────────────────────────────────────

export const SOURCE_SYSTEM = {
  BIDTOGO: "bidtogo",
} as const;

// ── 默认项目分类 ─────────────────────────────────────────────

export const DEFAULT_CATEGORY = "tender_opportunity";
