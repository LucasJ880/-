/**
 * Supplier Intelligence M1-S1 — 词表与目录（单一事实源）
 *
 * 设计冻结：docs/QYANE_SUPPLIER_INTELLIGENCE_M1_DESIGN.md（v2）。
 * 目录一律 fail-closed：不在目录内的值在服务层拒收（T8），扩目录=改代码+评审。
 */

// ── 平台 / 来源 ─────────────────────────────────────────────

export const SIGNAL_PLATFORMS = [
  "DOUYIN",
  "XIAOHONGSHU",
  "WECHAT_CHANNELS",
  "ONE688",
  "WEBSITE",
  "OPEN_WEB",
  "MANUAL",
] as const;
export type SignalPlatform = (typeof SIGNAL_PLATFORMS)[number];

export const SIGNAL_CONTENT_TYPES = ["VIDEO", "POST", "PROFILE", "USER_SUBMITTED"] as const;
export type SignalContentType = (typeof SIGNAL_CONTENT_TYPES)[number];

/** 信任与合规策略按 sourceOrigin 走（展示按 platform 走） */
export const SIGNAL_SOURCE_ORIGINS = [
  "USER_SUBMITTED",
  "PUBLIC_WEB",
  "PROVIDER",
  "MANUAL_ENTRY",
] as const;
export type SignalSourceOrigin = (typeof SIGNAL_SOURCE_ORIGINS)[number];

// ── 信号状态机 ──────────────────────────────────────────────

