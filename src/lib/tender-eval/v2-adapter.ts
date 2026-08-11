/**
 * Benchmark → Tender Understanding V2 桥（考官侧代码）
 *
 * 方向约束：tender-eval 可以调用被试（V2）；V2 生产模块绝不 import tender-eval
 * （golden 是考卷不是训练数据）。本文件属于评估基础设施。
 */

import type {
  ClarificationCandidate,
  FactCandidate,
  RequirementCandidate,
} from "@/lib/tender-auto-analysis/extract/types";
import { analyzeTender, type AnalyzeOptions } from "@/lib/tender-understanding/analyzer";
import type {
  AnalysisResultV2,
  AnalyzerInput,
  DocumentSourceRole,
} from "@/lib/tender-understanding/contract";

import type { CaseDocumentRole, TenderEvalCase } from "./contract";
import type { SystemOutput } from "./evaluate";

const ROLE_MAP: Record<CaseDocumentRole, DocumentSourceRole> = {
  MAIN: "BASE_TENDER",
  ADDENDUM: "ADDENDUM",
  ANNEX: "SPECIFICATION",
  QA_RESPONSE: "ADDENDUM",
};

export function caseToAnalyzerInput(evalCase: TenderEvalCase): AnalyzerInput {
  return {
    projectId: `benchmark:${evalCase.caseId}`,
    documents: evalCase.documentSet.map((d) => ({
      documentId: d.documentId,
      name: d.title,
      type: "pdf",
      sourceRole: ROLE_MAP[d.role],
      pages: d.pages.map((p) => ({
        pageNumber: p.pageNumber,
        contentText: p.contentText,
      })),
      contentHash: null,
    })),
  };
}

const CONFIDENCE_MAP = {
  HIGH: "CONFIRMED",
  MEDIUM: "HIGH_CONFIDENCE",
  LOW: "INFERRED",
} as const;

export function v2ResultToSystemOutput(result: AnalysisResultV2): SystemOutput {
  const facts: FactCandidate[] = result.facts
    .filter((f) => f.status === "ACTIVE")
    .map((f) => {
      const fact: FactCandidate & { structuredJson?: unknown } = {
        factKey: `${f.factType}:${f.id}`,
        statementKind: "CONFIRMED_FACT",
        contentZh: f.claim,
        contentOriginal: f.rawValue ?? f.claim,
        confidence: CONFIDENCE_MAP[f.confidence],
        sourceRefs: f.evidence.map((e) => ({
          documentId: e.documentId,
          pageNumber: e.pageNumber,
          originalTextSnippet: e.snippet,
          sectionLabel: null,
          extractionMethod: "v2-llm-extract",
          confidence: CONFIDENCE_MAP[f.confidence],
        })),
      };
      if (f.normalizedValue) fact.structuredJson = f.normalizedValue;
      return fact;
    });

  const requirements: RequirementCandidate[] = result.requirements
    .filter((r) => r.status === "ACTIVE" || r.status === "NEEDS_REVIEW")
    .map((r) => ({
      requirementCode: r.id,
      category: r.category.toLowerCase(),
      originalRequirement: r.statement,
      chineseTranslation: r.statement,
      mandatory: r.mandatory === true,
      evidenceRequired: false,
      complianceStatus: "NOT_ASSESSED" as const,
      reviewStatus: "AI_EXTRACTED" as const,
      sourcePage: r.evidence[0]?.pageNumber ?? null,
      sourceRefs: r.evidence.map((e) => ({
        documentId: e.documentId,
        pageNumber: e.pageNumber,
        originalTextSnippet: e.snippet,
        sectionLabel: null,
        extractionMethod: "v2-llm-extract",
        confidence: CONFIDENCE_MAP[r.confidence],
      })),
    }));

  const clarifications: ClarificationCandidate[] = result.clarifications.map(
    (c) => ({
      question: c.question,
      reason: c.reason,
      priority: c.priority,
      enquiryDeadline: null,
      sourceRefs: c.supportingEvidence.map((e) => ({
        documentId: e.documentId,
        pageNumber: e.pageNumber,
        originalTextSnippet: e.snippet,
        sectionLabel: null,
        extractionMethod: "v2-clarify",
        confidence: "HIGH_CONFIDENCE" as const,
      })),
    }),
  );

  const riskLines = result.risks.map((r) => `${r.severity}: ${r.description}`);

  return { facts, requirements, clarifications, riskLines };
}

export type V2LaneRun = {
  output: SystemOutput;
  analyzerMeta: {
    analyzerVersion: string;
    models: string[];
    promptUsages: AnalysisResultV2["metadata"]["promptUsages"];
    llmCalls: number;
    llmFailures: number;
    windows: number;
    pages: number;
    wallTimeMs: number;
    inputChars: number;
    outputChars: number;
    rejectedCandidates: AnalysisResultV2["metadata"]["rejectedCandidates"];
    unknownSlots: string[];
    conflictCount: number;
    clarificationCount: number;
    resolvedAmbiguityCount: number;
  };
  result: AnalysisResultV2;
};

export async function runV2Lane(
  evalCase: TenderEvalCase,
  opts: AnalyzeOptions = {},
): Promise<V2LaneRun> {
  const input = caseToAnalyzerInput(evalCase);
  const { result } = await analyzeTender(input, opts);
  const unknownSlots = Object.entries(result.criticalFacts)
    .filter(([, slot]) => slot.status === "UNKNOWN")
    .map(([k]) => k);
  return {
    output: v2ResultToSystemOutput(result),
    analyzerMeta: {
      analyzerVersion: result.metadata.analyzerVersion,
      models: result.metadata.models,
      promptUsages: result.metadata.promptUsages,
      llmCalls: result.metadata.llmCalls,
      llmFailures: result.metadata.llmFailures,
      windows: result.metadata.windows,
      pages: result.metadata.pages,
      wallTimeMs: result.metadata.wallTimeMs,
      inputChars: result.metadata.inputChars,
      outputChars: result.metadata.outputChars,
      rejectedCandidates: result.metadata.rejectedCandidates,
      unknownSlots,
      conflictCount: result.conflicts.length,
      clarificationCount: result.clarifications.length,
      resolvedAmbiguityCount: result.resolvedAmbiguities.length,
    },
    result,
  };
}
