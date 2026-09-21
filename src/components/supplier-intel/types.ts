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
  /** S4-B：项目上下文下的找厂优先级（read-model；≠ 供应商评分；无项目 / Brief 不可用时为 null） */
  discoveryPriority?: DiscoveryPriorityView | null;
}

export interface DiscoveryPriorityView {
  version: string;
  total: number;
  bucket: "P1" | "P2" | "P3";
  components: { relevance: number; factory: number; export: number; actionability: number; completeness: number };
  reasons: {
    productTermsMatched: string[]; productTermsTotal: number; searchTermsMatched: string[]; searchTermsTotal: number;
    factoryTermsMatched: string[]; exportTermsMatched: string[]; sourceQuery: string | null;
    completeness: { url: boolean; title: boolean; body: boolean; account: boolean };
  };
  disclaimer: string;
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

/* ───────────────── S3-B：供应商证据工作台 ───────────────── */

/**
 * 只做 `type` 再导出：编译期擦除，不会把 server-only 的视图模块拖进浏览器包。
 * 与服务端共用同一份类型定义，避免 S3-A 那种手抄副本随时间漂移。
 */
export type {
  CapabilityClaimView,
  CertificationEvidenceView,
  CertificationView,
  LinkedSignalView,
  OfferingView,
  SupplierCapabilityPayload,
} from "@/lib/supplier-intel/supplier-capability-view";

/** 资质核验的「档案依据」候选（GET /projects/[id]/archive-evidence） */
export interface ArchiveEvidenceOption {
  id: string;
  kind: string;
  mimeType: string;
  capturedAt: string;
  title: string | null;
  sourceHost: string | null;
}

/* ───────────────── S4-A：评估运行 ───────────────── */

export interface EvaluationRunListRow {
  commercialEvidenceBinding?: CommercialEvidenceBindingView | null;
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  evaluationVersion: string;
  candidates: Array<{
    id: string; supplierId: string; supplierName: string; offeringId: string | null; offeringName: string | null;
    offeringSku: string | null; mandatoryGateResult: string; recommendation: string | null; rejectionReason: string | null;
  }>;
}

export interface EvaluationRequirementRowView {
  entry: { id: string; code: string; text: string; category: string | null; mandatory: true | false | "uncertain"; mandatorySignal: string | null };
  display: { textZh: string | null; textZhIsChinese: boolean; sources: Array<{ documentTitle?: string | null; locationLabel?: string | null; snippet?: string }> } | null;
  match: { id: string; verdict: string; evaluatedBy: string; explanation: string | null; confidence: number | null; evidence: unknown; createdAt: string } | null;
  suggestion: { ruleId: string; verdict: "PASS" | "FAIL" | "UNKNOWN"; explanation: string; evidence: unknown[] } | null;
}

export interface EvaluationCandidateView {
  id: string;
  supplier: { id: string; name: string };
  offering: { id: string; name: string; sku: string | null } | null;
  originSource: string;
  supplierSnapshot: unknown;
  offeringSnapshot: unknown;
  mandatoryGateResult: string;
  mandatoryGate: { result: string; items: Array<{ requirementKey: string; gateVerdict: string; reasonCode: string; matchVerdict: string | null }>; summary: Record<string, number> } | null;
  recommendation: string | null;
  rejectionReason: string | null;
  scores: { technical: number | null; commercial: number | null; reliability: number | null; importRisk: number | null; total: number | null };
  scoreVersion: string;
  /** S4-B：收口时冻结的评分快照（RUNNING 期间为 null） */
  scoreBreakdown: CandidateScoreBreakdownView | null;
  requirements: EvaluationRequirementRowView[];
  evidenceOptions: {
    certifications: Array<{ id: string; certificationType: string; scope: string; offeringId: string | null; status: string; validFrom: string | null; expiresAt: string | null; certificateNumber: string | null; expiredByDate: boolean; scopeCompatible: boolean }>;
    signals: Array<{ id: string; title: string; platform: string; contentUrl: string | null }>;
    archives: Array<{ id: string; kind: string; mimeType: string; capturedAt: string }>;
  };
}

export interface EvaluationViewPayload {
  run: { id: string; status: string; runMode: "EVALUATION_ONLY"; createdAt: string; completedAt: string | null; evaluationVersion: string; scoreVersion: string; requirementSnapshotVersion: string | null; sourceDiscoveryRunId: string | null; commercialEvidenceBinding?: CommercialEvidenceBindingView | null; statusDetail: unknown };
  project: { id: string; name: string | null };
  canWrite: boolean;
  requirementCount: number;
  mandatoryCount: number;
  candidates: EvaluationCandidateView[];
}

/* ───────────────── S4-B：评分快照 / 当前推荐 / 赛马 ───────────────── */

export interface CandidateScoreBreakdownView {
  scoreVersion: string;
  recommendationContractVersion: string;
  componentRuleVersions: Record<string, string>;
  computedAt: string;
  gateResult: string;
  technical: { score: number | null; scorableCount: number; items: Array<{ key: string; category: string | null; verdict: string; evaluatedBy: string | null; points: number; reason: string | null }>; excluded: Array<{ key: string; category: string | null }>; unmapped: Array<{ key: string; category: string | null }>; reasonCodes: string[] } | null;
  commercial: { score: number | null; priceEvidenceTier: string; round: { inquiryId: string; roundNumber: number; scope: string | null } | null; priceBasis: string | null; currency: string | null; candidate: { itemId: string; price: number | null; deliveryDays: number | null; validUntil: string | null } | null; comparableGroup: Array<{ supplierId: string; itemId: string; price: number; deliveryDays: number | null }>; sub: { price: number | null; delivery: number; completeness: number | null }; reasonCodes: string[]; binding: (CommercialEvidenceBindingView & { status: string }) | null; offeringPriceEvidence: { tier: string; listedPrice: string | null; currency: string | null; priceStatus: string | null; sourceKind: string | null; sourceUrl: string | null; sourceSignalPlatform: string | null } } | null;
  reliability: { score: number | null; contacted: number; replied: number; selected: number; sub: { responseRate: number | null; priorSelection: number | null }; reasonCodes: string[] } | null;
  importRisk: { score: number | null; verified: Array<{ id: string; type: string }>; unverified: Array<{ id: string; type: string; evidenceStatus: string }>; sub: { readiness: number | null; packaging: number; incoterm: number; leadTime: number }; offering: { incoterm: string | null; leadTimeDays: number | null }; reasonCodes: string[] } | null;
  knownWeightShare: number | null;
  unknownComponents: string[];
  normalizedKnownScore: number | null;
  officialTotalScore: number | null;
  recommendation: string | null;
  rankable: boolean;
  reasonCodes: string[];
}

export interface RankingRowView {
  candidateId: string; supplierId: string; offeringId: string | null; mandatoryGateResult: string; recommendation: string | null;
  scores: { technical: number | null; commercial: number | null; reliability: number | null; importRisk: number | null; total: number | null };
  eligible: boolean; rank: number | null; section: string; ineligibleReason: string | null;
  runId: string; completedAt: string | null; supplierName: string; offeringName: string | null; offeringSku: string | null; originSource: string; scoreVersion: string;
  unknownComponents: string[]; reasonCodes: string[]; priceEvidenceTier: string | null; nextAction: { code: string; label: string };
}

export interface RacingRowView {
  key: string; supplierId: string; supplierName: string; offeringId: string | null; offeringName: string | null;
  sourcePlatform: string | null; originSource: string | null; discoveryPriority: DiscoveryPriorityView | null;
  state: string; gate: string | null; rfq: "NONE" | "SENT" | "CONFIRMED_UNBOUND" | "CONFIRMED"; officialTotalScore: number | null;
  currentRank: number | null; section: string | null; candidateId: string | null; runId: string | null; evaluationInProgress: boolean;
  nextAction: { code: string; label: string };
}

export interface ProjectRankingPayload {
  project: { id: string; name: string | null };
  computedAt: string;
  disclaimers: { ranking: string; discovery: string };
  priorityBriefSource: string | null;
  sections: Record<"PRIMARY" | "BACKUP" | "NEEDS_VERIFICATION" | "HIGH_RISK" | "NOT_ELIGIBLE", RankingRowView[]>;
  ranked: RankingRowView[];
  racing: RacingRowView[];
}

/* ───────────────── S4-B FR1：正式报价绑定 ───────────────── */

export interface CommercialEvidenceBindingView {
  inquiryId: string; inquiryItemId: string; supplierId: string; offeringId: string; roundNumber: number; scope: string | null; confirmedByUserId: string;
}

export interface CommercialEvidenceOption {
  inquiryItemId: string; inquiryId: string; roundNumber: number; scope: string | null; status: string; repliedAt: string | null;
  currency: string; totalPrice: string | null; unitPrice: string | null; deliveryDays: number | null; validUntil: string | null;
}
