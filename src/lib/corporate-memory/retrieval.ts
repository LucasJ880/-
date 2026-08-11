// ============================================================
// Deterministic memory retrieval contract（T3, §29/§31/§32/§33/§35）
//
// 本阶段优先 structured filtering + deterministic trust/freshness ordering；
// semantic ranking = DESIGN_ONLY（见 semantic-retrieval-design.ts / 报告 §19）。
// 结果一律 org-scoped（cross-org 零泄漏）；默认仅 ACTIVE，除非 includeHistory。
// 返回项必带 evidence summary + confidence + verificationStatus（供 UI/AI 判断可信度）。
//
// Access class（§35 强化）：可见分级由 server 依鉴权角色裁定（access.ts），
// caller 的 allowedAccessClasses 只能收窄不可扩展；claim 与 evidence 各自按
// 自身 accessClass 独立过滤；返回的 evidenceCount 仅计可见证据（不泄漏隐藏证据存在）。
// ============================================================

import type { MemoryClaim, MemoryClaimEvidence } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveAccessClasses, requireMemoryReadAccess } from "./access";
import {
  CorporateMemoryError,
  MEMORY_ACCESS_CLASSES,
  MEMORY_CLAIM_STATUSES,
  MEMORY_CLAIM_TYPES,
  MEMORY_LIMITS,
  MEMORY_SUBJECT_TYPES,
  MEMORY_TRUST_ORDER,
  requireVocab,
  type MemoryAccessClass,
  type MemoryActorInput,
  type MemoryClaimType,
  type MemoryClaimStatus,
  type MemorySubjectType,
  type MemoryVerificationStatus,
} from "./types";

export interface EvidenceSummary {
  id: string;
  sourceType: string;
  accessClass: string;
  archiveItemId: string | null;
  documentId: string | null;
  sourceUrl: string | null;
  pageNumber: number | null;
  sectionLabel: string | null;
  /// 截断预览（≤240 字符）；完整片段需按 claimId 拉取明细
  snippetPreview: string | null;
  capturedAt: Date;
}

/// 检索返回契约（§31）：绝不只有 statement。
export interface MemoryClaimResult {
  claimId: string;
  subjectType: string;
  subjectKey: string;
  claimType: string;
  claimNature: string;
  statement: string;
  structuredValue: unknown;
  confidence: string;
  verificationStatus: string;
  sourceType: string;
  status: string;
  accessClass: string;
  capturedAt: Date;
  validFrom: Date | null;
  validTo: Date | null;
  supersedesClaimId: string | null;
  evidenceCount: number;
  evidence: EvidenceSummary[];
}

export interface SearchMemoryClaimsParams {
  orgId: string;
  actor: MemoryActorInput;
  subjectType?: string;
  subjectKey?: string;
  claimType?: string;
  status?: string;
  /// 默认仅 ACTIVE。true 时纳入 SUPERSEDED/RETRACTED/NEEDS_REVIEW（RET-04）
  includeHistory?: boolean;
  /// 结构化文本包含匹配（statement，大小写不敏感）；本阶段非语义
  query?: string;
  /// 访问分级收窄：仅可在 server 依角色授权的可见集**之内**进一步缩小（narrow-only）；
  /// 传入越权分级不会扩大可见范围（被交集剔除）。省略 = 用 server 授权集（§35）。
  allowedAccessClasses?: string[];
  /// 时点有效性过滤：仅返回 validFrom≤asOf 且 (validTo 空或 >asOf) 的 claim
  asOf?: Date;
  limit?: number;
  offset?: number;
}

const SNIPPET_PREVIEW_MAX = 240;

function toEvidenceSummary(ev: MemoryClaimEvidence): EvidenceSummary {
  return {
    id: ev.id,
    sourceType: ev.sourceType,
    accessClass: ev.accessClass,
    archiveItemId: ev.archiveItemId,
    documentId: ev.documentId,
    sourceUrl: ev.sourceUrl,
    pageNumber: ev.pageNumber,
    sectionLabel: ev.sectionLabel,
    snippetPreview: ev.sourceSnippet
      ? ev.sourceSnippet.slice(0, SNIPPET_PREVIEW_MAX)
      : null,
    capturedAt: ev.capturedAt,
  };
}

