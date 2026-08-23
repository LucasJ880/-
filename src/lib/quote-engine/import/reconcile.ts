/**
 * 导入对账守卫（Phase 2.1 P0-D）：抽取金额合计 vs 工作簿参考总计（显式 Total / 末尾纯数字校验行）。
 * 仅作 Review 提示门（RECONCILIATION_MISMATCH），绝不据此改动任何抽取金额。
 */

export type ReconciliationStatus = "OK" | "MISMATCH" | "NO_REFERENCE";

/** 默认容差 = max(1.00, 参考总计的 0.1%) */
export function reconciliationTolerance(referenceTotal: number): number {
  return Math.max(1, Math.abs(referenceTotal) * 0.001);
}

export function reconcileTotals(input: { referenceTotal: number | null; extractedTotal: number }): { status: ReconciliationStatus; referenceTotal: number | null; extractedTotal: number; difference: number | null; tolerance: number | null } {
  const extractedTotal = Math.round(input.extractedTotal * 100) / 100;
  if (input.referenceTotal == null || !Number.isFinite(input.referenceTotal)) return { status: "NO_REFERENCE", referenceTotal: null, extractedTotal, difference: null, tolerance: null };
  const tolerance = reconciliationTolerance(input.referenceTotal);
  const difference = Math.round((extractedTotal - input.referenceTotal) * 100) / 100;
  return { status: Math.abs(difference) > tolerance ? "MISMATCH" : "OK", referenceTotal: input.referenceTotal, extractedTotal, difference, tolerance };
}