export const SIGNAL_STATUSES = ["NEW", "REVIEWED", "LINKED", "REJECTED"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

/** REJECTED/LINKED 为终态（REJECTED 不物理删——保留「看过并否决」记忆） */
export const SIGNAL_TRANSITIONS: Record<SignalStatus, readonly SignalStatus[]> = {
  NEW: ["REVIEWED", "LINKED", "REJECTED"],
  REVIEWED: ["LINKED", "REJECTED"],
  LINKED: [],
  REJECTED: [],
};

// ── Run 状态机（B.1 §7）────────────────────────────────────

export const RUN_STATUSES = ["PLANNED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TERMINAL_STATUSES: readonly RunStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

/** 终态不得重新进入 RUNNING */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  PLANNED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isRunTerminal(status: string): boolean {
  return (RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function canTransitionRun(from: string, to: string): boolean {
  const allowed = RUN_TRANSITIONS[from as RunStatus];
  return Boolean(allowed && (allowed as readonly string[]).includes(to));
}

// ── 信任级（Addendum §5）───────────────────────────────────

export const EVIDENCE_STATUSES = ["CLAIMED", "OBSERVED", "VERIFIED", "UNKNOWN"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** social/discovery 写路径的合法值域——VERIFIED 不在其中（R1，硬边界 H5） */
export const SOCIAL_WRITE_EVIDENCE_STATUSES = ["CLAIMED", "OBSERVED", "UNKNOWN"] as const;
export type SocialWriteEvidenceStatus = (typeof SOCIAL_WRITE_EVIDENCE_STATUSES)[number];

export const CAPABILITY_EXTRACTED_BY = ["HUMAN", "AI_ASSISTED"] as const;
export type CapabilityExtractedBy = (typeof CAPABILITY_EXTRACTED_BY)[number];

/** AI 标注的 OBSERVED/CLAIMED 置信上限（B.1 §12） */
export const AI_ASSISTED_CONFIDENCE_CAP = 0.8;

// ── Capability 目录（Addendum §4 起始集，fail-closed）───────

export const CAPABILITY_TYPES = [
  "FACTORY_FLOOR",
  "CNC_CAPABILITY",
  "LASER_CUTTING",
  "INJECTION_MOLDING",
  "POWDER_COATING",
  "ASSEMBLY_LINE",
  "CUSTOM_TOOLING",
  "OEM_SUPPORT",
  "ODM_SUPPORT",
  "EXPORT_PACKAGING",
  "TESTING_CAPABILITY",
  "WAREHOUSE",
  "HIGH_VOLUME_PRODUCTION",
  "SMALL_BATCH_PRODUCTION",
  "CUSTOM_PACKAGING",
  "OVERSEAS_EXPORT",
  "CANADA_EXPORT",
  "CERTIFICATION",
] as const;
export type CapabilityType = (typeof CAPABILITY_TYPES)[number];

// ── Certification（B5）────────────────────────────────────

export const CERTIFICATION_SCOPES = ["SUPPLIER", "PRODUCT", "MODEL_SERIES"] as const;
export type CertificationScope = (typeof CERTIFICATION_SCOPES)[number];

export const CERTIFICATION_STATUSES = ["CLAIMED", "VERIFIED", "REJECTED", "EXPIRED"] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

/** 认证状态机：VERIFIED 只能经 verifyCertification（人工+独立证据）到达 */
export const CERTIFICATION_TRANSITIONS: Record<CertificationStatus, readonly CertificationStatus[]> = {
  CLAIMED: ["VERIFIED", "REJECTED"],
  VERIFIED: ["EXPIRED", "REJECTED"],
  REJECTED: [],
  EXPIRED: [],
};

export const CERTIFICATION_TYPES = [
  "UL",
  "ETL",
  "CSA",
  "BIFMA",
  "GREENGUARD",
  "ISO_9001",
  "ISO_14001",
  "CE",
  "FCC",
  "ROHS",
  "REACH",
  "FSC",
  "BSCI",
  "SMETA",
  "SA8000",
  "OTHER",
] as const;
export type CertificationType = (typeof CERTIFICATION_TYPES)[number];

export const CERTIFICATION_SOURCE_KINDS = [
  "SOCIAL",
  "WEBSITE",
  "BROCHURE",
  "USER_ENTRY",
  "REGISTRY",
] as const;
export type CertificationSourceKind = (typeof CERTIFICATION_SOURCE_KINDS)[number];

/** 仅凭 source 自身不能 VERIFIED 的来源（B.1 §11）——须另附独立证据 */
export const CLAIM_ONLY_CERT_SOURCE_KINDS: readonly CertificationSourceKind[] = [
  "SOCIAL",
  "WEBSITE",
  "BROCHURE",
];

/**
 * F1.6 fail-closed registry 契约：REGISTRY 证据只认这里登记的官方可查库
 * （host 白名单 endsWith 匹配 + https）。任意网站 URL 标成 REGISTRY 不构成证据；
 * 扩库 = 改代码 + 评审。验证仍需人工动作（本目录只解决「什么算官方登记库」）。
 */
export const SUPPORTED_REGISTRY_PROVIDERS = [
  { id: "GSXT", label: "国家企业信用信息公示系统", hosts: ["gsxt.gov.cn"] },
  { id: "UL_PRODUCT_IQ", label: "UL Product iQ", hosts: ["productiq.ul.com", "ul.com"] },
  { id: "INTERTEK_DIRECTORY", label: "Intertek ETL Listed Directory", hosts: ["intertek.com"] },
  { id: "CSA_GROUP", label: "CSA Group Certified Product Listing", hosts: ["csagroup.org"] },
  { id: "BIFMA_REGISTRY", label: "BIFMA Compliant Registry", hosts: ["bifma.org"] },
  { id: "IAF_CERTSEARCH", label: "IAF CertSearch（ISO 体系认证核验）", hosts: ["iafcertsearch.org"] },
] as const;
export type RegistryProviderId = (typeof SUPPORTED_REGISTRY_PROVIDERS)[number]["id"];

/** 纯函数：URL → 受支持的官方登记库；不匹配返回 null（fail-closed，调用方拒绝） */
export function resolveRegistryProvider(
  rawUrl: string | null | undefined,
): { id: RegistryProviderId; label: string } | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  for (const provider of SUPPORTED_REGISTRY_PROVIDERS) {
    if (provider.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return { id: provider.id, label: provider.label };
    }
  }
  return null;
}

// ── Offering（B4）─────────────────────────────────────────

export const OFFERING_PRICE_STATUSES = ["KNOWN", "ESTIMATED", "UNKNOWN"] as const;
export type OfferingPriceStatus = (typeof OFFERING_PRICE_STATUSES)[number];

export const OFFERING_SOURCE_KINDS = ["DISCOVERY", "MANUAL", "BROCHURE", "INQUIRY"] as const;
export type OfferingSourceKind = (typeof OFFERING_SOURCE_KINDS)[number];

// ── Candidate（B2）────────────────────────────────────────

/** 检索优先级 1–5 的审计痕迹（B.1 §9） */
export const CANDIDATE_ORIGIN_SOURCES = [
  "MEMORY",
  "HISTORICAL_SUCCESS",
  "SAVED",
  "EXTERNAL_SEARCH",
  "NEW_DISCOVERY",
] as const;
export type CandidateOriginSource = (typeof CANDIDATE_ORIGIN_SOURCES)[number];

export const MANDATORY_GATE_RESULTS = ["PASS", "FAIL", "INCOMPLETE", "PENDING"] as const;
export type MandatoryGateResult = (typeof MANDATORY_GATE_RESULTS)[number];

export const RECOMMENDATIONS = [
  "PRIMARY",
  "BACKUP",
  "NEEDS_VERIFICATION",
  "HIGH_RISK",
  "NOT_ELIGIBLE",
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

// ── Requirement Match（B3）────────────────────────────────

export const MATCH_VERDICTS = ["PASS", "PARTIAL", "FAIL", "UNKNOWN"] as const;
export type MatchVerdict = (typeof MATCH_VERDICTS)[number];

export const MATCH_EVALUATED_BY = ["HUMAN", "AI_ASSISTED", "DETERMINISTIC"] as const;
export type MatchEvaluatedBy = (typeof MATCH_EVALUATED_BY)[number];

/** matching/gate 逻辑版本（Run 创建即冻结） */
export const SUPPLIER_EVALUATION_VERSION_V1 = "supplier-eval-v1";

// ── 输入上限（B.1 §17：用户提交 = untrusted external input）──

export const SUPPLIER_INTEL_LIMITS = {
  /** 提交 URL 最大长度 */
  URL_MAX_LENGTH: 2048,
  /** 粘贴文案最大长度 */
  RAW_TEXT_MAX_LENGTH: 20_000,
  /** rawMetadataJson 序列化后最大字节数 */
  METADATA_MAX_BYTES: 32_768,
  /** capability explanation 最大长度 */
  EXPLANATION_MAX_LENGTH: 2_000,
  /** 账号名/标题等短字段最大长度 */
  SHORT_TEXT_MAX_LENGTH: 300,
  /** 一次 Run 的 requirement 快照最大条数（防滥用，正常标书远低于此） */
  REQUIREMENT_SNAPSHOT_MAX_ENTRIES: 500,
} as const;

// ── 审计动作（B.1 §18；沿用既有 audit infrastructure，不自造 logger）──

export const SUPPLIER_INTEL_AUDIT_ACTIONS = {
  RUN_CREATED: "supplier_intel.run.created",
  RUN_STARTED: "supplier_intel.run.started",
  RUN_COMPLETED: "supplier_intel.run.completed",
  RUN_FAILED: "supplier_intel.run.failed",
  RUN_CANCELLED: "supplier_intel.run.cancelled",
  SIGNAL_CREATED: "supplier_intel.signal.created",
  SIGNAL_REVIEWED: "supplier_intel.signal.reviewed",
  SIGNAL_LINKED: "supplier_intel.signal.linked",
  SIGNAL_REJECTED: "supplier_intel.signal.rejected",
  CERTIFICATION_VERIFIED: "supplier_intel.certification.verified",
} as const;