/**
 * 统一结果映射（search 与 get 共用，避免投影漂移）。
 * 传入的 row.evidence 必须已按可见分级过滤（include where）——
 * evidenceCount 与 evidence 均只反映可见证据，隐藏证据既不计数也不泄漏 snippet。
 */
function toClaimResult(
  row: MemoryClaim & { evidence: MemoryClaimEvidence[] },
): MemoryClaimResult {
  return {
    claimId: row.id,
    subjectType: row.subjectType,
    subjectKey: row.subjectKey,
    claimType: row.claimType,
    claimNature: row.claimNature,
    statement: row.statement,
    structuredValue: row.structuredValue ?? null,
    confidence: row.confidence,
    verificationStatus: row.verificationStatus,
    sourceType: row.sourceType,
    status: row.status,
    accessClass: row.accessClass,
    capturedAt: row.capturedAt,
    validFrom: row.validFrom,
    validTo: row.validTo,
    supersedesClaimId: row.supersedesClaimId,
    evidenceCount: row.evidence.length,
    evidence: row.evidence.map(toEvidenceSummary),
  };
}

/**
 * Trust + freshness 确定性排序（§32/§33）：
 * 1. trust（HUMAN_CONFIRMED > SYSTEM_VERIFIED > AI_EXTRACTED > NEEDS_REVIEW）
 * 2. freshness（capturedAt desc）
 * 3. id（稳定 tie-break，保证跨调用确定性）
 * 仅用于展示/排序，绝不改写或删除低 trust claim。
 */
export function compareClaimTrustFreshness(
  a: { verificationStatus: string; capturedAt: Date; claimId: string },
  b: { verificationStatus: string; capturedAt: Date; claimId: string },
): number {
  const ta = MEMORY_TRUST_ORDER[a.verificationStatus as MemoryVerificationStatus] ?? 99;
  const tb = MEMORY_TRUST_ORDER[b.verificationStatus as MemoryVerificationStatus] ?? 99;
  if (ta !== tb) return ta - tb;
  const fa = a.capturedAt.getTime();
  const fb = b.capturedAt.getTime();
  if (fa !== fb) return fb - fa;
  return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0;
}

/**
 * 确定性 memory 检索。返回按 trust→freshness 排序、org-scoped、带证据摘要的 claim 列表。
 */
