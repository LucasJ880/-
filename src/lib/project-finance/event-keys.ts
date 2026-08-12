/**
 * T2-P1.5 财务控制 — ProjectEvent 幂等键（继承 T2-P1 §10 纪律）
 *
 * deterministic / idempotent / short / server-authored。
 * 禁 Math.random() / Date.now() / randomUUID()。同一业务动作 retry → 同一 key；新动作 → 新 key。
 *
 * 复用 project-ledger appendProjectEvent 落库（本文件只造 key，不写 DB）。
 */

/** 预算容器创建 */
export function budgetCreatedEventKey(budgetId: string): string {
  return `budget.created:${budgetId}`;
}

/** 预算版本创建（versionId 即动作身份） */
export function budgetVersionCreatedEventKey(versionId: string): string {
  return `budget.version.created:${versionId}`;
}

/** 版本激活（每版本至多一次 activate） */
export function budgetActivatedEventKey(versionId: string): string {
  return `budget.activated:${versionId}`;
}

/** AWARD_BASELINE 冻结（每版本至多一次 freeze） */
export function budgetBaselineFrozenEventKey(versionId: string): string {
  return `budget.baseline_frozen:${versionId}`;
}

/**
 * 费用生命周期事件。
 * 关键幂等：approve 只认 expenseId（一份 expense 至多一条 approved 事件 → 至多一条 ProjectCost.ACTUAL）。
 * 可重复发生的动作（info_requested / resubmitted）用 transitionSeq 版本化，
 * transitionSeq = 该 expense 事务内已发生的转移计数（retry-stable：回滚后计数不变 → key 稳定）。
 */
export function expenseCreatedEventKey(expenseId: string): string {
  return `expense.created:${expenseId}`;
}

export function expenseSubmittedEventKey(expenseId: string, transitionSeq: number): string {
  return `expense.submitted:${expenseId}:t${transitionSeq}`;
}

export function expenseInfoRequestedEventKey(expenseId: string, transitionSeq: number): string {
  return `expense.info_requested:${expenseId}:t${transitionSeq}`;
}

export function expenseResubmittedEventKey(expenseId: string, transitionSeq: number): string {
  return `expense.resubmitted:${expenseId}:t${transitionSeq}`;
}

export function expenseRejectedEventKey(expenseId: string): string {
  return `expense.rejected:${expenseId}`;
}

/** 审批：仅认 expenseId —— double/concurrent approve 收敛为同一事件 + 同一 ProjectCost */
export function expenseApprovedEventKey(expenseId: string): string {
  return `expense.approved:${expenseId}`;
}
