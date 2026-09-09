"use client";

/**
 * S3-A 工作台的客户端类型与请求辅助。
 *
 * 为什么不用 `apiJson`：它把错误压成 `new Error(message)`，丢掉了 HTTP status 与领域 code，
 * 而本工作台必须按 code 区分「功能未启用(404-dark)」「无权限(403)」「来源被阻断(409)」
 * 「搜索执行中(409 RUN_EXECUTION_IN_PROGRESS)」等状态。因此统一走 `apiFetch` 并保留 code。
 */

import { apiFetch } from "@/lib/api-fetch";

export class WorkspaceApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "WorkspaceApiError";
    this.status = status;
    this.code = code;
  }
  /** flag 关闭或 org 不在白名单时后端一律 404-dark，前端必须当「未启用」而不是「坏了」 */
  get notEnabled(): boolean {
    return this.status === 404 && this.code === null;
  }
  get forbidden(): boolean {
    return this.status === 403;
  }
}

export async function workspaceFetch<T>(
  input: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const res = await apiFetch(input, init);
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const obj = (typeof data === "object" && data !== null ? data : {}) as {
      error?: unknown;
      code?: unknown;
    };
    throw new WorkspaceApiError(
      typeof obj.error === "string" ? obj.error : `请求失败 (${res.status})`,
      res.status,
      typeof obj.code === "string" ? obj.code : null,
    );
  }
  return data as T;
}

/* ───────────────── 采购要求视图 ───────────────── */

export interface SourceRefView {
  id: string;
  documentId: string;
  documentTitle: string | null;
  pageNumber: number | null;
  locationLabel: string | null;
  sectionLabel: string | null;
  snippet: string;
  confidence: string;
  methodLabel: string;
}

export interface RequirementView {
  id: string;
  code: string;
  category: string | null;
  group: string;
  textZh: string;
  textZhIsChinese: boolean;
  textEn: string;
  mandatory: true | false | "uncertain";
  reviewStatus: string;
  sources: SourceRefView[];
}

export interface ProcurementViewPayload {
  project: { id: string; name: string; clientOrganization: string | null; location: string | null };
  /** 服务端裁决的有效写权限；仅用于隐藏按钮，不构成保护 */
  canWrite: boolean;
  analysis: { runId: string; status: string; createdAt: string; isCanonicalSource: boolean } | null;
  canonical:
    | { state: "OK"; uncertainSourceStatus: string; uncertainCount: number }
    | { state: "BLOCKED"; code: string; reasonCode: string; message: string }
    | { state: "UNAVAILABLE"; code: string; message: string };
  requirements: RequirementView[];
  facts: Array<{ key: string; label: string; status: "KNOWN" | "UNKNOWN"; text: string | null }>;
  documents: Array<{ documentId: string; title: string; role: string; pageCount: number | null }>;
  counts: { total: number; mandatory: number; uncertain: number; optional: number };
}

/* ───────────────── 搜索运行 ───────────────── */

export interface SearchRunRow {
  id: string;
  projectId: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdByUserId: string;
  promptName: string | null;
  promptVersion: string | null;
  briefSnapshotJson: unknown;
  requirementSnapshotJson: unknown;
  sourceConfigJson: unknown;
  queriesJson: unknown;
  statusDetailJson: unknown;
}

/** FR3-A：内部来源命中的既有供应商（SupplierCandidate，不是 Signal） */
export interface RunCandidateRow {
  id: string;
  supplierId: string;
  originSource: string;
  name: string | null;
  website: string | null;
  region: string | null;
  category: string | null;
}

export interface RunDetailPayload {
  run: SearchRunRow;
  executionState: "IDLE" | "IN_PROGRESS" | "RECOVERY_REQUIRED" | "TERMINAL";
  counts: { candidates: number; signals: number };
  candidates: RunCandidateRow[];
  candidatesTruncated: boolean;
}

/* ───────────────── 线索 ───────────────── */

export interface SignalRow {
  id: string;
  orgId: string;
  projectId: string | null;
  tenderId: string | null;
  searchRunId: string | null;
  platform: string;
  contentType: string;
  sourceOrigin: string;
  accountName: string | null;
  accountUrl: string | null;
  contentUrl: string | null;
  title: string | null;
  description: string | null;
  rawText: string | null;
  status: string;
  linkedSupplierId: string | null;
  resolutionJson: unknown;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  discoveredAt: string;
}

export interface SignalPagePayload {
  signals: SignalRow[];
  total: number;
  nextCursor: string | null;
  pageSize: number;
}

export interface ResolutionResult {
  decision: "MATCHED_EXISTING" | "NEW_SUPPLIER_CANDIDATE" | "NEEDS_HUMAN_REVIEW";
  supplierId?: string;
  legalName?: string;
  candidateNames: string[];
  confidence: number;
  matchedSignals: string[];
  matchedSources: Array<{ kind: string; key: string; supplierId: string }>;
  conflicts: string[];
  scan: {
    complete: boolean;
    reasonCode: string | null;
    suppliers: { complete: boolean; pages: number; rows: number; capped: boolean };
    linkedHistory: { complete: boolean; pages: number; rows: number; capped: boolean };
    pageSize: number;
    maxPages: number;
  };
}

export interface SupplierOption {
  id: string;
  name: string;
  website?: string | null;
  region?: string | null;
  category?: string | null;
}
