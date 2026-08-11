// ============================================================
// Corporate Memory Foundation — 词表 / 限额 / 错误契约（T3）
//
// 命名注意：本模块是「企业记忆」（org 级 canonical claims），
// 与既有会话记忆家族（UserMemory / src/lib/ai/memory*）无关。
// 生产写入统一走本目录 service；禁止业务代码直连 prisma.memoryClaim.*。
// ============================================================

// --- Subject ---

export const MEMORY_SUBJECT_TYPES = [
  "BUYER",
  "PROJECT",
  "TENDER",
  "VENDOR",
  "PRODUCT",
  "ORGANIZATION",
  "OTHER",
] as const;
export type MemorySubjectType = (typeof MEMORY_SUBJECT_TYPES)[number];

// --- Claim taxonomy ---

export const MEMORY_CLAIM_TYPES = [
  "BUYER_POLICY",
  "BUYER_PATTERN",
  "PROJECT_FACT",
  "COMMERCIAL_TERM",
  "TECHNICAL_REQUIREMENT",
  "AWARD_FACT",
  "PRICE_FACT",
  "WIN_LOSS_REASON",
  "SUPPLIER_FACT",
  "OTHER",
] as const;
export type MemoryClaimType = (typeof MEMORY_CLAIM_TYPES)[number];

/// FACT = 证据直接支撑陈述；INTERPRETATION = 有来源依据的解读；INFERENCE = 派生推断。
/// AI 推理绝不能默认 FACT（sourceType=AI_DERIVED 的 claim 禁止 FACT）。
export const MEMORY_CLAIM_NATURES = ["FACT", "INTERPRETATION", "INFERENCE"] as const;
export type MemoryClaimNature = (typeof MEMORY_CLAIM_NATURES)[number];

// --- Confidence 与 Verification 正交 ---

export const MEMORY_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type MemoryConfidenceLevel = (typeof MEMORY_CONFIDENCE_LEVELS)[number];

export const MEMORY_VERIFICATION_STATUSES = [
  "AI_EXTRACTED",
  "HUMAN_CONFIRMED",
  "SYSTEM_VERIFIED",
  "NEEDS_REVIEW",
] as const;
export type MemoryVerificationStatus =
  (typeof MEMORY_VERIFICATION_STATUSES)[number];

/// Trust ordering（§32）：仅用于 ranking / display / decision support，
/// 不得用于自动删除或改写低 trust claim。数值越小 trust 越高。
export const MEMORY_TRUST_ORDER: Record<MemoryVerificationStatus, number> = {
  HUMAN_CONFIRMED: 0,
  SYSTEM_VERIFIED: 1,
  AI_EXTRACTED: 2,
  NEEDS_REVIEW: 3,
};

// --- Source ---

export const MEMORY_SOURCE_TYPES = [
  "TENDER_DOCUMENT",
  "ADDENDUM",
  "PUBLIC_WEB",
  "AWARD_NOTICE",
  "EMAIL",
  "VENDOR_QUOTE",
  "PROJECT_RECORD",
  "SITE_VISIT",
  "USER_ENTRY",
  "AI_DERIVED",
] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];

/// AI_DERIVED 不是独立证据：evidence 记录禁止使用（AI 产物必须回指真实来源）。
export const MEMORY_EVIDENCE_SOURCE_TYPES = MEMORY_SOURCE_TYPES.filter(
  (t) => t !== "AI_DERIVED",
) as readonly Exclude<MemorySourceType, "AI_DERIVED">[];
export type MemoryEvidenceSourceType =
  (typeof MEMORY_EVIDENCE_SOURCE_TYPES)[number];

// --- Lifecycle ---

export const MEMORY_CLAIM_STATUSES = [
  "ACTIVE",
  "SUPERSEDED",
  "RETRACTED",
  "NEEDS_REVIEW",
] as const;
export type MemoryClaimStatus = (typeof MEMORY_CLAIM_STATUSES)[number];

export const BUYER_STATUSES = [
  "ACTIVE",
  "NEEDS_REVIEW",
  "INACTIVE",
  "MERGED",
] as const;
export type BuyerStatus = (typeof BUYER_STATUSES)[number];

export const BUYER_TYPES = [
  "municipal",
  "provincial",
  "federal",
  "crown",
  "school_board",
  "healthcare",
  "university",
  "indigenous",
  "private",
  "other",
] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

// --- Access classification（复用 TenderArchiveItem 词表） ---

export const MEMORY_ACCESS_CLASSES = [
  "PUBLIC_SOURCE",
  "INTERNAL_COMPANY",
  "CLIENT_CONFIDENTIAL",
  "VENDOR_CONFIDENTIAL",
  "RESTRICTED",
] as const;
export type MemoryAccessClass = (typeof MEMORY_ACCESS_CLASSES)[number];

export const DEFAULT_ACCESS_CLASS: MemoryAccessClass = "INTERNAL_COMPANY";

// --- Actor（本轮 CONSERVATIVE_ADMIN_ONLY：仅 user actor 可写） ---

/// createdByType 词表 = user | system；system producer 本轮未启用（SYSTEM_WRITER_NOT_ENABLED），
/// ai 永远不是合法 createdByType（AI_AUTO_MEMORY_WRITE = NO：AI 提案只能走未来 candidate 流）。
export const MEMORY_CREATOR_TYPES = ["user", "system"] as const;
export type MemoryCreatorType = (typeof MEMORY_CREATOR_TYPES)[number];

