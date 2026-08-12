/**
 * T2-P1 生产激活闸（PRODUCTION ACTIVATION GATE）
 *
 * 两个正交能力位（T3.5 Foundation Hardening 拆分）：
 *
 *   T2_LEDGER_SCHEMA_READY      — M1 四表在当前环境已存在且允许安全读取。
 *   T2_LEDGER_PRODUCERS_ENABLED — 是否产生新的 ledger producer 写入。
 *
 * 两者的组合语义（ACTIVATION CONTRACT）：
 *
 *   Producer Write   = SCHEMA_READY && PRODUCERS_ENABLED   （isLedgerProducerActive）
 *   Deletion Gate    = SCHEMA_READY                        （isLedgerDeletionGateActive）
 *
 * 为什么拆开（#T3.5 §2）：deletion protection 保护的是「已存在的 ledger 历史」，
 * 它一旦产生就必须永久受保护——即使因事故/维护/回滚临时关闭 producer。
 * 若 deletion gate 仍绑在 producer 开关上，则
 *   已有历史 + producer OFF + DELETE Project → 可能重新允许 hard delete（orphan 授权锚）。
 * 因此 deletion gate 只看 SCHEMA_READY，与 producer 开关解耦。
 *
 * Dark-merge 兼容：生产库尚未应用 M1 migration，两位默认 OFF、fail-closed。
 * SCHEMA_READY=false → DELETE 对 M1 表 0 次访问（不因缺表出现 table-not-found），
 * producer 也不写入，行为与 T2 之前完全一致。
 *
 * fail-closed：PRODUCERS_ENABLED=true 但 SCHEMA_READY=false → producer effectively OFF
 * （绝不在 schema 未就绪时写 M1 表）。任何解析异常一律按 OFF 处理，绝不影响业务主路径可用性。
 *
 * 生产开启前置（#96 §17.2 / P1 任务书 §30，仍需独立 runbook 逐项满足）：
 *   PRODUCTION_M1_SCHEMA_STATUS = PRESENT   → 允许置 SCHEMA_READY=true
 *   MARKETING_ECONOMICS_MIGRATION_STATE = RESOLVED
 *   DELETION_GATING = PASS
 *   LEGACY_EVENT_STORE_DECISION_GATE = PASS
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

/**
 * SCHEMA_READY：M1 四表在当前环境已存在且允许安全读取。
 * default OFF（生产 M1 schema 尚未上线）。控制 deletion gate 与 M1 表可访问性。
 */
export function isLedgerSchemaReadyWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envBool(env.T2_LEDGER_SCHEMA_READY);
}

/** PRODUCERS_ENABLED：是否产生新的 producer 写入（单独位，不含 schema 判定）。 */
export function isLedgerProducersEnabledWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envBool(env.T2_LEDGER_PRODUCERS_ENABLED);
}

/**
 * Producer 写入有效开关 = SCHEMA_READY && PRODUCERS_ENABLED（fail-closed）。
 * 所有 producer 站点必须用本函数判定，不得单独用 PRODUCERS_ENABLED。
 */
export function isLedgerProducerActiveWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isLedgerSchemaReadyWithEnv(env) && isLedgerProducersEnabledWithEnv(env);
}

/**
 * Deletion gate / anchor-lock 有效开关 = SCHEMA_READY（与 producer 解耦）。
 * SCHEMA_READY 下无论 producer 是否开启，已有历史都受 deletion protection。
 */
export function isLedgerDeletionGateActiveWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isLedgerSchemaReadyWithEnv(env);
}

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/** SCHEMA_READY（fail-closed）。 */
export function isLedgerSchemaReady(): boolean {
  return safe(isLedgerSchemaReadyWithEnv);
}

/**
 * @deprecated 生产 producer 判定请用 {@link isLedgerProducerActive}（含 schema-ready 前置）。
 * 保留仅为向后兼容与单元自省；单独判定 PRODUCERS_ENABLED 会绕过 fail-closed。default OFF。
 */
export function isLedgerProducersEnabled(): boolean {
  return safe(isLedgerProducersEnabledWithEnv);
}

/** Producer 写入有效开关（SCHEMA_READY && PRODUCERS_ENABLED；fail-closed）。 */
export function isLedgerProducerActive(): boolean {
  return safe(isLedgerProducerActiveWithEnv);
}

/** Deletion gate / anchor-lock 有效开关（= SCHEMA_READY；fail-closed）。 */
export function isLedgerDeletionGateActive(): boolean {
  return safe(isLedgerDeletionGateActiveWithEnv);
}
