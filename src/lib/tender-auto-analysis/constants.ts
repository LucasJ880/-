/**
 * Phase 1.1 Tender Auto Analysis — 枚举与常量
 * 存储用 SECTION_KEYS；产品 UX 18 章通过 CHINESE_REPORT_CHAPTERS 映射。
 */

export const ANALYSIS_VERSION = "tender-auto-analysis-v1" as const;
export const PROMPT_VERSION = "tender-analysis-prompt-v1" as const;
/**
 * 页/单元解析语义版本。
 * v2（2026-08-16）：非 PDF 不再只存整篇 contentText，而是切成**可引用单元**
 * （sheet/block）并写入 ProjectDocumentPage。版本上调 = 既有文档在下次 ENSURE_PAGES
 * 时按新语义重解析（worker 的"已解析则跳过"判定以此版本为准）。
 */
export const PARSE_VERSION = "tender-page-parse-v2" as const;

/** 同一项目短时间重新分析上限（防成本放大） */
export const REANALYZE_RATE_WINDOW_MS = 5 * 60_000;
export const REANALYZE_RATE_MAX = 3;

export const TENDER_ANALYSIS_STATUSES = [
  "PENDING",
  "EXTRACTING",
  "ANALYZING",
  "REVIEW_REQUIRED",
  "APPROVED",
  "FAILED",
  "SUPERSEDED",
] as const;

export type TenderAnalysisStatus = (typeof TENDER_ANALYSIS_STATUSES)[number];

export const TERMINAL_STATUSES = ["APPROVED", "SUPERSEDED"] as const;
export type TerminalTenderAnalysisStatus = (typeof TERMINAL_STATUSES)[number];

export const CLAIMABLE_STATUSES = [
  "PENDING",
  "EXTRACTING",
  "ANALYZING",
  "FAILED",
] as const;

export const TENDER_ANALYSIS_RUN_KINDS = ["FULL", "INCREMENTAL"] as const;
export type TenderAnalysisRunKind = (typeof TENDER_ANALYSIS_RUN_KINDS)[number];

/**
 * RunDocument.role 为 String（非 Prisma enum）。
 * Phase 1.1.1 扩展角色；保留 ATTACHMENT 兼容旧数据（语义≈SUPPLEMENT）。
 */
export const DOCUMENT_ROLES = [
  "PRIMARY",
  "SUPPLEMENT",
  "PRICING",
  "FORM",
  "DRAWING",
  "ADDENDUM",
  "ATTACHMENT",
  "UNKNOWN",
] as const;
export type DocumentRole = (typeof DOCUMENT_ROLES)[number];

