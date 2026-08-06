/**
 * Phase 1.1 — 原文片段页级核验
 * CONFIRMED_FACT 仅在 snippet 能在页文本中核验时允许；否则降级置信度。
 */

import type { ConfidenceLevel, StatementKind } from "./constants";

/**
 * 宽松空白归一化：折叠空白、trim。
 * 不做激进大小写折叠以外的语义改写，便于中英混排 substring 匹配。
 */
export function normalizeForSnippetMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 归一化后做子串匹配 */
export function snippetExistsOnPage(
  snippet: string,
  pageText: string,
): boolean {
  const needle = normalizeForSnippetMatch(snippet);
  if (!needle) return false;
  const haystack = normalizeForSnippetMatch(pageText);
  if (!haystack) return false;
  return haystack.includes(needle);
}

export type SourceSnippetAssertInput = {
  snippet: string;
  pageText: string;
  statementKind: StatementKind;
  confidence?: ConfidenceLevel;
};

export type SourceSnippetAssertResult = {
  verified: boolean;
  statementKind: StatementKind;
  confidence: ConfidenceLevel;
  reason: string;
};

/**
 * 核验 snippet；CONFIRMED_FACT 未通过时降级 statementKind / confidence。
 */
export function assertSourceSnippet(
  input: SourceSnippetAssertInput,
): SourceSnippetAssertResult {
  const verified = snippetExistsOnPage(input.snippet, input.pageText);
  const requestedConfidence = input.confidence ?? "CONFIRMED";

  if (input.statementKind === "CONFIRMED_FACT" && !verified) {
    return {
      verified: false,
      statementKind: "DOCUMENT_INTERPRETATION",
      confidence:
        requestedConfidence === "CONFIRMED"
          ? "HIGH_CONFIDENCE"
          : requestedConfidence === "HIGH_CONFIDENCE"
            ? "INFERRED"
            : requestedConfidence,
      reason: "snippet_not_found_on_page",
    };
  }

  if (!verified) {
    return {
      verified: false,
      statementKind: input.statementKind,
      confidence:
        requestedConfidence === "CONFIRMED"
          ? "HIGH_CONFIDENCE"
          : requestedConfidence,
      reason: "snippet_not_found_on_page",
    };
  }

  return {
    verified: true,
    statementKind: input.statementKind,
    confidence:
      input.statementKind === "CONFIRMED_FACT"
        ? "CONFIRMED"
        : requestedConfidence,
    reason: "snippet_verified",
  };
}

export type CanMarkConfirmedInput = {
  snippet: string | null | undefined;
  pageText: string | null | undefined;
  statementKind: StatementKind;
};

/**
 * 仅当声明为 CONFIRMED_FACT 且 snippet 在页文本中可核验时返回 true。
 */
export function canMarkConfirmed(input: CanMarkConfirmedInput): boolean {
  if (input.statementKind !== "CONFIRMED_FACT") return false;
  if (!input.snippet || !input.pageText) return false;
  return snippetExistsOnPage(input.snippet, input.pageText);
}
