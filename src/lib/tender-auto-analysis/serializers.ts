/**
 * API 序列化 — 用户响应不含原始大段 JSON 调试字段（structuredJson 仅保留安全子集）
 */

import {
  runStatusLabel,
  statementKindLabel,
  requirementReviewLabel,
  tenderAnalysisProgressLabel,
} from "./display-labels";
import { CHINESE_REPORT_CHAPTERS } from "./constants";

export function serializeRunListItem(run: {
  id: string;
  status: string;
  runKind: string;
  workerStep: string | null;
  summaryText: string | null;
  createdAt: Date;
  completedAt: Date | null;
  approvedAt: Date | null;
  parentRunId: string | null;
  errorMessageSanitized: string | null;
  pagesDone?: number | null;
  pagesTotal?: number | null;
  pendingChangeCount?: number;
}) {
  return {
    id: run.id,
    status: run.status,
    statusLabel: tenderAnalysisProgressLabel({
      status: run.status,
      workerStep: run.workerStep,
      pagesDone: run.pagesDone,
      pagesTotal: run.pagesTotal,
    }),
    statusLabelShort: runStatusLabel(run.status),
    runKind: run.runKind,
    runKindLabel: run.runKind === "INCREMENTAL" ? "增量分析" : "完整分析",
    workerStep: run.workerStep,
    summaryText: run.summaryText,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    approvedAt: run.approvedAt?.toISOString() ?? null,
    parentRunId: run.parentRunId,
    errorMessage: run.errorMessageSanitized,
    pendingChangeCount: run.pendingChangeCount ?? 0,
  };
}

export function serializeSourceRef(s: {
  id: string;
  documentId: string;
  pageNumber: number | null;
  sectionLabel: string | null;
  originalTextSnippet: string;
  confidence: string;
  extractionMethod: string;
}) {
  return {
    id: s.id,
    documentId: s.documentId,
    pageNumber: s.pageNumber,
    sectionLabel: s.sectionLabel,
    snippet: s.originalTextSnippet.slice(0, 500),
    confidence: s.confidence,
    // 不暴露 extractionMethod 原始调试值给普通 UI；可用中文
    methodLabel:
      s.extractionMethod === "unpdf"
        ? "PDF 文本"
        : s.extractionMethod === "ocr"
          ? "OCR"
          : "提取",
  };
}

export function serializeSection(sec: {
  id: string;
  sectionKey: string;
  contentZh: string;
  confidence: string;
  reviewStatus: string;
  structuredJson?: unknown;
}) {
  const chapter = CHINESE_REPORT_CHAPTERS.find(
    (c) => c.sectionKey === sec.sectionKey,
  );
  return {
    id: sec.id,
    sectionKey: sec.sectionKey,
    titleZh: chapter?.titleZh ?? sec.sectionKey,
    contentZh: sec.contentZh,
    confidence: sec.confidence,
    reviewStatus: sec.reviewStatus,
    reviewStatusLabel:
      sec.reviewStatus === "HUMAN_EDITED"
        ? "人工已改"
        : sec.reviewStatus === "APPROVED"
          ? "已批准"
          : "AI 草稿",
  };
}

export function serializeFact(f: {
  id: string;
  statementKind: string;
  contentZh: string;
  contentOriginal: string | null;
  confidence: string;
  manuallyConfirmed: boolean;
  sourceRefs?: Array<{
    id: string;
    documentId: string;
    pageNumber: number | null;
    sectionLabel: string | null;
    originalTextSnippet: string;
    confidence: string;
    extractionMethod: string;
  }>;
}) {
  return {
    id: f.id,
    statementKind: f.statementKind,
    statementKindLabel: statementKindLabel(f.statementKind),
    contentZh: f.contentZh,
    contentOriginal: f.contentOriginal,
    confidence: f.confidence,
    manuallyConfirmed: f.manuallyConfirmed,
    sources: (f.sourceRefs || []).map(serializeSourceRef),
  };
}

export function serializeRequirement(r: {
  id: string;
  requirementCode: string;
  category: string;
  originalRequirement: string;
  chineseTranslation: string;
  mandatory: boolean;
  evidenceRequired: boolean;
  complianceStatus: string;
  reviewStatus: string;
  sourcePage: number | null;
  sourceRefs?: Array<{
    id: string;
    documentId: string;
    pageNumber: number | null;
    sectionLabel: string | null;
    originalTextSnippet: string;
    confidence: string;
    extractionMethod: string;
  }>;
}) {
  return {
    id: r.id,
    requirementCode: r.requirementCode,
    category: r.category,
    originalRequirement: r.originalRequirement,
    chineseTranslation: r.chineseTranslation,
    mandatory: r.mandatory,
    evidenceRequired: r.evidenceRequired,
    complianceStatus: r.complianceStatus,
    reviewStatus: r.reviewStatus,
    reviewStatusLabel: requirementReviewLabel(r.reviewStatus),
    sourcePage: r.sourcePage,
    sources: (r.sourceRefs || []).map(serializeSourceRef),
  };
}

export function serializeClarification(c: {
  id: string;
  question: string;
  reason: string;
  priority: string;
  status: string;
  enquiryDeadline: Date | null;
}) {
  return {
    id: c.id,
    question: c.question,
    reason: c.reason,
    priority: c.priority,
    priorityLabel:
      c.priority === "BLOCKING"
        ? "阻塞"
        : c.priority === "HIGH"
          ? "高"
          : c.priority === "LOW"
            ? "低"
            : "中",
    status: c.status,
    statusLabel:
      c.status === "OPEN"
        ? "待处理"
        : c.status === "SENT"
          ? "已发出"
          : c.status === "ANSWERED"
            ? "已回复"
            : "已撤回",
    enquiryDeadline: c.enquiryDeadline?.toISOString() ?? null,
  };
}

export function serializeDeliverable(d: {
  id: string;
  deliverableKey: string;
  title: string;
  mandatory: boolean;
  status: string;
  sourcePage: number | null;
  dueAt: Date | null;
}) {
  return {
    id: d.id,
    deliverableKey: d.deliverableKey,
    title: d.title,
    mandatory: d.mandatory,
    status: d.status,
    statusLabel:
      d.status === "DONE"
        ? "已完成"
        : d.status === "IN_PROGRESS"
          ? "进行中"
          : d.status === "WAIVED"
            ? "已豁免"
            : "待处理",
    sourcePage: d.sourcePage,
    dueAt: d.dueAt?.toISOString() ?? null,
  };
}

export function serializeChangeCandidate(c: {
  id: string;
  changeType: string;
  entityType: string;
  entityKey: string | null;
  summaryZh: string;
  status: string;
  appliedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: c.id,
    changeType: c.changeType,
    entityType: c.entityType,
    entityKey: c.entityKey,
    summaryZh: c.summaryZh,
    status: c.status,
    statusLabel:
      c.status === "PENDING_REVIEW"
        ? "待确认"
        : c.status === "APPLIED"
          ? "已接受"
          : "已忽略",
    appliedAt: c.appliedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