export const SECTION_KEYS = [
  "EXECUTIVE_SUMMARY",
  "PROJECT_INFORMATION",
  "PROCUREMENT_STRUCTURE",
  "PRODUCT_SCOPE",
  "MANDATORY_REQUIREMENTS",
  "SUBMISSION_REQUIREMENTS",
  "PRICING_EVALUATION",
  "DELIVERY_LOGISTICS",
  "PAYMENT",
  "CERTIFICATIONS",
  "ELIGIBILITY",
  "RISKS",
  "COMMERCIAL_ANALYSIS",
  "BID_STRATEGY",
  "CLARIFICATION_QUESTIONS",
  "FINAL_RECOMMENDATION",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * 产品 UX 固定 18 章 → 存储 sectionKey。
 * 多个章节可映射到同一 sectionKey（如提交要求拆两章、风险拆两章）。
 */
export const CHINESE_REPORT_CHAPTERS = [
  {
    order: 1,
    key: "project_overview",
    titleZh: "项目概要",
    sectionKey: "EXECUTIVE_SUMMARY",
  },
  {
    order: 2,
    key: "project_info_translation",
    titleZh: "项目基本信息翻译",
    sectionKey: "PROJECT_INFORMATION",
  },
  {
    order: 3,
    key: "procurement_content",
    titleZh: "采购内容",
    sectionKey: "PROCUREMENT_STRUCTURE",
  },
  {
    order: 4,
    key: "mandatory_requirements",
    // §12：mandatory=true 只代表「具有明确约束措辞」，≠ 投标关键要求/技术要求。
    // 投标关键要求由 Analyst impact 分类给出（analystSynthesis.keyRequirements）。
    titleZh: "具有约束措辞的条款",
    sectionKey: "MANDATORY_REQUIREMENTS",
  },
  {
    order: 5,
    key: "tech_submission",
    titleZh: "技术文件提交要求",
    sectionKey: "SUBMISSION_REQUIREMENTS",
  },
  {
    order: 6,
    key: "bid_submission",
    titleZh: "投标文件要求",
    sectionKey: "SUBMISSION_REQUIREMENTS",
  },
  {
    order: 7,
    key: "pricing_evaluation",
    titleZh: "价格与评标方式",
    sectionKey: "PRICING_EVALUATION",
  },
  {
    order: 8,
    key: "delivery_logistics",
    titleZh: "供货与物流",
    sectionKey: "DELIVERY_LOGISTICS",
  },
  {
    order: 9,
    key: "payment",
    titleZh: "付款条件",
    sectionKey: "PAYMENT",
  },
  {
    order: 10,
    key: "eco_packaging",
    titleZh: "环保包装",
    sectionKey: "CERTIFICATIONS",
  },
  {
    order: 11,
    key: "eligibility",
    titleZh: "供应商资格",
    sectionKey: "ELIGIBILITY",
  },
  {
    order: 12,
    key: "commercial_analysis",
    titleZh: "商业分析",
    sectionKey: "COMMERCIAL_ANALYSIS",
  },
  {
    order: 13,
    key: "product_development",
    titleZh: "产品开发难度",
    sectionKey: "PRODUCT_SCOPE",
  },
  {
    order: 14,
    key: "performance_risks",
    titleZh: "履约风险",
    sectionKey: "RISKS",
  },
  {
    order: 15,
    key: "pricing_risks",
    titleZh: "报价风险",
    sectionKey: "RISKS",
  },
  {
    order: 16,
    key: "bid_strategy",
    titleZh: "建议投标策略",
    sectionKey: "BID_STRATEGY",
  },
  {
    order: 17,
    key: "clarification_questions",
    titleZh: "待澄清问题",
    sectionKey: "CLARIFICATION_QUESTIONS",
  },
  {
    order: 18,
    key: "final_recommendation",
    titleZh: "综合结论",
    sectionKey: "FINAL_RECOMMENDATION",
  },
] as const;

export type ChineseReportChapter =
  (typeof CHINESE_REPORT_CHAPTERS)[number];

export const STATEMENT_KINDS = [
  "CONFIRMED_FACT",
  "DOCUMENT_INTERPRETATION",
  "AI_INFERENCE",
  "RECOMMENDATION",
] as const;

export type StatementKind = (typeof STATEMENT_KINDS)[number];

export const CONFIDENCE_LEVELS = [
  "CONFIRMED",
  "HIGH_CONFIDENCE",
  "INFERRED",
  "UNKNOWN",
] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const SECTION_REVIEW_STATUSES = [
  "AI_DRAFT",
  "HUMAN_EDITED",
  "APPROVED",
] as const;

export type SectionReviewStatus = (typeof SECTION_REVIEW_STATUSES)[number];

export const REQUIREMENT_COMPLIANCE_STATUSES = [
  "NOT_ASSESSED",
  "PARTIAL",
  "COMPLIANT",
  "NON_COMPLIANT",
  "NEEDS_CLARIFICATION",
] as const;

export type RequirementComplianceStatus =
  (typeof REQUIREMENT_COMPLIANCE_STATUSES)[number];

export const REQUIREMENT_REVIEW_STATUSES = [
  "AI_EXTRACTED",
  "CONFIRMED",
  "REJECTED",
] as const;

export type RequirementReviewStatus =
  (typeof REQUIREMENT_REVIEW_STATUSES)[number];

export const PROJECTION_STATUSES = [
  "NOT_PROJECTED",
  "PROJECTED",
  "SKIPPED",
] as const;

export type ProjectionStatus = (typeof PROJECTION_STATUSES)[number];

export const DELIVERABLE_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "WAIVED",
] as const;

