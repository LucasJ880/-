/**
 * T2-P1.5 Project Financial Control — 类型、类别词表、状态机、错误
 *
 * 边界（继承 T2-P1 冻结契约）：
 * - 权威成本仍是 ProjectCost（cost-service.ts）；本模块不新建第二成本源。
 * - 费用审批产出的成本类别必须落在冻结的 PROJECT_COST_CATEGORIES 内（禁 AI/DATA_API）。
 * - 预算行类别是「规划 taxonomy」（含 OVERHEAD/CONTINGENCY/PROFIT 等规划构造），
 *   与「实际成本 taxonomy」解耦；budget-vs-actual 靠 budgetLineId 链接滚动，而非类别名匹配。
 */

/* ---------------------------------- 预算行类别（规划 taxonomy） ---------------------------------- */

export const BUDGET_LINE_CATEGORIES = [
  "MATERIAL",
  "LABOUR",
  "FREIGHT",
  "DUTY",
  "INSTALLATION",
  "EQUIPMENT",
  "SUBCONTRACT",
  "TRAVEL",
  "OVERHEAD",
  "CONTINGENCY",
  "PROFIT",
  "OTHER",
] as const;
export type BudgetLineCategory = (typeof BUDGET_LINE_CATEGORIES)[number];

/** 百分比型预算行（金额由 basis 计算得来，必须保留可还原的计算基础，禁止只存最终金额） */
export const PERCENTAGE_BUDGET_CATEGORIES: readonly BudgetLineCategory[] = [
  "OVERHEAD",
  "CONTINGENCY",
  "PROFIT",
];

/**
 * 费用的成本类别 = 冻结的 ProjectCost 类别减去 AI/DATA_API（后者是 AiUsageLedger 专属）。
 * 审批时 ProjectCost.category = expense.costCategory（1:1，不做有损映射）。
 * 这里显式复制常量而非 import project-ledger/types，避免耦合其内部；值必须与之保持一致，
 * 由 p15-pure 测试静态断言二者一致（防漂移）。
 */
export const EXPENSE_COST_CATEGORIES = [
  "INTERNAL_LABOR",
  "SITE_VISIT",
  "MILEAGE",
  "PARKING",
  "SAMPLE",
  "COURIER",
  "BOND_INSURANCE",
  "CONSULTANT",
  "SUPPLIER",
  "SUBCONTRACTOR",
  "OTHER",
] as const;
export type ExpenseCostCategory = (typeof EXPENSE_COST_CATEGORIES)[number];

/* ---------------------------------- 预算版本状态 ---------------------------------- */

export const BUDGET_VERSION_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "SUPERSEDED",
  "AWARD_BASELINE",
] as const;
export type BudgetVersionStatus = (typeof BUDGET_VERSION_STATUSES)[number];

/* ---------------------------------- 费用提交状态机 ---------------------------------- */

export const EXPENSE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "PENDING_REVIEW",
  "NEEDS_INFO",
  "RESUBMITTED",
  "REJECTED",
  "APPROVED",
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/**
 * 合法状态转移（集中定义；禁止散落在 route/UI）。
 * APPROVED / REJECTED 为终态（REJECTED 只能经新的 submission/revision 契约重开，不在此表内直转 APPROVED）。
 */
export const EXPENSE_TRANSITIONS: Readonly<Record<ExpenseStatus, readonly ExpenseStatus[]>> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["PENDING_REVIEW"],
  PENDING_REVIEW: ["NEEDS_INFO", "REJECTED", "APPROVED"],
  NEEDS_INFO: ["RESUBMITTED"],
  RESUBMITTED: ["PENDING_REVIEW"],
  REJECTED: [],
  APPROVED: [],
};

export function canTransitionExpense(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return EXPENSE_TRANSITIONS[from]?.includes(to) ?? false;
}

/* ---------------------------------- 错误 ---------------------------------- */

export class FinanceContractError extends Error {
  readonly code = "FINANCE_CONTRACT_VIOLATION";
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "FinanceContractError";
  }
}

/** 状态机非法转移 */
export class ExpenseStateError extends Error {
  readonly code = "EXPENSE_INVALID_TRANSITION";
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "ExpenseStateError";
  }
}