export interface MemoryActorInput {
  /// 发起人 User.id；access.ts 会做 org 级鉴权（admin-only write）
  userId: string;
  /// 声明的 actor 类型；缺省 "user"。"system"/"ai" 会被写入门拒绝（见 claim-service）。
  actorType?: string;
}

// --- 限额（§50：防止 MemoryClaim 被当成无限文本存储） ---

export const MEMORY_LIMITS = {
  STATEMENT_MAX_CHARS: 2000,
  SNIPPET_MAX_CHARS: 2000,
  SUBJECT_KEY_MAX_CHARS: 200,
  SOURCE_KEY_MAX_CHARS: 300,
  SECTION_LABEL_MAX_CHARS: 300,
  URL_MAX_CHARS: 2000,
  REVIEW_NOTE_MAX_CHARS: 2000,
  RETRACTION_REASON_MAX_CHARS: 1000,
  CANONICAL_NAME_MAX_CHARS: 300,
  ALIAS_MAX_CHARS: 300,
  ALIASES_MAX_COUNT: 50,
  /// metadata / structuredValue / externalIdentifiers 序列化后 UTF-8 字节上限
  JSON_MAX_BYTES: 8192,
  /// 单次创建/追加的 evidence 条数上限（对齐 workforce handoff evidenceRefs ≤ 20 的量级）
  EVIDENCE_MAX_PER_CALL: 20,
  /// 检索默认/最大页大小与内存排序扫描上限
  SEARCH_DEFAULT_LIMIT: 20,
  SEARCH_MAX_LIMIT: 100,
  SEARCH_SCAN_CAP: 500,
} as const;

// --- 错误契约 ---

export type CorporateMemoryErrorCode =
  | "MEMORY_WRITE_FORBIDDEN"
  | "MEMORY_READ_FORBIDDEN"
  | "AI_AUTO_MEMORY_WRITE_DISABLED"
  | "SYSTEM_WRITER_NOT_ENABLED"
  | "SYSTEM_VERIFICATION_NOT_ENABLED"
  | "INVALID_INPUT"
  | "EVIDENCE_REQUIRED"
  | "FACT_REQUIRES_EVIDENCE"
  | "AI_DERIVED_CANNOT_BE_FACT"
  | "EVIDENCE_SOURCE_OUT_OF_SCOPE"
  | "SUBJECT_OUT_OF_SCOPE"
  | "CLAIM_NOT_FOUND"
  | "CLAIM_NOT_SUPERSEDABLE"
  | "CLAIM_NOT_RETRACTABLE"
  | "GOVERNANCE_FIELD_FORBIDDEN"
  | "BUYER_MERGE_NOT_IMPLEMENTED";

export class CorporateMemoryError extends Error {
  readonly code: CorporateMemoryErrorCode;

  constructor(code: CorporateMemoryErrorCode, message: string) {
    super(message);
    this.name = "CorporateMemoryError";
    this.code = code;
  }
}

export function isCorporateMemoryError(
  err: unknown,
  code?: CorporateMemoryErrorCode,
): err is CorporateMemoryError {
  // 结构化判别（不仅 instanceof）：跨 bundle / tsx 双模块实例时 instanceof 会失效，
  // 但 name+code 形状稳定。生产 API 边界与测试接缝都依赖此健壮性。
  const isShape =
    err instanceof CorporateMemoryError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: unknown }).name === "CorporateMemoryError" &&
      typeof (err as { code?: unknown }).code === "string");
  if (!isShape) return false;
  return code === undefined || (err as CorporateMemoryError).code === code;
}

// --- 共享校验工具（手写 narrowing，遵循仓库约定；不引入 zod） ---

export function requireVocab<T extends string>(
  value: unknown,
  vocab: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !vocab.includes(value as T)) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      `${field} 必须是 ${vocab.join("|")} 之一`,
    );
  }
  return value as T;
}

export function requireBoundedString(
  value: unknown,
  field: string,
  maxChars: number,
  opts?: { optional?: boolean },
): string | null {
  if (value === undefined || value === null || value === "") {
    if (opts?.optional) return null;
    throw new CorporateMemoryError("INVALID_INPUT", `${field} 必填`);
  }
  if (typeof value !== "string") {
    throw new CorporateMemoryError("INVALID_INPUT", `${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (opts?.optional) return null;
    throw new CorporateMemoryError("INVALID_INPUT", `${field} 必填`);
  }
  if (trimmed.length > maxChars) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      `${field} 超出长度上限 ${maxChars} 字符`,
    );
  }
  return trimmed;
}

export function requireDate(value: unknown, field: string): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  throw new CorporateMemoryError("INVALID_INPUT", `${field} 必须是有效 Date`);
}

export function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null) return null;
  return requireDate(value, field);
}

/// JSON 载荷字节上限校验（UTF-8）；不可序列化即拒绝。
export function requireBoundedJson(
  value: unknown,
  field: string,
  maxBytes: number = MEMORY_LIMITS.JSON_MAX_BYTES,
): unknown {
  if (value === undefined || value === null) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new CorporateMemoryError("INVALID_INPUT", `${field} 无法序列化为 JSON`);
  }
  if (serialized === undefined) {
    throw new CorporateMemoryError("INVALID_INPUT", `${field} 无法序列化为 JSON`);
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      `${field} 超出大小上限 ${maxBytes} 字节`,
    );
  }
  return value;
}
