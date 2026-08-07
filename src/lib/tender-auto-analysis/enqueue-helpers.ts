/**
 * 入队纯函数助手（可单测，无 DB / LLM）
 */

import type { DocumentRole, TenderAnalysisRunKind } from "./constants";

/** 活跃跑（幂等复用）：含 REVIEW_REQUIRED */
export const ACTIVE_RUN_STATUSES = [
  "PENDING",
  "EXTRACTING",
  "ANALYZING",
  "REVIEW_REQUIRED",
] as const;

/** 可被新 hash 抢占为 SUPERSEDED 的状态（不含 REVIEW_REQUIRED / APPROVED） */
export const SUPERSEDABLE_RUN_STATUSES = [
  "PENDING",
  "EXTRACTING",
  "ANALYZING",
] as const;

const TENDER_FILENAME_RE =
  /\b(rfp|rfq|itt|itb|tender|bid)\b|招标|投标|询价|标书/i;

const ADDENDUM_RE = /addendum|附录|补遗|澄清公告|amendment/i;

export function looksLikeTenderFilename(title: string): boolean {
  const t = (title ?? "").trim();
  if (!t) return false;
  return TENDER_FILENAME_RE.test(t);
}

export function isPdfFileType(fileType: string): boolean {
  const t = (fileType ?? "").trim().toLowerCase().replace(/^\./, "");
  return t === "pdf" || t === "application/pdf";
}

/**
 * @deprecated Phase 1.1.1：FULL 包入队不再用文件名判定 ADDENDUM。
 * 保留给旧测试/增量显式路径；仅当明确含 addendum 关键词时返回 ADDENDUM。
 * 普通第二 PDF 不得仅凭此进入 INCREMENTAL。
 */
export function detectDocumentRole(title: string): DocumentRole {
  if (ADDENDUM_RE.test(title ?? "")) return "ADDENDUM";
  return "PRIMARY";
}

/**
 * INCREMENTAL 仅用于明确 Addendum 触发（用户选择 / metadata / 既有 workflow）。
 * 文件名启发式不得单独驱动 package FULL→INCREMENTAL。
 */
export function detectRunKind(
  role: DocumentRole,
  opts?: { explicitAddendum?: boolean },
): TenderAnalysisRunKind {
  if (opts?.explicitAddendum === true && role === "ADDENDUM") {
    return "INCREMENTAL";
  }
  // Phase 1.1.1 默认 FULL；避免第二份普通 PDF 误判 INCREMENTAL
  return "FULL";
}

export type SupersedeDecisionInput = {
  existingFingerprint: string;
  newFingerprint: string;
  existingStatus: string;
};

/**
 * 新 hash 且旧跑仍在 PENDING/EXTRACTING/ANALYZING → 应 SUPERSEDE。
 * 相同指纹不抢占；REVIEW_REQUIRED / APPROVED 不抢占。
 */
export function shouldSupersedeActiveRun(
  input: SupersedeDecisionInput,
): boolean {
  if (input.existingFingerprint === input.newFingerprint) return false;
  return (SUPERSEDABLE_RUN_STATUSES as readonly string[]).includes(
    input.existingStatus,
  );
}

export type GateBlockedSuggestion =
  | { suggestion: "mark_as_tender" }
  | { suggestion?: undefined };

/**
 * 门闸关闭时：若文件名像招标或本身是 PDF，提示 mark_as_tender。
 * 绝不修改 workDomain。
 */
export function suggestionWhenGateClosed(input: {
  title: string;
  fileType: string;
}): GateBlockedSuggestion {
  if (looksLikeTenderFilename(input.title) || isPdfFileType(input.fileType)) {
    return { suggestion: "mark_as_tender" };
  }
  return {};
}