/** 自审批禁止（submittedById === reviewedById） */
export class SelfApprovalError extends Error {
  readonly code = "EXPENSE_SELF_APPROVAL_FORBIDDEN";
  constructor(message = "费用提交人不得审核自己的费用；需由另一 accounting 或项目 owner/admin 审核") {
    super(message);
    this.name = "SelfApprovalError";
  }
}

/** 预算 AWARD_BASELINE 冻结后不可原地改财务事实 */
export class BaselineImmutableError extends Error {
  readonly code = "BUDGET_BASELINE_IMMUTABLE";
  constructor(message = "AWARD_BASELINE 预算版本已冻结，财务事实不可原地修改；请创建新版本") {
    super(message);
    this.name = "BaselineImmutableError";
  }
}

/** 项目未处于中标/合同确认态，不得冻结 AWARD_BASELINE（不新造 award state，读现有 canonical 字段） */
export class ProjectNotAwardedError extends Error {
  readonly code = "PROJECT_NOT_AWARDED";
  constructor(
    message = "仅中标/合同确认（bidPhaseStatus=AWARDED / tenderStatus=won / workDomain=delivery）的项目可冻结 AWARD_BASELINE",
    public readonly statusCode = 409,
  ) {
    super(message);
    this.name = "ProjectNotAwardedError";
  }
}

/**
 * AWARD_BASELINE 冻结资格：项目须处于仓库既有 canonical「中标/合同确认」态之一。
 * 不新造 award 状态——只读现有 canonical「我方中标」字段：
 *  - bidPhaseStatus === "AWARDED"（Phase1 投标工作流中标终态，label「已中标」，与 LOST 互斥）
 *  - tenderStatus === "won"（招标结果，仅 markProjectTenderResult(result="won") 写入，与 "lost" 互斥）
 *  - workDomain === "delivery"（交付项目：由中标投标 handoff 派生，handoff 强制 tenderStatus="won"）
 *
 * 刻意不含 awardDate：它是「结果公布时间」（announcement date，kind=external），
 * won/lost/no_bid/cancelled 任一结果都可能有值——对 LOST 项目也非空，故不是「我方中标」信号，
 * 纳入会让落标但已公布结果的项目错误通过资格（审计确认，见 T3.5/P1.5 remediation 报告）。
 */
export function isProjectAwardEligible(project: {
  bidPhaseStatus?: string | null;
  tenderStatus?: string | null;
  workDomain?: string | null;
}): boolean {
  return (
    project.bidPhaseStatus === "AWARDED" ||
    project.tenderStatus === "won" ||
    project.workDomain === "delivery"
  );
}

export class FinanceTenantError extends Error {
  readonly code = "FINANCE_TENANT_MISMATCH";
  constructor(message = "resource not found in organization/project") {
    super(message);
    this.name = "FinanceTenantError";
  }
}

/* ═══════════════════════════ T2-P1.6 追加词表与语义 ═══════════════════════════ */

/* ---------------------------------- 出资来源（谁先付的钱） ---------------------------------- */

/**
 * 每笔费用必须能回答「谁先付了这笔钱？」。
 * 与「成本归属」正交：无论谁垫付，经济成本一律归属该 Project/Tender。
 */
export const EXPENSE_FUNDING_SOURCES = [
  "EMPLOYEE_PERSONAL",
  "COMPANY_CARD",
  "COMPANY_BANK",
  "CHINA_AFFILIATE",
  "VENDOR_INVOICE_UNPAID",
  "OTHER",
] as const;
export type ExpenseFundingSource = (typeof EXPENSE_FUNDING_SOURCES)[number];

/** 普通人能读懂的 UI 文案（不暴露 enum 给最终用户）。 */
export const FUNDING_SOURCE_LABELS: Readonly<Record<ExpenseFundingSource, string>> = {
  EMPLOYEE_PERSONAL: "我自己先垫付",
  COMPANY_CARD: "公司信用卡",
  COMPANY_BANK: "公司银行付款",
  CHINA_AFFILIATE: "国内公司代付",
  VENDOR_INVOICE_UNPAID: "供应商发票 — 未付款",
  OTHER: "其它",
};

/* ---------------------------------- 结算子账（≠ 成本） ---------------------------------- */

