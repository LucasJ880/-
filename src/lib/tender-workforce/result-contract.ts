/**
 * Tender T1B 结构化分析结果契约（任务书 §23）：tender-analysis-result/v1
 *
 * Tender Domain 层的最终结构化输出，由 finalize 工具（deterministic 组装
 * + zod 校验，fail-closed）写入 canonical TenderAnalysisRun.summaryJson。
 *
 * 明确不承载（§23）：hidden chain-of-thought / internal reasoning
 * transcript / 完整 prompt / tool internals。UI 只展示结论、来源、行动项。
 */

import { z } from "zod";

export const TENDER_ANALYSIS_RESULT_VERSION = "tender-analysis-result/v1";

export const TENDER_ANALYSIS_RESULT_LIMITS = {
  maxSummaryLength: 2000,
  maxListItems: 12,
  maxItemLength: 500,
  maxClarifications: 12,
} as const;

const boundedText = z
  .string()
  .min(1)
  .max(TENDER_ANALYSIS_RESULT_LIMITS.maxItemLength);

const boundedList = z
  .array(boundedText)
  .max(TENDER_ANALYSIS_RESULT_LIMITS.maxListItems);

/** 澄清建议（§21）：DRAFT ONLY，绝不自动发送 */
export const TenderClarificationDraftSchema = z
  .object({
    question: boundedText,
    reason: boundedText,
    source: z.string().max(300).optional(),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
    whyOwnerNeedsToAnswer: boundedText,
  })
  .strip();

export const TenderRiskItemSchema = z
  .object({
    severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "INFORMATIONAL"]),
    kind: z.enum([
      "MANDATORY_REQUIREMENT_MISSING",
      "CONTRADICTION",
      "AMBIGUOUS_SPECIFICATION",
      "ADDENDUM_CONFLICT",
      "MISSING_DOCUMENT",
      "SUBMISSION_RISK",
      "TECHNICAL_INCOMPATIBILITY",
      "COMMERCIAL_UNKNOWN",
      "OTHER",
    ]),
    statement: boundedText,
    /** source-linked（§18/§20）：文档标题/页码等可追溯描述 */
    source: z.string().max(300).optional(),
  })
  .strip();

export type TenderRiskItem = z.infer<typeof TenderRiskItemSchema>;

export const TenderAnalysisResultV1Schema = z
  .object({
    contractVersion: z.literal(TENDER_ANALYSIS_RESULT_VERSION),
    projectSummary: z
      .string()
      .min(1)
      .max(TENDER_ANALYSIS_RESULT_LIMITS.maxSummaryLength),
    /** 就绪度：基于证据的定性结论（非自动 GO/NO-GO 决策，§28） */
    readiness: z.enum(["READY_TO_REVIEW", "GAPS_FOUND", "BLOCKED"]),
    requirementsSummary: z
      .object({
        total: z.number().int().min(0),
        mandatory: z.number().int().min(0),
        evidenceRequired: z.number().int().min(0),
        sourceLinked: z.number().int().min(0),
      })
      .strip(),
    missingInformation: boundedList,
    criticalRisks: z.array(TenderRiskItemSchema).max(12),
    importantRisks: z.array(TenderRiskItemSchema).max(12),
    clarifications: z
      .array(TenderClarificationDraftSchema)
      .max(TENDER_ANALYSIS_RESULT_LIMITS.maxClarifications),
    submissionRisks: boundedList,
    recommendedNextActions: boundedList,
    sourceCoverage: z
      .object({
        documentCount: z.number().int().min(0),
        parsedPageCount: z.number().int().min(0),
        factCount: z.number().int().min(0),
        sourceRefCount: z.number().int().min(0),
      })
      .strip(),
    analysisLimitations: boundedList,
  })
  .strip();

export type TenderAnalysisResultV1 = z.infer<
  typeof TenderAnalysisResultV1Schema
>;

export function parseTenderAnalysisResultV1(
  value: unknown,
):
  | { ok: true; result: TenderAnalysisResultV1 }
  | { ok: false; error: string } {
  const parsed = TenderAnalysisResultV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: `tender-analysis-result/v1 校验失败：${parsed.error.message.slice(0, 400)}`,
    };
  }
  return { ok: true, result: parsed.data };
}
