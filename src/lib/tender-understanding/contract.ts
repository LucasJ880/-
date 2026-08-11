/**
 * Tender Understanding V2 — 内部契约（tender-understanding/v2）
 *
 * 原则：
 * - LLM 负责理解；deterministic code 负责结构/归一化/去重/校验/状态约束；Evidence 负责证明。
 * - 一切 Mandatory Requirement / Critical Fact 必须 evidence-grounded；证据验不过 = 拒收。
 * - UNKNOWN 是一等合法结果；禁止默认值。
 * - 本模块不得 import tender-eval（benchmark 是考卷不是训练答案），
 *   也不得读取 V1 抽取结果（extract/facts.ts 等）做 refinement。
 *
 * 无 DB 依赖：本阶段（Shadow/Evaluation Mode）纯内存分析，
 * 持久化映射到既有 TenderAnalysisRun 体系留待 Release Gate 后（SCHEMA_CHANGE=NONE）。
 */

import { z } from "zod";

export const TENDER_UNDERSTANDING_VERSION = "tender-understanding/v2" as const;
export const TENDER_ANALYSIS_RESULT_VERSION = "tender-analysis-result/v2" as const;

/* ---------------------------------- 文档与页 ---------------------------------- */

export const DOCUMENT_SOURCE_ROLES = [
  "BASE_TENDER",
  "SPECIFICATION",
  "DRAWING",
  "ADDENDUM",
  "PRICING_FORM",
  "SUBMISSION_FORM",
  "OTHER",
] as const;
export type DocumentSourceRole = (typeof DOCUMENT_SOURCE_ROLES)[number];

export type AnalyzerPage = {
  pageNumber: number;
  contentText: string;
};

export type AnalyzerDocument = {
  documentId: string;
  name: string;
  /** 文件类型（pdf 等），信息性 */
  type: string;
  sourceRole: DocumentSourceRole;
  pages: AnalyzerPage[];
  contentHash?: string | null;
};

/** Analyzer 输入永远 project-scoped（不得跨 org / 跨 project 拉数据） */
export type AnalyzerInput = {
  projectId: string;
  documents: AnalyzerDocument[];
};

export type DocumentManifestEntry = {
  documentId: string;
  name: string;
  type: string;
  sourceRole: DocumentSourceRole;
  pageCount: number;
  contentHash: string | null;
};

export type DocumentManifest = {
  projectId: string;
  parseVersion: string;
  documents: DocumentManifestEntry[];
};

/* ---------------------------------- Evidence ---------------------------------- */

export const evidenceRefSchema = z.object({
  documentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  /** 源页逐字片段（允许 whitespace 归一化后匹配） */
  snippet: z.string().min(1).max(600),
});
export type EvidenceRefV2 = z.infer<typeof evidenceRefSchema>;

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export type ConfidenceV2 = z.infer<typeof confidenceSchema>;

/* ---------------------------------- Critical Fact 槽位 ---------------------------------- */

export const CRITICAL_FACT_TYPES = [
  "buyer",
  "tender_number",
  "project_title",
  "closing_datetime",
  "question_deadline",
  "site_visit",
  "location",
  "scope",
  "quantity",
  "contract_duration",
  "delivery",
  "installation",
  "warranty",
  "bond",
  "insurance",
  "submission_method",
  "pricing_method",
  "addenda",
] as const;
export type CriticalFactType = (typeof CRITICAL_FACT_TYPES)[number];

export const factTypeSchema = z.enum([...CRITICAL_FACT_TYPES, "other"]);
export type FactTypeV2 = z.infer<typeof factTypeSchema>;

/* ---------------------------------- LLM 候选（Pass 1 输出） ---------------------------------- */

export const factCandidateSchema = z.object({
  factType: factTypeSchema,
  claim: z.string().min(1).max(500),
  /** 原文值（如 "January 5, 2030 10:00 EST"，仅格式示例）；无则 null */
  rawValue: z.string().max(300).nullable(),
  sourceDocumentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  sourceSnippet: z.string().min(1).max(600),
  confidence: confidenceSchema,
});
export type FactCandidateV2 = z.infer<typeof factCandidateSchema>;

