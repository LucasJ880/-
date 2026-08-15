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

/* ═══════════════════════════ T2-P1.6 事件键 ═══════════════════════════ */

/**
 * 金额人工确认（可重复发生：10:32 记 $23 → 10:41 改 $28 → 再次确认）。
 * 用 expense 的 transitionCount 版本化，retry-stable（回滚后计数不变 → key 稳定）。
 */
export function expenseAmountConfirmedEventKey(expenseId: string, transitionSeq: number): string {
  return `expense.amount_confirmed:${expenseId}:t${transitionSeq}`;
}

/** 票据上传：attachmentId 即动作身份（同 hash 去重后返回既有 → 天然幂等） */
export function expenseReceiptUploadedEventKey(attachmentId: string): string {
  return `expense.receipt_uploaded:${attachmentId}`;
}

/**
 * 应付创建：仅认 expenseId —— 一份 expense 至多一条 payable，
 * 与 DB 层 unique(expenseSubmissionId) 双保险（REIMB-01 防重复报销）。
 */
export function expensePayableCreatedEventKey(expenseId: string): string {
  return `expense.payable_created:${expenseId}`;
}

/** 付款记录：paymentId 即动作身份（paymentId 由服务端 idempotencyKey 收敛后产生） */
export function expensePaymentRecordedEventKey(paymentId: string): string {
  return `expense.payment_recorded:${paymentId}`;
}

/** 付款冲销：每条 payment 至多冲销一次 */
export function expensePaymentVoidedEventKey(paymentId: string): string {
  return `expense.payment_voided:${paymentId}`;
}

/** 汇率锁定（费用提交/确认时的 FX 快照） */
export function expenseFxRateLockedEventKey(expenseId: string, transitionSeq: number): string {
  return `expense.fx_rate_locked:${expenseId}:t${transitionSeq}`;
}

/** FX 最终结算：仅认 expenseId —— 重复结算幂等收敛（FX-SETTLE-04） */
export function expenseFxSettledEventKey(expenseId: string): string {
  return `expense.fx_settled:${expenseId}`;
}

/** 成本修正（FX variance 驱动的 VOID + correction）：仅认 expenseId */
export function expenseCostCorrectedEventKey(expenseId: string): string {
  return `expense.cost_corrected:${expenseId}`;
}

/* ── 收入账 ── */

/** 收入条目创建（entryId 即动作身份） */
export function revenueRecordedEventKey(entryId: string): string {
  return `revenue.recorded:${entryId}`;
}

/** 收入实现（FORECAST → REALIZED；每条至多一次） */
export function revenueRecognizedEventKey(entryId: string): string {
  return `revenue.recognized:${entryId}`;
}

/** 收入作废（每条至多一次） */
export function revenueVoidedEventKey(entryId: string): string {
  return `revenue.voided:${entryId}`;
}

/* ── 落标复盘 ── */

/** 复盘草稿创建（每项目至多一条 review → reviewId 即身份） */
export function lossReviewCreatedEventKey(reviewId: string): string {
  return `tender.loss_review_created:${reviewId}`;
}

/** AI 建议写入（可重复；用 suggestion 序号版本化） */
export function lossReviewAiSuggestedEventKey(reviewId: string, seq: number): string {
  return `tender.loss_review_ai_suggested:${reviewId}:s${seq}`;
}

/** 人工确认最终原因（每条 review 至多一次 CONFIRMED 转移） */
export function lossReviewConfirmedEventKey(reviewId: string): string {
  return `tender.loss_review_confirmed:${reviewId}`;
}
