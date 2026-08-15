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

/**
 * T2-P1.6 —— 唯一新增开关（刻意不做 flag explosion）。
 *
 * TENDER_PROFITABILITY_SCHEMA_READY = P1.6 五张新表
 *   （ProjectExpensePayable / ProjectExpensePayment / ProjectExpenseFxSettlement /
 *     ProjectRevenueEntry / ProjectTenderLossReview）
 *   在当前环境已存在且允许安全读写。
 *
 * 为什么不再加 TENDER_EXPENSE_MOBILE_ENABLED / TENDER_SETTLEMENT_ENABLED /
 * TENDER_PROFITABILITY_ENABLED 三个功能位（任务书 §20 让评估）：
 *   - 移动端费用录入与 P1.5 的费用面是**同一个功能面**，已被 TENDER_FINANCIAL_CONTROL_ENABLED 门控；
 *     再加一位只会产生「面开着但录不进」的半开状态，增加而非降低风险。
 *   - 结算 / 利润 / 落标复盘的可用性**完全等价于**新表是否存在，
 *     因此一个 schema-ready 位即可精确表达，语义与 T2_LEDGER_SCHEMA_READY 一致。
 * 结论：功能面 = TENDER_FINANCIAL_CONTROL_ENABLED（复用），表可用性 = 本位（新增 1 个）。
 *
 * fail-closed：OFF 时
 *   - 审批路径**不创建** payable（approveExpense 行为退化为 P1.5 原语义，零回归）
 *   - 所有 P1.6 读模型返回 available=false 的空结果，绝不因缺表抛 table-not-found
 *
 * 生产开启前置（继承 T2-P1 §30 / P1.5）：
 *   PRODUCTION_M1_SCHEMA_STATUS = PRESENT
 *   MARKETING_ECONOMICS_MIGRATION_STATE = RESOLVED
 *   P1.5 additive migration deployed
 *   P1.6 additive migration deployed
 */
export function isProfitabilitySchemaReadyWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envBool(env.TENDER_PROFITABILITY_SCHEMA_READY);
}

/** P1.6 新表可用性（fail-closed；default OFF）。 */
export function isProfitabilitySchemaReady(): boolean {
  try {
    return isProfitabilitySchemaReadyWithEnv();
  } catch {
    return false;
  }
}