export const REQUIREMENT_CATEGORIES = [
  "ADMINISTRATIVE",
  "SUBMISSION",
  "MANDATORY",
  "TECHNICAL",
  "PRODUCT",
  "PERFORMANCE",
  "INSTALLATION",
  "DELIVERY",
  "WARRANTY",
  "BONDING",
  "INSURANCE",
  "SAFETY",
  "SAMPLES",
  "SHOP_DRAWINGS",
  "TRAINING",
  "PRICING",
  "COMMERCIAL",
  "SITE_VISIT",
  "SCHEDULE",
  "REPORTING",
  "OTHER",
] as const;
export const requirementCategorySchema = z.enum(REQUIREMENT_CATEGORIES);
export type RequirementCategoryV2 = z.infer<typeof requirementCategorySchema>;

/** mandatory = true / false / "uncertain"；uncertain 不得强行 true */
export const mandatorySchema = z.union([
  z.literal(true),
  z.literal(false),
  z.literal("uncertain"),
]);
export type MandatoryV2 = z.infer<typeof mandatorySchema>;

export const requirementCandidateSchema = z.object({
  category: requirementCategorySchema,
  statement: z.string().min(8).max(600),
  actor: z.string().max(120).nullable(),
  action: z.string().max(200).nullable(),
  object: z.string().max(200).nullable(),
  mandatory: mandatorySchema,
  /** 原文触发依据（"must" / "will be rejected" / "condition of bid" 等原句） */
  mandatorySignal: z.string().max(300).nullable(),
  deadline: z.string().max(120).nullable(),
  quantity: z.string().max(120).nullable(),
  unit: z.string().max(60).nullable(),
  submissionStage: z.string().max(120).nullable(),
  technicalArea: z.string().max(120).nullable(),
  /** ADDENDUM 文档中的修订语义（无则 null） */
  revisionAction: z
    .enum(["CHANGES", "REPLACES", "REVISES", "EXTENDS", "DELETES"])
    .nullable(),
  /** 修订对象的原文提示（如被改条款的编号/主题），无则 null */
  revisionTargetHint: z.string().max(300).nullable(),
  sourceDocumentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  sourceSnippet: z.string().min(1).max(600),
  confidence: confidenceSchema,
});
export type RequirementCandidateV2 = z.infer<typeof requirementCandidateSchema>;

export const riskCandidateSchema = z.object({
  riskType: z.enum([
    "MANDATORY_MISSING",
    "DEADLINE",
    "CONTRADICTION",
    "AMBIGUITY",
    "MISSING_FORM",
    "TECHNICAL",
    "COMPLIANCE",
    "COMMERCIAL",
    "SUBMISSION",
    "ADDENDUM_CONFLICT",
    "EVIDENCE_GAP",
  ]),
  description: z.string().min(8).max(500),
  sourceDocumentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  sourceSnippet: z.string().min(1).max(600),
  confidence: confidenceSchema,
});
export type RiskCandidateV2 = z.infer<typeof riskCandidateSchema>;

export const ambiguityCandidateSchema = z.object({
  topic: z.string().min(3).max(200),
  description: z.string().min(8).max(500),
  /** 何为未知（Clarification.whatIsUnknown 的来源） */
  whatIsUnknown: z.string().min(3).max(300),
  sourceDocumentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  sourceSnippet: z.string().min(1).max(600),
  confidence: confidenceSchema,
});
export type AmbiguityCandidateV2 = z.infer<typeof ambiguityCandidateSchema>;

/** 单窗口抽取输出（LLM Pass 1 structured output） */
export const extractionOutputSchema = z.object({
  facts: z.array(factCandidateSchema).max(60).default([]),
  requirements: z.array(requirementCandidateSchema).max(80).default([]),
  potentialRisks: z.array(riskCandidateSchema).max(30).default([]),
  ambiguities: z.array(ambiguityCandidateSchema).max(30).default([]),
});
export type ExtractionOutputV2 = z.infer<typeof extractionOutputSchema>;

/** 澄清解决检查输出（corpus resolution pass） */
export const resolutionOutputSchema = z.object({
  resolved: z.boolean(),
  answerSummary: z.string().max(400).nullable(),
  answerDocumentId: z.string().nullable(),
  answerPageNumber: z.number().int().positive().nullable(),
  answerSnippet: z.string().max(600).nullable(),
});
export type ResolutionOutputV2 = z.infer<typeof resolutionOutputSchema>;

/* ---------------------------------- 归一化值 ---------------------------------- */

