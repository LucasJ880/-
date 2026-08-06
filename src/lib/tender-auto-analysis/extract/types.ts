/**
 * 纯抽取层候选类型（不依赖 DB）
 */

import type {
  ConfidenceLevel,
  ClarificationPriority,
  StatementKind,
} from "../constants";

export type PageInput = {
  documentId: string;
  pageNumber: number;
  contentText: string;
};

export type SourceRefCandidate = {
  documentId: string;
  pageNumber: number;
  originalTextSnippet: string;
  sectionLabel?: string | null;
  extractionMethod: string;
  confidence: ConfidenceLevel;
};

export type FactCandidate = {
  /** 稳定业务键（同 run 内去重） */
  factKey: string;
  statementKind: StatementKind;
  contentZh: string;
  contentOriginal: string | null;
  confidence: ConfidenceLevel;
  sourceRefs: SourceRefCandidate[];
};

export type RequirementCandidate = {
  requirementCode: string;
  category: string;
  originalRequirement: string;
  chineseTranslation: string;
  mandatory: boolean;
  evidenceRequired: boolean;
  /** 永远默认 NOT_ASSESSED；缺失条目可为 NEEDS_CLARIFICATION */
  complianceStatus: "NOT_ASSESSED" | "NEEDS_CLARIFICATION";
  reviewStatus: "AI_EXTRACTED";
  sourcePage: number | null;
  sourceRefs: SourceRefCandidate[];
};

export type ClarificationCandidate = {
  question: string;
  reason: string;
  priority: ClarificationPriority;
  enquiryDeadline: Date | null;
  sourceRefs: SourceRefCandidate[];
};

export type ClosingParse = {
  closingRaw: string;
  closingDate: Date | null;
  timezoneLabel: string | null;
  enquiryDeadline: Date | null;
  /** 必须可在页文本中核验的原文片段 */
  sourceSnippet: string;
};
