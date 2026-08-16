/**
 * T2-P1.5 Project Financial Control — 生产激活闸
 *
 * 双闸 dark（与 T2-P1 一致的 fail-closed 纪律）：
 * 1. TENDER_FINANCIAL_CONTROL_ENABLED —— 门控整个财务控制功能面（预算/费用/审核 API+UI）。
 *    生产 default OFF：新表（ProjectBudget* / ProjectExpense*）尚未部署（additive migration 未 deploy），
 *    功能天然 dark；flag 是显式二道保险。
 * 2. 审批产权威成本（ProjectCost.ACTUAL + ProjectEvent）额外叠加 isLedgerProducersEnabled()
 *    —— 见 approveExpense。M1 ledger 生产未上线前，producer 一律 dark。
 *
 * 开启前置（继承 #96 §17.2 / T2-P1 §30）：
 *   PRODUCTION_M1_SCHEMA_STATUS = PRESENT
 *   MARKETING_ECONOMICS_MIGRATION_STATE = RESOLVED
 *   P1.5 additive migration deployed
 *   T2_LEDGER_PRODUCERS_ENABLED enable 决策
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

export function isFinancialControlEnabledWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envBool(env.TENDER_FINANCIAL_CONTROL_ENABLED);
}

/** default OFF；解析异常按 OFF（fail-closed，绝不影响业务主路径可用性） */
export function isFinancialControlEnabled(): boolean {
  try {
    return isFinancialControlEnabledWithEnv();
  } catch {
    return false;
  }
}