export type NormalizedValueV2 =
  | { kind: "date"; value: string }
  | { kind: "datetime"; date: string; time: string | null; tz: string | null }
  | { kind: "money"; amount: number; currency: string | null }
  | { kind: "quantity"; value: number; unit: string | null }
  | { kind: "duration_days"; days: number }
  | { kind: "percent"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

/* ---------------------------------- 已验证业务对象 ---------------------------------- */

export type DocumentFactV2 = {
  id: string;
  factType: FactTypeV2;
  claim: string;
  rawValue: string | null;
  normalizedValue: NormalizedValueV2 | null;
  confidence: ConfidenceV2;
  evidence: EvidenceRefV2[];
  sourceRole: DocumentSourceRole;
  status: "ACTIVE" | "SUPERSEDED" | "CONFLICT";
};

export type RequirementStatusV2 =
  | "ACTIVE"
  | "SUPERSEDED"
  | "CONFLICT"
  | "NEEDS_REVIEW";

export type TenderRequirementV2 = {
  id: string;
  category: RequirementCategoryV2;
  statement: string;
  actor: string | null;
  action: string | null;
  object: string | null;
  mandatory: MandatoryV2;
  mandatorySignal: string | null;
  deadline: string | null;
  quantity: string | null;
  unit: string | null;
  submissionStage: string | null;
  technicalArea: string | null;
  status: RequirementStatusV2;
  /** SUPERSEDED 时指向替代者 */
  supersededById: string | null;
  evidence: EvidenceRefV2[];
  confidence: ConfidenceV2;
};

export type RiskSeverityV2 = "CRITICAL" | "IMPORTANT" | "MINOR";

export type RiskV2 = {
  id: string;
  severity: RiskSeverityV2;
  riskType: RiskCandidateV2["riskType"];
  description: string;
  relatedRequirementIds: string[];
  relatedFactIds: string[];
  evidence: EvidenceRefV2[];
  /** 简明依据（非 chain-of-thought） */
  reasonCode: string;
};

export type ClarificationV2 = {
  id: string;
  question: string;
  reason: string;
  priority: "BLOCKING" | "HIGH" | "MEDIUM";
  relatedRequirementIds: string[];
  supportingEvidence: EvidenceRefV2[];
  whatIsUnknown: string;
  businessImpact: string;
};

export type UnknownV2 = {
  field: CriticalFactType | string;
  note: string;
};

export type AddendumChangeV2 = {
  id: string;
  addendumDocumentId: string;
  action: NonNullable<RequirementCandidateV2["revisionAction"]> | "SUPERSEDES";
  supersededRequirementId: string | null;
  activeRequirementId: string | null;
  note: string;
  evidence: EvidenceRefV2[];
};

export type ConflictV2 = {
  id: string;
  topic: string;
  itemIds: string[];
  values: string[];
  resolution: "RESOLVED_BY_ADDENDUM" | "UNRESOLVED";
  note: string;
};

export type CriticalFactSlotV2 =
  | { status: "KNOWN"; factId: string }
  | { status: "UNKNOWN" };

export type PromptUsage = {
  promptName: string;
  promptVersion: string;
  calls: number;
};

export type AnalysisMetadataV2 = {
  analyzerVersion: typeof TENDER_UNDERSTANDING_VERSION;
  resultVersion: typeof TENDER_ANALYSIS_RESULT_VERSION;
  projectId: string;
  startedAt: string;
  finishedAt: string;
  wallTimeMs: number;
  llmCalls: number;
  llmFailures: number;
  models: string[];
  promptUsages: PromptUsage[];
  pages: number;
  windows: number;
  /** 证据验证拒收统计（观测用，不进业务列表） */
  rejectedCandidates: { reasonCode: string; count: number }[];
  inputChars: number;
  outputChars: number;
};

export type AnalysisResultV2 = {
  contractVersion: typeof TENDER_ANALYSIS_RESULT_VERSION;
  manifest: DocumentManifest;
  projectSummary: string;
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>;
  facts: DocumentFactV2[];
  requirements: TenderRequirementV2[];
  /** ACTIVE 且 mandatory===true 的 requirement id 视图 */
  mandatoryRequirementIds: string[];
  unknowns: UnknownV2[];
  risks: RiskV2[];
  clarifications: ClarificationV2[];
  /** 已在语料内解决、因此未生成澄清的歧义（含答案证据） */
  resolvedAmbiguities: {
    topic: string;
    answerSummary: string;
    evidence: EvidenceRefV2[];
  }[];
  addendumChanges: AddendumChangeV2[];
  conflicts: ConflictV2[];
  submissionChecklist: { requirementId: string; statement: string }[];
  evidenceCoverage: {
    factsWithEvidence: number;
    factsTotal: number;
    requirementsWithEvidence: number;
    requirementsTotal: number;
  };
  limitations: string[];
  nextActions: string[];
  metadata: AnalysisMetadataV2;
};
