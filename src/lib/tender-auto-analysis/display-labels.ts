/**
 * 招标自动分析 — 用户可见中文标签（禁止前端直接展示原始 enum）
 */

import type { TenderAnalysisStatus, WorkerStep } from "./constants";

export const STATEMENT_KIND_LABELS: Record<string, string> = {
  CONFIRMED_FACT: "文件事实",
  DOCUMENT_INTERPRETATION: "文件解释",
  AI_INFERENCE: "AI推断",
  RECOMMENDATION: "建议",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: "等待分析",
  EXTRACTING: "正在提取",
  ANALYZING: "正在分析",
  REVIEW_REQUIRED: "等待审核",
  APPROVED: "已批准",
  FAILED: "分析失败",
  SUPERSEDED: "已由新分析替代",
};

export const REQUIREMENT_REVIEW_LABELS: Record<string, string> = {
  AI_EXTRACTED: "待确认",
  CONFIRMED: "已确认",
  REJECTED: "已驳回",
};

export const SECTION_REVIEW_LABELS: Record<string, string> = {
  AI_DRAFT: "AI 草稿",
  HUMAN_EDITED: "人工已改",
  APPROVED: "已批准",
};

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  ADDED: "新增",
  REMOVED: "删除",
  MODIFIED: "修改",
  DATE_CHANGED: "日期变更",
  QUANTITY_CHANGED: "数量变更",
  PRICING_CHANGED: "价格变更",
};

export function statementKindLabel(kind: string | null | undefined): string {
  if (!kind) return "未分类";
  return STATEMENT_KIND_LABELS[kind] || kind;
}

export function runStatusLabel(status: string | null | undefined): string {
  if (!status) return "未知状态";
  return RUN_STATUS_LABELS[status] || status;
}

export function requirementReviewLabel(status: string | null | undefined): string {
  if (!status) return "待确认";
  return REQUIREMENT_REVIEW_LABELS[status] || status;
}

export type ProgressLabelInput = {
  status: TenderAnalysisStatus | string;
  workerStep?: WorkerStep | string | null;
  /** 已解析页数 */
  pagesDone?: number | null;
  /** 总页数 */
  pagesTotal?: number | null;
};

/**
 * 文件管理器 / 进度条用中文状态。
 * - EXTRACTING + 有页进度 →「已解析 x/y 页」
 * - 否则按 status 映射；不暴露原始 enum
 */
export function tenderAnalysisProgressLabel(input: ProgressLabelInput): string {
  const status = String(input.status || "");
  if (status === "EXTRACTING") {
    const done = input.pagesDone;
    const total = input.pagesTotal;
    if (
      typeof done === "number" &&
      typeof total === "number" &&
      total > 0
    ) {
      return `已解析 ${done}/${total} 页`;
    }
    return "正在提取";
  }
  if (status === "ANALYZING") {
    const step = String(input.workerStep || "");
    if (step === "ENSURE_PAGES" || step === "EXTRACT_FACTS") {
      return "正在提取";
    }
    return "正在分析";
  }
  return runStatusLabel(status);
}
