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
  // S3-A：同一 Run 的发现执行已在进行中（服务端重复执行保护，不依赖前端 disabled）
  | "RUN_EXECUTION_IN_PROGRESS"
  // FR1-C：上一次执行的声明已过期且从未正常释放——执行结果未知，禁止自动重跑，
  // 必须由有权限的人显式取消该 Run 后新建（no-takeover 策略）
  | "RUN_EXECUTION_RECOVERY_REQUIRED"
  // S3-B：工作层记录（如 Offering）已被别人改过——拒绝覆盖，要求刷新后再改
  | "STALE_WRITE"
  // S4-A：评估运行
  | "RUN_MODE_MISMATCH"          // 对评估运行做发现动作（或反之）
  | "ORIGIN_SOURCE_UNRESOLVED"   // 服务端无法证明候选的来源（未被搜到、也无已关联线索）
  | "EVIDENCE_REQUIRED"          // PASS/PARTIAL/FAIL 不能无证据保存
  | "ARCHIVE_PROJECT_MISMATCH"   // 档案证据不属于本评估的项目
  | "GATE_PENDING"               // 还有候选没算硬门，不能收口
  | "NO_CANDIDATE"               // 评估运行里没有任何候选，不能收口
  | "NO_DETERMINISTIC_RULE"      // 该要求没有可用的确定性规则
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
  RUN_EXECUTION_IN_PROGRESS: 409,
  RUN_EXECUTION_RECOVERY_REQUIRED: 409,
  STALE_WRITE: 409,
  RUN_MODE_MISMATCH: 409,
  ORIGIN_SOURCE_UNRESOLVED: 422,
  EVIDENCE_REQUIRED: 422,
  ARCHIVE_PROJECT_MISMATCH: 422,
  GATE_PENDING: 409,
  NO_CANDIDATE: 409,
  NO_DETERMINISTIC_RULE: 422,
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