export const SETTLEMENT_TYPES = [
  "EMPLOYEE_REIMBURSEMENT",
  "VENDOR_PAYMENT",
  "AFFILIATE_SETTLEMENT",
] as const;
export type SettlementType = (typeof SETTLEMENT_TYPES)[number];

export const PAYEE_TYPES = ["USER", "VENDOR", "AFFILIATE"] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];

export const PAYABLE_STATUSES = [
  "PENDING_PAYMENT",
  "PARTIALLY_PAID",
  "PAID",
  "VOID",
] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export const PAYMENT_METHODS = [
  "BANK_TRANSFER",
  "ETRANSFER",
  "PAYROLL",
  "CHEQUE",
  "CASH",
  "CREDIT_NOTE",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * 出资来源 → 结算义务映射（RULE 6：审批 ≠ 付款）。
 * null = 审批**不产生**任何应付（公司已直接付清，或 legacy 未标注）。
 *
 * 关键不变量：COMPANY_CARD / COMPANY_BANK 的 employee payable 恒为 0（REIMB-02 / REIMB-03）。
 */
export function settlementForFundingSource(
  fundingSource: string | null | undefined,
): { settlementType: SettlementType; payeeType: PayeeType } | null {
  switch (fundingSource) {
    case "EMPLOYEE_PERSONAL":
      return { settlementType: "EMPLOYEE_REIMBURSEMENT", payeeType: "USER" };
    case "CHINA_AFFILIATE":
      return { settlementType: "AFFILIATE_SETTLEMENT", payeeType: "AFFILIATE" };
    case "VENDOR_INVOICE_UNPAID":
      return { settlementType: "VENDOR_PAYMENT", payeeType: "VENDOR" };
    // 公司已直接支付 / 其它 / legacy NULL（UNSPECIFIED）→ 无结算义务
    case "COMPANY_CARD":
    case "COMPANY_BANK":
    case "OTHER":
    default:
      return null;
  }
}

/** payable 结算子账违规（重复付款 / 超付 / 已作废等）。 */
export class SettlementError extends Error {
  readonly code = "SETTLEMENT_CONTRACT_VIOLATION";
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "SettlementError";
  }
}

/* ---------------------------------- 收入账（唯一权威） ---------------------------------- */

export const REVENUE_ENTRY_TYPES = ["CONTRACT_AWARD", "CHANGE_ORDER", "ADJUSTMENT"] as const;
export type RevenueEntryType = (typeof REVENUE_ENTRY_TYPES)[number];

/**
 * 收入状态（R1 §H：收入确认 ≠ 收到现金）。
 *
 * - `FORECAST`   ：预期 / 合同额 / 已批变更单金额 —— 尚未确认为经济收入
 * - `RECOGNIZED` ：**经济收入已确认/定案**（履约完成、金额定案）。
 *                  刻意从 `REALIZED` 改名 —— 「realized」在中英文里都极易被读成
 *                  「钱已到账」，而这里表达的是**会计确认**，与客户是否付款无关。
 * - `VOIDED`     ：作废（修正走 VOID + replacement）
 *
 * **不在本域内**：invoice / customer payment / cash collection / AR aging。
 * 客户回款属于未来的 AR / settlement 域（见 CUSTOMER_COLLECTION_OUT_OF_SCOPE），
 * P1.6 不实现，也**禁止**未来用银行回款再产生第二条 revenue（收入只在本账确认一次）。
 */
export const REVENUE_STATUSES = ["FORECAST", "RECOGNIZED", "VOIDED"] as const;
export type RevenueStatus = (typeof REVENUE_STATUSES)[number];

/** 收入来源域（结构化 provenance；不建泛化 source framework，仅这两个值）。 */
export const REVENUE_SOURCE_TYPES = ["AWARD_RECORD", "MANUAL"] as const;
export type RevenueSourceType = (typeof REVENUE_SOURCE_TYPES)[number];

/**
 * 去重键构造（R1 §F）：ACTIVE 行写入，VOID 时置 NULL 释放键位。
 * 配合 `@@unique([projectId, activeSourceKey])` 保证「同 Project + 同来源 + CONTRACT_AWARD」
 * 至多一条**有效**权威收入行 —— 结构性约束，不依赖 findFirst + 开发者约定。
 */
