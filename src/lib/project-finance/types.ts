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
