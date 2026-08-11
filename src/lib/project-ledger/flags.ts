/**
 * T2-P1 生产激活闸（PRODUCTION ACTIVATION GATE）
 *
 * 生产库尚未应用 M1 四表 migration（PRODUCTION_M1_SCHEMA_STATUS = NOT_PRESENT）。
 * 在表存在之前，producer 必须保持 dark：default OFF、fail-closed。
 * 开启前置（#96 §17.2 / P1 任务书 §30）：
 *   PRODUCTION_M1_SCHEMA_STATUS = PRESENT
 *   MARKETING_ECONOMICS_MIGRATION_STATE = RESOLVED
 *   DELETION_GATING = PASS
 *   LEGACY_EVENT_STORE_DECISION_GATE = PASS
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

export function isLedgerProducersEnabledWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envBool(env.T2_LEDGER_PRODUCERS_ENABLED);
}

/** default OFF；任何解析异常按 OFF 处理（fail-closed，绝不影响业务主路径可用性） */
export function isLedgerProducersEnabled(): boolean {
  try {
    return isLedgerProducersEnabledWithEnv();
  } catch {
    return false;
  }
}