export function buildRevenueActiveSourceKey(
  entryType: RevenueEntryType,
  sourceType: string | null | undefined,
  sourceRefId: string | null | undefined,
): string | null {
  if (!sourceType || !sourceRefId) return null;
  return `${entryType}:${sourceType}:${sourceRefId}`;
}

/**
 * 结算状态（R1 §G）：与利润**正交**的现金面状态。
 * Final Profit 可以成立的同时 settlement 仍为 OPEN —— 员工是否已拿到钱不改变项目利润。
 */
export const SETTLEMENT_STATUSES = ["NONE", "OPEN", "SETTLED"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export class RevenueLifecycleError extends Error {
  readonly code = "REVENUE_LIFECYCLE_VIOLATION";
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "RevenueLifecycleError";
  }
}

/* ---------------------------------- 成本阶段（读时推导，不新建 phase） ---------------------------------- */

export const COST_PHASES = ["PRE_AWARD", "POST_AWARD"] as const;
export type CostPhase = (typeof COST_PHASES)[number];

/* ---------------------------------- 落标原因 ---------------------------------- */

export const TENDER_LOSS_REASONS = [
  "PRICE_HIGH",
  "PRICE_TOO_LOW_RISK",
  "TECHNICAL",
  "EXPERIENCE",
  "CERTIFICATION",
  "BONDING",
  "SCHEDULE",
  "LOCAL_PREFERENCE",
  "INCUMBENT",
  "RELATIONSHIP",
  "COMPLIANCE",
  "SUBMISSION_ERROR",
  "CAPACITY",
  "UNKNOWN",
  "OTHER",
] as const;
export type TenderLossReason = (typeof TENDER_LOSS_REASONS)[number];

/** Portfolio 归组（任务书 §11「price-related / technical-related / experience-related 计数」）。 */
export const LOSS_REASON_GROUPS: Readonly<Record<string, readonly TenderLossReason[]>> = {
  PRICE: ["PRICE_HIGH", "PRICE_TOO_LOW_RISK"],
  TECHNICAL: ["TECHNICAL", "SCHEDULE", "CAPACITY"],
  EXPERIENCE: ["EXPERIENCE", "INCUMBENT", "RELATIONSHIP", "LOCAL_PREFERENCE"],
  COMPLIANCE: ["CERTIFICATION", "BONDING", "COMPLIANCE", "SUBMISSION_ERROR"],
  OTHER: ["UNKNOWN", "OTHER"],
};

export const LOSS_REVIEW_STATUSES = ["DRAFT", "CONFIRMED"] as const;
export type LossReviewStatus = (typeof LOSS_REVIEW_STATUSES)[number];

export class LossReviewError extends Error {
  readonly code = "LOSS_REVIEW_CONTRACT_VIOLATION";
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "LossReviewError";
  }
}

/* ---------------------------------- Tender 结果（读既有 canonical 字段） ---------------------------------- */

export const TENDER_OUTCOMES = ["WON", "LOST", "PENDING", "NOT_SUBMITTED"] as const;
export type TenderOutcome = (typeof TENDER_OUTCOMES)[number];

/**
 * 结果判定只读既有 canonical 字段，**不新建 award/loss state**：
 * - WON  ：isProjectAwardEligible()（bidPhaseStatus=AWARDED | tenderStatus=won | workDomain=delivery）
 * - LOST ：tenderStatus="lost" | bidPhaseStatus="LOST"
 * - PENDING / NOT_SUBMITTED：按 submittedAt 是否存在区分（cohort 用 submittedAt，见 portfolio.ts）
 *
 * WON 优先于 LOST：二者理论互斥；若数据同时命中（脏数据），以「我方中标」为准并由调用方计数上报。
 */
export function resolveTenderOutcome(project: {
  bidPhaseStatus?: string | null;
  tenderStatus?: string | null;
  workDomain?: string | null;
  submittedAt?: Date | null;
}): TenderOutcome {
  if (isProjectAwardEligible(project)) return "WON";
  if (project.tenderStatus === "lost" || project.bidPhaseStatus === "LOST") return "LOST";
  return project.submittedAt ? "PENDING" : "NOT_SUBMITTED";
}