export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

/** 稳定 deliverableKey（重试不重复创建） */
export const DELIVERABLE_KEYS = [
  "technical_offer",
  "financial_offer",
  "certifications",
  "m1_m15_compliance_matrix",
  "independent_offer_determination",
  "reciprocal_procurement_declaration",
  "environmentally_preferable_packaging_declaration",
  "product_specification",
  "oem_certificate",
  "bid_email_check",
] as const;

export type DeliverableKey = (typeof DELIVERABLE_KEYS)[number];

export const DELIVERABLE_DEFINITIONS: ReadonlyArray<{
  key: DeliverableKey;
  title: string;
  mandatory: boolean;
}> = [
  { key: "technical_offer", title: "Technical Offer", mandatory: true },
  { key: "financial_offer", title: "Financial Offer", mandatory: true },
  { key: "certifications", title: "Certifications", mandatory: true },
  {
    key: "m1_m15_compliance_matrix",
    title: "M1–M15 Compliance Matrix",
    mandatory: true,
  },
  {
    key: "independent_offer_determination",
    title: "Certificate of Independent Offer Determination",
    mandatory: true,
  },
  {
    key: "reciprocal_procurement_declaration",
    title: "Reciprocal Procurement Declaration",
    mandatory: true,
  },
  {
    key: "environmentally_preferable_packaging_declaration",
    title: "Environmentally Preferable Packaging Declaration",
    mandatory: true,
  },
  { key: "product_specification", title: "产品规格书", mandatory: true },
  { key: "oem_certificate", title: "OEM证明", mandatory: false },
  { key: "bid_email_check", title: "投标邮件检查", mandatory: true },
];

export const CLARIFICATION_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "BLOCKING",
] as const;

export type ClarificationPriority = (typeof CLARIFICATION_PRIORITIES)[number];

export const CLARIFICATION_STATUSES = [
  "OPEN",
  "SENT",
  "ANSWERED",
  "WITHDRAWN",
] as const;

export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number];

