/**
 * Tender Analyst Synthesis V1 — 投标人视角综合解读的 versioned 契约
 *
 * 定位：V2 Grounding Engine 之上的 Analyst 层。
 *   - Grounding Engine 决定「证据是什么」（facts/requirements/risks/clarifications，全部带 ID+证据）；
 *   - Analyst 决定「什么重要、怎么解释、如何分组、下一步做什么」，输出简体中文。
 *
 * HARD RULE（§6）：Analyst 不得发明新证据。每个事实性结论必须通过 supporting IDs
 * 关联既有 canonical 实体；server 端 hydrate 出 document/page/snippet。
 * 校验见 validate.ts；无 supporting ID 的关键结论不得持久化。
 *
 * 存储：TenderAnalysisRun.summaryJson.analystSynthesis（无 DB schema 变更）。
 */

import { z } from "zod";

export const TENDER_ANALYST_SYNTHESIS_VERSION = "tender-analyst-synthesis/v1" as const;
export const ANALYST_PROMPT_NAME = "tender-analyst-synthesis" as const;
export const ANALYST_PROMPT_VERSION = "2" as const;
export const ANALYST_QA_PROMPT_NAME = "tender-analyst-qa" as const;
export const ANALYST_QA_PROMPT_VERSION = "2" as const;

/* ------------------------------- 枚举 ------------------------------- */

export const ANALYST_PHASES = [
  "BID_SUBMISSION",
  "PRE_AWARD",
  "TECHNICAL_COMPLIANCE",
  "DELIVERY_EXECUTION",
  "POST_AWARD",
  "GENERAL_CONTRACT",
] as const;
export type AnalystPhase = (typeof ANALYST_PHASES)[number];

export const ANALYST_IMPACTS = [
  "BID_FATAL",
  "BID_REQUIRED",
  "SCORING",
  "COST_IMPACT",
  "DELIVERY_IMPACT",
  "CONTRACT_ONLY",
  "INFORMATIONAL",
] as const;
export type AnalystImpact = (typeof ANALYST_IMPACTS)[number];

export const ANALYST_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type AnalystSeverity = (typeof ANALYST_SEVERITIES)[number];

