/**
 * Phase B — 招标分析入队结果规范化（消除 "HTTP 200 + ok:false" 静默失败）
 *
 * 单一事实源：把 enqueueTenderPackageAnalysis / reanalyzeTenderPackage 的
 * 内部 reason/code 字符串映射为稳定的对外契约：
 *   { ok, httpStatus, code, message, suggestion?, reason }
 *
 * 设计原则：
 * - 业务失败必须映射到非 200 HTTP 状态，前端可直接凭 res.ok + json.ok 判定；
 * - 保留 legacy `reason` 字段向后兼容；新增 `code`（稳定枚举）+ `message`（人类可读）；
 * - 纯函数、零 IO，便于单测（见 __tests__/enqueue-outcome.test.ts）。
 */

import type { EnqueuePackageResult, ReanalyzePackageResult } from "./enqueue-package";

/** 稳定对外错误/结果码（任务书 §13） */
export const ENQUEUE_OUTCOME_CODES = [
  "ENQUEUED",
  "IDEMPOTENT_REUSE",
  "NO_PACKAGE_DOCUMENTS",
  "PACKAGE_NOT_READY",
  "DOCUMENT_PROCESSING",
  "MISSING_CONTENT_HASH",
  "NOT_TENDER_PROJECT",
  "PACKAGE_TOO_LARGE",
  "ACTIVE_RUN_EXISTS",
  "RATE_LIMITED",
  "PROJECT_NOT_FOUND",
  "MISSING_ORG",
  "INVALID_STATUS",
  "NOT_FOUND",
  "ANALYSIS_FAILED",
  "WORKER_UNAVAILABLE",
  "AUTO_DISABLED",
  "UNKNOWN",
] as const;

export type EnqueueOutcomeCode = (typeof ENQUEUE_OUTCOME_CODES)[number];

export type NormalizedEnqueueOutcome = {
  /** 业务是否成功（enqueued 或幂等复用同样算成功） */
  ok: boolean;
  httpStatus: number;
  code: EnqueueOutcomeCode;
  /** 人类可读中文提示（前端可直接展示，避免内部异常原文外泄） */
  message: string;
  /** 保留旧字段：内部 reason 原文，便于诊断/兼容 */
  reason?: string;
  suggestion?: "mark_as_tender";
  runId?: string;
  status?: string;
  enqueued?: boolean;
  documentCount?: number;
  packageFingerprint?: string;
  classificationWarning?: string | null;
  supersededRunIds?: string[];
};

type ReasonMapping = {
  code: EnqueueOutcomeCode;
  httpStatus: number;
  message: string;
  ok?: boolean;
  suggestion?: "mark_as_tender";
};

/**
 * 内部 reason/code 原文 → 稳定码 + HTTP 状态 + 中文提示。
 * key 统一小写，调用方先归一化。
 */