export const CHANGE_TYPES = [
  "ADDED",
  "REMOVED",
  "MODIFIED",
  "DATE_CHANGED",
  "QUANTITY_CHANGED",
  "PRICING_CHANGED",
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_CANDIDATE_STATUSES = [
  "PENDING_REVIEW",
  "APPLIED",
  "REJECTED",
] as const;

export type ChangeCandidateStatus = (typeof CHANGE_CANDIDATE_STATUSES)[number];

/** 任务 sourceTemplateKey：重试/幂等不重复创建 */
export const TASK_TEMPLATE_KEYS = {
  review_ai_analysis: "tender_analysis:review_ai_analysis",
  review_m1_m15: "tender_analysis:review_m1_m15",
  contact_backpack_factory: "tender_analysis:contact_backpack_factory",
  get_formal_spec: "tender_analysis:get_formal_spec",
  get_oem_en_certificate: "tender_analysis:get_oem_en_certificate",
  confirm_inventory_plan: "tender_analysis:confirm_inventory_plan",
  get_ddp_regina_quote: "tender_analysis:get_ddp_regina_quote",
  prepare_eco_packaging_declaration:
    "tender_analysis:prepare_eco_packaging_declaration",
  submit_clarifications: "tender_analysis:submit_clarifications",
  prepare_three_pdfs: "tender_analysis:prepare_three_pdfs",
  check_email_under_5mb: "tender_analysis:check_email_under_5mb",
  /** 保留旧键以防既有数据引用 */
  review_report: "tender_analysis:review_report",
  confirm_requirements: "tender_analysis:confirm_requirements",
  answer_clarifications: "tender_analysis:answer_clarifications",
  prepare_deliverables: "tender_analysis:prepare_deliverables",
  resolve_quantity_ambiguity: "tender_analysis:resolve_quantity_ambiguity",
} as const;

export type TaskTemplateKey =
  (typeof TASK_TEMPLATE_KEYS)[keyof typeof TASK_TEMPLATE_KEYS];

/** 本阶段实际创建的任务模板（稳定顺序） */
export const ANALYSIS_TASK_SPECS: ReadonlyArray<{
  templateKey: TaskTemplateKey;
  title: string;
  description: string;
  priority: "urgent" | "high" | "medium" | "low";
}> = [
  {
    templateKey: TASK_TEMPLATE_KEYS.review_ai_analysis,
    title: "复核 AI 标书分析报告",
    description: "审阅自动生成的中文分析各章节，确认无编造内容并标记人工修订。",
    priority: "high",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.review_m1_m15,
    title: "复核 M1–M15 强制技术要求",
    description: "对照原文核对 M1–M15；合规状态保持未评估，直至人工确认。",
    priority: "high",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.contact_backpack_factory,
    title: "联系背包工厂",
    description: "接触具备制式/户外背包能力的工厂，确认打样与产能窗口。",
    priority: "high",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.get_formal_spec,
    title: "获取正式产品规格",
    description: "向买方/附件渠道确认正式规格与图纸版本。",
    priority: "high",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.get_oem_en_certificate,
    title: "获取 OEM / EN 相关证书路径",
    description: "确认 OEM 证明及适用 EN/测试报告的获取路径（以原文要求为准）。",
    priority: "medium",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.confirm_inventory_plan,
    title: "确认库存与备货计划",
    description: "在数量歧义澄清前先做情景化库存计划，勿按 7,500 保证销量备货。",
    priority: "medium",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.get_ddp_regina_quote,
    title: "获取 DDP Regina 物流报价",
    description: "核算完税交货至 Regina 的端到端物流与关税成本。",
    priority: "high",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.prepare_eco_packaging_declaration,
    title: "准备环保包装声明",
    description: "按 Environmentally Preferable Packaging 要求准备声明文本。",
    priority: "medium",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.submit_clarifications,
    title: "提交澄清问题",
    description: "在询价截止日前汇总并提交数量/样品/测试标准/海外制造等澄清。",
    priority: "urgent",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.prepare_three_pdfs,
    title: "准备三份投标 PDF",
    description: "按 three PDFs 结构准备技术/商务/证书等提交文件。",
    priority: "high",
  },
  {
    templateKey: TASK_TEMPLATE_KEYS.check_email_under_5mb,
    title: "检查投标邮件 <5MB",
    description: "打包后验证邮件总附件大小严格小于 5MB。",
    priority: "high",
  },
];

export const WORKER_STEPS = [
  "CLAIMED",
  "ENSURE_PAGES",
  "EXTRACT_FACTS",
  "GENERATE_SECTIONS",
  "EXTRACT_REQUIREMENTS",
  "BUILD_DELIVERABLES",
  "BUILD_CLARIFICATIONS",
  "CREATE_TASKS",
  "PROJECT_ROOM",
  "FINALIZE",
] as const;

export type WorkerStep = (typeof WORKER_STEPS)[number];

export function isTenderAnalysisStatus(
  v: string,
): v is TenderAnalysisStatus {
  return (TENDER_ANALYSIS_STATUSES as readonly string[]).includes(v);
}

export function isSectionKey(v: string): v is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(v);
}

export function isStatementKind(v: string): v is StatementKind {
  return (STATEMENT_KINDS as readonly string[]).includes(v);
}
