/**
 * Supplier Intelligence 域错误（coded error 风格，对齐 quote-engine/mention-gateway；
 * 路由按 code/httpStatus 显式映射，禁止把裸 err.message 回显给客户端之外的语义）。
 */

export type SupplierIntelErrorCode =
  // 校验（400/422）
  | "EMPTY_SUBMISSION"
  | "INVALID_URL_SCHEME"
  | "URL_TOO_LONG"
  | "RAW_TEXT_TOO_LONG"
  | "METADATA_TOO_LARGE"
  | "EXPLANATION_TOO_LONG"
  | "SHORT_TEXT_TOO_LONG"
  | "UNKNOWN_CAPABILITY_TYPE"
  | "UNKNOWN_CERTIFICATION_TYPE"
  | "INVALID_SCOPE"
  | "INVALID_VERDICT"
  | "INVALID_ORIGIN_SOURCE"
  | "INVALID_EVIDENCE_STATUS"
  | "INVALID_REQUIREMENT_SNAPSHOT"
  | "REQUIREMENT_KEY_NOT_IN_SNAPSHOT"
  | "AI_CONFIDENCE_EXCEEDS_CAP"
  | "SOCIAL_VERIFIED_WRITE_BLOCKED"
  | "CERT_VERIFY_REQUIRES_EVIDENCE"
  | "OFFERING_SUPPLIER_MISMATCH"
  // F1 证据/溯源 fail-closed（S1 Final Review）
  | "ARCHIVE_EVIDENCE_NOT_FOUND"
  | "CERT_SUPPLIER_MISMATCH"
  | "CERT_SCOPE_MISMATCH"
  | "SIGNAL_NOT_LINKED_TO_SUPPLIER"
  | "SOURCE_SIGNAL_MISMATCH"
  | "REGISTRY_PROVIDER_UNSUPPORTED"
  // S2 Provider 策略门（H3/H4 机制化落点，fail-closed）
  | "PROVIDER_POLICY_BLOCKED"
  // S2 Final Review B3：项目级授权（org 成员 ≠ 项目可见/可写）
  | "PROJECT_ACCESS_DENIED"
  // S2 Final Review B1：canonical 需求源
  | "CANONICAL_REQUIREMENTS_UNAVAILABLE"
  | "BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE"
  | "INVALID_INPUT"
  // 资源（404，跨租户按不存在处理，不泄露存在性）
  | "NOT_FOUND"
  // 状态冲突（409）
  | "INVALID_RUN_TRANSITION"
  | "RUN_IMMUTABLE"
  | "RUN_NOT_RUNNING"
  | "INVALID_SIGNAL_TRANSITION"
  | "INVALID_CERT_TRANSITION"
  | "DUPLICATE_CANDIDATE"
  | "DUPLICATE_MATCH"
  | "SUPPLIER_HAS_INTELLIGENCE_HISTORY";

const DEFAULT_STATUS: Partial<Record<SupplierIntelErrorCode, number>> = {
  NOT_FOUND: 404,
  INVALID_RUN_TRANSITION: 409,
  RUN_IMMUTABLE: 409,
  RUN_NOT_RUNNING: 409,
  INVALID_SIGNAL_TRANSITION: 409,
  INVALID_CERT_TRANSITION: 409,
  DUPLICATE_CANDIDATE: 409,
  DUPLICATE_MATCH: 409,
  SUPPLIER_HAS_INTELLIGENCE_HISTORY: 409,
  SOCIAL_VERIFIED_WRITE_BLOCKED: 422,
  CERT_VERIFY_REQUIRES_EVIDENCE: 422,
  REQUIREMENT_KEY_NOT_IN_SNAPSHOT: 422,
  ARCHIVE_EVIDENCE_NOT_FOUND: 422,
  CERT_SUPPLIER_MISMATCH: 422,
  CERT_SCOPE_MISMATCH: 422,
  SIGNAL_NOT_LINKED_TO_SUPPLIER: 422,
  SOURCE_SIGNAL_MISMATCH: 422,
  REGISTRY_PROVIDER_UNSUPPORTED: 422,
  PROVIDER_POLICY_BLOCKED: 422,
  PROJECT_ACCESS_DENIED: 403,
  CANONICAL_REQUIREMENTS_UNAVAILABLE: 409,
  BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE: 409,
};

export class SupplierIntelError extends Error {
  readonly code: SupplierIntelErrorCode;
  readonly httpStatus: number;

  constructor(code: SupplierIntelErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = "SupplierIntelError";
    this.code = code;
    this.httpStatus = httpStatus ?? DEFAULT_STATUS[code] ?? 400;
  }
}

export function isSupplierIntelError(
  err: unknown,
  code?: SupplierIntelErrorCode,
): err is SupplierIntelError {
  if (!(err instanceof SupplierIntelError)) return false;
  return code === undefined || err.code === code;
}
