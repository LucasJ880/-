/**
 * T4 授标情报生产激活闸（PRODUCTION ACTIVATION GATE）
 *
 * 复用 T2 canonical 模式（src/lib/project-ledger/flags.ts），不发明第二套 gating：
 *
 *   T4_AWARD_INTELLIGENCE_SCHEMA_READY —
 *     AwardRecord / AwardRecordSource 两表在当前环境已存在且允许安全访问。
 *
 * Dark-merge 兼容（ACTIVATION CONTRACT）：
 *   生产库尚未应用 20260814150000_add_tender_t4_award_record_foundation 时本位默认 OFF：
 *   - GET /api/org/tender-awards → available:false, reason:"SCHEMA_NOT_READY"，
 *     对 T4 表 0 次访问（不因缺表 500）。
 *   - 组织历史中标页显示「组织授标情报尚未启用」。
 *   - 人工确认路径采用 **兼容策略 B**：保持 merge 前行为——仅写
 *     room.summaryJson.externalConfirmed（项目级调查结论照常可用），
 *     不做 canonical materialize，响应 awardRecordId=null + canonical:"SCHEMA_NOT_READY"。
 *     一致性契约：externalConfirmed 保留 vendor/value/date/sourceUrl 全量信息，
 *     schema ready 后可由确定性幂等 sweep（同 sourceKey 推导规则）补偿 materialize，
 *     不构成不可补偿的双 source-of-truth。
 *
 * fail-closed：解析异常一律按 OFF 处理，绝不影响业务主路径可用性。
 * 生产置 true 的前置：见 docs/QINGYAN_TENDER_T4_INTELLIGENCE_P1_REPORT.md
 * 「生产激活 Runbook」（drift 取证 → 等价确认 → resolve → migrate deploy → 验表 → 置位 → 烟测）。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

/**
 * SCHEMA_READY：AwardRecord/AwardRecordSource 在当前环境已存在且允许安全访问。
 * default OFF（生产 T4 schema 尚未上线）。
 */
export function isT4AwardSchemaReadyWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envBool(env.T4_AWARD_INTELLIGENCE_SCHEMA_READY);
}

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/** SCHEMA_READY（fail-closed）。所有 T4 表访问站点必须先过本闸。 */
export function isT4AwardSchemaReady(): boolean {
  return safe(isT4AwardSchemaReadyWithEnv);
}
