/**
 * 业务标签单一真相源
 *
 * 所有阶段、状态、推荐、风险、日期字段的中文标签集中在此。
 * 前端组件、API、AI prompt 统一从这里引用，不要各自定义。
 *
 * 当前场景：招投标项目管理（Tender / BidToGo）
 * 如需切换行业，只需修改本文件中的映射表。
 */

// ── 内部项目阶段（6 阶段流水线） ─────────────────────────────

export const INTERNAL_STAGE_LABELS: Record<string, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

// ── 外部 / 集成状态（tenderStatus） ──────────────────────────

export const TENDER_STATUS_LABELS: Record<string, string> = {
  new: "新导入",
  under_review: "审核中",
  qualification_check: "资质检查",
  pursuing: "跟进中",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  bid_preparation: "投标准备",
  bid_submitted: "已提交",
  won: "中标",
  lost: "未中标",
  passed: "已放弃",
  archived: "已归档",
};

/**
 * intelligence-card 用的 tenderStatus 展示标签
 * 与 TENDER_STATUS_LABELS 略有不同（"新建"vs"新导入"），保留独立映射
 */
export const TENDER_STATUS_DISPLAY: Record<string, string> = {
  new: "新建",
  under_review: "审阅中",
  qualification_check: "资质验证",
  pursuing: "跟进中",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  bid_preparation: "投标准备",
  bid_submitted: "已投标",
  won: "中标",
  lost: "未中标",
  passed: "已放弃",
  archived: "已归档",
};

// ── AI 情报推荐 ──────────────────────────────────────────────

export const RECOMMENDATION_LABELS: Record<string, string> = {
  pursue: "建议投标",
  review_carefully: "谨慎评估",
  low_probability: "概率较低",
  skip: "建议放弃",
};

export const RECOMMENDATION_DISPLAY: Record<string, { label: string; cls: string }> = {
  pursue: { label: "建议跟进", cls: "bg-success-light text-success-text" },
  review_carefully: { label: "需仔细评估", cls: "bg-warning-light text-warning-text" },
  low_probability: { label: "低概率", cls: "bg-[rgba(110,125,118,0.08)] text-muted" },
  skip: { label: "建议跳过", cls: "bg-danger-light text-danger-text" },
};

// ── AI 情报风险 ──────────────────────────────────────────────

export const RISK_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  unassessed: "未评估",
};

export const RISK_DISPLAY: Record<string, { label: string; cls: string }> = {
  low: { label: "低风险", cls: "text-success-text" },
  medium: { label: "中风险", cls: "text-warning-text" },
  high: { label: "高风险", cls: "text-danger-text" },
  unassessed: { label: "未评估", cls: "text-muted" },
};

// ── 项目日期字段标签 ─────────────────────────────────────────

export const DATE_FIELD_LABELS: Record<string, string> = {
  publicDate: "发布时间",
  questionCloseDate: "提问截止时间",
  closeDate: "截标时间",
  submittedAt: "提交时间",
  awardDate: "结果公布时间",
  distributedAt: "分发时间",
  interpretedAt: "解读时间",
  supplierInquiredAt: "供应商询价时间",
  supplierQuotedAt: "供应商报价时间",
};

// ── 工具函数 ─────────────────────────────────────────────────

export function getInternalStageLabel(stage: string): string {
  return INTERNAL_STAGE_LABELS[stage] || stage;
}

export function getTenderStatusLabel(status: string): string {
  return TENDER_STATUS_LABELS[status] || status;
}

export function getDateFieldLabel(field: string): string {
  return DATE_FIELD_LABELS[field] || field;
}