const REASON_TABLE: Record<string, ReasonMapping> = {
  // —— 成功 ——
  tender_domain: { code: "ENQUEUED", httpStatus: 200, ok: true, message: "已发起招标分析" },
  intelligence_room: { code: "ENQUEUED", httpStatus: 200, ok: true, message: "已发起招标分析" },
  enqueued: { code: "ENQUEUED", httpStatus: 200, ok: true, message: "已发起招标分析" },
  idempotent_reuse: {
    code: "IDEMPOTENT_REUSE",
    httpStatus: 200,
    ok: true,
    message: "该招标文件包已有进行中的分析，正在复用",
  },

  // —— 业务失败：文件/包尚未就绪 ——
  no_package_documents: {
    code: "NO_PACKAGE_DOCUMENTS",
    httpStatus: 422,
    message: "暂无有效的招标 PDF 文件，请先上传投标文件",
  },
  missing_content_hash: {
    code: "MISSING_CONTENT_HASH",
    httpStatus: 409,
    message: "投标文件仍在处理（内容指纹未就绪），请稍候重试",
  },
  package_not_ready: {
    code: "PACKAGE_NOT_READY",
    httpStatus: 409,
    message: "招标文件包尚未就绪（仍有文件在处理），请稍候重试",
  },
  document_processing: {
    code: "DOCUMENT_PROCESSING",
    httpStatus: 409,
    message: "文件仍在解析中，请稍候重试",
  },

  // —— 业务失败：项目/组织/门闸 ——
  project_not_found: {
    code: "PROJECT_NOT_FOUND",
    httpStatus: 404,
    message: "项目不存在或无法访问",
  },
  not_found: {
    code: "NOT_FOUND",
    httpStatus: 404,
    message: "未找到对应的分析记录",
  },
  missing_org: {
    code: "MISSING_ORG",
    httpStatus: 422,
    message: "项目缺少组织，无法发起分析",
  },
  gate_closed: {
    code: "NOT_TENDER_PROJECT",
    httpStatus: 409,
    message:
      "此项目不是招投标项目（项目类型非「招投标」），不提供招标分析；如需分析请新建招标项目",
    suggestion: "mark_as_tender",
  },

  // —— 业务失败：规模/并发/频率 ——
  package_too_large: {
    code: "PACKAGE_TOO_LARGE",
    httpStatus: 413,
    message: "投标文件包总页数超过上限",
  },
  active_run: {
    code: "ACTIVE_RUN_EXISTS",
    httpStatus: 409,
    message: "已有进行中的分析，请等待其完成后再试",
  },
  rate_limited: {
    code: "RATE_LIMITED",
    httpStatus: 429,
    message: "重新分析过于频繁，请稍后再试",
  },
  invalid_status: {
    code: "INVALID_STATUS",
    httpStatus: 422,
    message: "当前分析状态不支持该操作",
  },

  // —— 系统失败（预留） ——
  analysis_failed: {
    code: "ANALYSIS_FAILED",
    httpStatus: 500,
    message: "分析失败，请稍后重试",
  },
  worker_unavailable: {
    code: "WORKER_UNAVAILABLE",
    httpStatus: 503,
    message: "分析服务暂不可用，请稍后重试",
  },

  // —— 后台自动触发：未启用（benign no-op，非失败） ——
  auto_disabled: {
    code: "AUTO_DISABLED",
    httpStatus: 200,
    ok: true,
    message: "自动分析未启用",
  },
};

const UNKNOWN_MAPPING: ReasonMapping = {
  code: "UNKNOWN",
  httpStatus: 400,
  message: "无法发起分析",
};

/** 将任意内部 reason/code 原文归一化为稳定映射（未知 → UNKNOWN/400）。 */
export function mapReasonToOutcome(reason: string | null | undefined): ReasonMapping {
  const key = (reason ?? "").trim().toLowerCase();
  return REASON_TABLE[key] ?? UNKNOWN_MAPPING;
}

/** enqueue（默认 action）结果 → 规范化对外契约。 */
export function normalizeEnqueueResult(
  result: EnqueuePackageResult,
): NormalizedEnqueueOutcome {
  // 成功语义：真正入队，或幂等复用既有 run。
  const success = result.enqueued || result.reason === "idempotent_reuse";
  const mapping = success
    ? mapReasonToOutcome(result.enqueued ? "enqueued" : "idempotent_reuse")
    : mapReasonToOutcome(result.reason);
  const ok = mapping.ok ?? false;
  return {
    ok,
    httpStatus: mapping.httpStatus,
    code: mapping.code,
    message: mapping.message,
    reason: result.reason,
    suggestion: result.suggestion ?? mapping.suggestion,
    runId: result.runId,
    status: result.status,
    enqueued: result.enqueued,
    documentCount: result.documentCount,
    packageFingerprint: result.packageFingerprint,
    classificationWarning: result.classificationWarning ?? null,
    supersededRunIds: result.supersededRunIds,
  };
}

/** reanalyze 结果 → 规范化对外契约。 */
export function normalizeReanalyzeResult(
  result: ReanalyzePackageResult,
): NormalizedEnqueueOutcome {
  if (result.ok) {
    return {
      ok: true,
      httpStatus: 200,
      code: "ENQUEUED",
      message: "已发起重新分析",
      reason: "reanalyze",
      runId: result.newRunId,
      status: result.status,
      enqueued: true,
      documentCount: result.documentCount,
      packageFingerprint: result.packageFingerprint,
    };
  }
  const mapping = mapReasonToOutcome(result.code);
  return {
    ok: false,
    httpStatus: mapping.httpStatus,
    code: mapping.code,
    // reanalyze 已带人类可读 error，优先使用；否则用码表
    message: result.error || mapping.message,
    reason: result.code,
    suggestion: mapping.suggestion,
  };
}

export function isEnqueueOutcomeCode(v: string): v is EnqueueOutcomeCode {
  return (ENQUEUE_OUTCOME_CODES as readonly string[]).includes(v);
}