export async function searchMemoryClaims(
  params: SearchMemoryClaimsParams,
): Promise<MemoryClaimResult[]> {
  const access = await requireMemoryReadAccess({
    orgId: params.orgId,
    actor: params.actor,
  });

  const subjectType: MemorySubjectType | undefined =
    params.subjectType === undefined
      ? undefined
      : requireVocab(params.subjectType, MEMORY_SUBJECT_TYPES, "subjectType");
  const claimType: MemoryClaimType | undefined =
    params.claimType === undefined
      ? undefined
      : requireVocab(params.claimType, MEMORY_CLAIM_TYPES, "claimType");
  const explicitStatus: MemoryClaimStatus | undefined =
    params.status === undefined
      ? undefined
      : requireVocab(params.status, MEMORY_CLAIM_STATUSES, "status");

  if (params.subjectKey !== undefined && subjectType === undefined) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      "subjectKey 过滤需同时指定 subjectType",
    );
  }

  let allowedAccessClasses: MemoryAccessClass[] | undefined;
  if (params.allowedAccessClasses !== undefined) {
    if (!Array.isArray(params.allowedAccessClasses)) {
      throw new CorporateMemoryError(
        "INVALID_INPUT",
        "allowedAccessClasses 必须是数组",
      );
    }
    allowedAccessClasses = params.allowedAccessClasses.map((c) =>
      requireVocab(c, MEMORY_ACCESS_CLASSES, "allowedAccessClasses[]"),
    );
  }

  const limit = Math.min(
    Math.max(1, params.limit ?? MEMORY_LIMITS.SEARCH_DEFAULT_LIMIT),
    MEMORY_LIMITS.SEARCH_MAX_LIMIT,
  );
  const offset = Math.max(0, params.offset ?? 0);

  const where: Record<string, unknown> = { orgId: access.orgId };
  if (subjectType) where.subjectType = subjectType;
  if (params.subjectKey !== undefined) where.subjectKey = params.subjectKey;
  if (claimType) where.claimType = claimType;

  // 状态过滤（RET-03/RET-04）：显式 status 优先；否则默认仅 ACTIVE，includeHistory 放开全部
  if (explicitStatus) {
    where.status = explicitStatus;
  } else if (!params.includeHistory) {
    where.status = "ACTIVE";
  }

  if (params.query !== undefined) {
    if (typeof params.query !== "string") {
      throw new CorporateMemoryError("INVALID_INPUT", "query 必须是字符串");
    }
    const q = params.query.trim();
    if (q) where.statement = { contains: q, mode: "insensitive" };
  }

  // Access class（§35 强化）：server 依角色裁定可见集，caller 只能收窄。
  const effective = effectiveAccessClasses(access, allowedAccessClasses);
  where.accessClass = { in: effective };

  if (params.asOf !== undefined) {
    if (!(params.asOf instanceof Date) || Number.isNaN(params.asOf.getTime())) {
      throw new CorporateMemoryError("INVALID_INPUT", "asOf 必须是有效 Date");
    }
    where.AND = [
      { OR: [{ validFrom: null }, { validFrom: { lte: params.asOf } }] },
      { OR: [{ validTo: null }, { validTo: { gt: params.asOf } }] },
    ];
  }

  // 有界扫描后在内存做 trust→freshness 排序（DB 无法直接表达 trust 词序）。
  // 扫描上限 SEARCH_SCAN_CAP；超出者不静默丢弃——见报告 Known Gaps（分页语义留待检索 v2）。
  // evidence include 按可见分级独立过滤：readable claim 的越权证据不出现在结果、不计入 evidenceCount。
  const rows = await db.memoryClaim.findMany({
    where,
    include: {
      evidence: {
        where: { accessClass: { in: effective } },
        orderBy: { capturedAt: "asc" },
      },
    },
    orderBy: [{ capturedAt: "desc" }, { id: "asc" }],
    take: MEMORY_LIMITS.SEARCH_SCAN_CAP,
  });

  const ranked = rows
    .map((row) => ({
      row,
      key: {
        verificationStatus: row.verificationStatus,
        capturedAt: row.capturedAt,
        claimId: row.id,
      },
    }))
    .sort((a, b) => compareClaimTrustFreshness(a.key, b.key))
    .slice(offset, offset + limit);

  return ranked.map(({ row }) => toClaimResult(row));
}

/**
 * 读取单个 claim（含可见 evidence 明细，非截断）；org-scoped + access-class-scoped。
 * claim 自身 accessClass 越权 → 返回 null（redact，不可枚举）；
 * 越权 evidence 独立过滤，不出现在结果、不计入 evidenceCount。
 */
export async function getMemoryClaim(params: {
  orgId: string;
  actor: MemoryActorInput;
  claimId: string;
}): Promise<MemoryClaimResult | null> {
  const access = await requireMemoryReadAccess({
    orgId: params.orgId,
    actor: params.actor,
  });
  if (typeof params.claimId !== "string" || !params.claimId.trim()) {
    throw new CorporateMemoryError("INVALID_INPUT", "claimId 必填");
  }
  const effective = effectiveAccessClasses(access);
  const row = await db.memoryClaim.findFirst({
    where: {
      id: params.claimId,
      orgId: access.orgId,
      accessClass: { in: effective },
    },
    include: {
      evidence: {
        where: { accessClass: { in: effective } },
        orderBy: { capturedAt: "asc" },
      },
    },
  });
  if (!row) return null;
  return toClaimResult(row);
}