export const ASSESSMENT_STATUSES = [
  "READY_TO_PRICE",
  "NEEDS_CLARIFICATION",
  "BLOCKED_BY_MISSING_SOURCE",
  "BLOCKED_BY_CONFLICT",
  "INSUFFICIENT_INFORMATION",
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

/* --------------------------- LLM 输出 schema --------------------------- */

const zhText = (max: number) => z.string().min(1).max(max);

const keyItemSchema = z.object({
  id: z.string().min(1).max(60),
  titleZh: zhText(120),
  explanationZh: zhText(600),
  whyItMattersZh: zhText(400),
  phase: z.enum(ANALYST_PHASES),
  impact: z.enum(ANALYST_IMPACTS),
  severity: z.enum(ANALYST_SEVERITIES),
  supportingRequirementIds: z.array(z.string()).max(20).default([]),
  supportingFactIds: z.array(z.string()).max(20).default([]),
  supportingRiskIds: z.array(z.string()).max(20).default([]),
});
export type AnalystKeyItem = z.infer<typeof keyItemSchema>;

const riskGapSchema = z.object({
  titleZh: zhText(120),
  explanationZh: zhText(600),
  impactZh: zhText(400),
  recommendedActionZh: zhText(400),
  severity: z.enum(ANALYST_SEVERITIES),
  supportingIds: z.array(z.string()).max(20).default([]),
});
export type AnalystRiskGap = z.infer<typeof riskGapSchema>;

const clarificationSchema = z.object({
  questionZh: zhText(400),
  reasonZh: zhText(400),
  ifNotResolvedZh: zhText(400),
  priority: z.enum(["BLOCKING", "HIGH", "MEDIUM", "LOW"]),
  clarificationIds: z.array(z.string()).max(10).default([]),
  supportingIds: z.array(z.string()).max(20).default([]),
});
export type AnalystClarification = z.infer<typeof clarificationSchema>;

const nextActionSchema = z.object({
  order: z.number().int().min(1).max(20),
  actionZh: zhText(200),
  reasonZh: zhText(300),
  targetArea: z.enum(["requirements", "clarifications", "files", "bid", "intel", "other"]),
});
export type AnalystNextAction = z.infer<typeof nextActionSchema>;

/** PASS A / PASS B 共用的 LLM 输出 schema（coverage/qa 由 server 填充，LLM 不产出） */
export const analystLlmOutputSchema = z.object({
  executiveBrief: z.object({
    oneLinerZh: zhText(200),
    whatIsBeingBoughtZh: zhText(500),
    bidderTakeawayZh: zhText(500),
    keyPoints: z.array(zhText(240)).max(8).default([]),
  }),
  scope: z.object({
    overviewZh: zhText(800),
    deliverables: z.array(zhText(240)).max(20).default([]),
    quantities: z.array(zhText(240)).max(20).default([]),
    deliveryScope: z.array(zhText(240)).max(20).default([]),
    exclusionsOrUnknowns: z.array(zhText(240)).max(20).default([]),
  }),
  keyRequirements: z.array(keyItemSchema).max(40).default([]),
  technicalRequirements: z.array(keyItemSchema).max(40).default([]),
  commercialAndDelivery: z.array(keyItemSchema).max(40).default([]),
  risksAndGaps: z.array(riskGapSchema).max(15).default([]),
  clarifications: z.array(clarificationSchema).max(15).default([]),
  currentAssessment: z.object({
    status: z.enum(ASSESSMENT_STATUSES),
    summaryZh: zhText(800),
    reasons: z.array(zhText(300)).max(10).default([]),
    mustResolveBeforePricing: z.array(zhText(300)).max(10).default([]),
  }),
  nextActions: z.array(nextActionSchema).max(10).default([]),
});
export type AnalystLlmOutput = z.infer<typeof analystLlmOutputSchema>;

/** PASS B（QA）输出：审校后的完整替换 + 问题列表 */
export const analystQaOutputSchema = z.object({
  verdict: z.enum(["APPROVE", "REVISED"]),
  issues: z.array(z.string().max(300)).max(30).default([]),
  needsHumanReview: z.boolean().default(false),
  /** verdict=REVISED 时给出完整修订版；APPROVE 时可省略 */
  revised: analystLlmOutputSchema.nullable().default(null),
});
export type AnalystQaOutput = z.infer<typeof analystQaOutputSchema>;

/* --------------------------- 持久化形态 --------------------------- */

/** hydrate 后附着于关键结论的证据（server 由 supporting IDs 解析，LLM 不产出） */
export type AnalystEvidenceRef = {
  kind: "requirement" | "fact" | "risk" | "clarification";
  entityId: string;
  /** 原文陈述（requirement.statement / fact.claim …），不翻译不篡改 */
  statement: string;
  evidence: Array<{
    documentId: string;
    documentName: string | null;
    pageNumber: number | null;
    snippet: string | null;
  }>;
};

export type AnalystCoverage = {
  uploaded: number;
  eligible: number;
  analyzed: number;
  excluded: Array<{
    filename: string;
    fileType: string | null;
    parseStatus: string | null;
    contentHashReady: boolean;
    pageCount: number | null;
    exclusionReason: string;
  }>;
};

export type AnalystQaBlock = {
  status: "PASS" | "REVISED" | "NEEDS_HUMAN_REVIEW" | "SKIPPED";
  issues: string[];
  needsHumanReview: boolean;
};

/** 最终存入 summaryJson.analystSynthesis 的对象 */
export type TenderAnalystSynthesisV1 = AnalystLlmOutput & {
  version: typeof TENDER_ANALYST_SYNTHESIS_VERSION;
  language: "zh-CN";
  coverage: AnalystCoverage;
  qa: AnalystQaBlock;
  /** supporting ID → hydrated 证据（Evidence Drawer 数据源） */
  evidenceIndex: Record<string, AnalystEvidenceRef>;
  telemetry: {
    analystLatencyMs: number;
    reviewLatencyMs: number;
    totalLlmCalls: number;
    llmFailures: number;
    model: string | null;
  };
};

/** summaryJson 读取器（旧 run 无该字段 → null，安全 fallback legacy 视图） */
export function readAnalystSynthesis(
  summaryJson: unknown,
): TenderAnalystSynthesisV1 | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const raw = (summaryJson as Record<string, unknown>).analystSynthesis;
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>).version;
  if (v !== TENDER_ANALYST_SYNTHESIS_VERSION) return null;
  return raw as TenderAnalystSynthesisV1;
}
