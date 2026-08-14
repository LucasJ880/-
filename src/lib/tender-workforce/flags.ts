/**
 * Tender T1B Feature Flag（任务书 §31）
 *
 * TENDER_WORKFORCE_ANALYSIS_ENABLED：Tender 一键 AI 分析（Workforce 路径）
 * 总开关。production 默认安全关闭；staging 可开启测试。
 *
 * 与 WORKFORCE_RUNTIME_ENABLED 的关系：本 flag 只控制 Tender 触发入口是否
 * 暴露；Workforce Job 创建仍必须独立通过 isWorkforceRuntimeEnabled
 * （master + allowlist），两道门都开才可启动。沿用既有 flag 基建模式
 * （envBool / WithEnv 纯函数 / describe），不新建第二套 flag system。
 */

export type TenderWorkforceFlagEnv = Record<string, string | undefined>;

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isTenderWorkforceAnalysisEnabledWithEnv(
  input: { orgId?: string | null },
  env: TenderWorkforceFlagEnv = process.env,
): boolean {
  if (!envBool(env.TENDER_WORKFORCE_ANALYSIS_ENABLED)) return false;
  // 可选 org allowlist：非空时未命中即拒绝（灰度收窄；空 = 不加限制）
  const orgs = envList(env.TENDER_WORKFORCE_ANALYSIS_ORG_ALLOWLIST);
  if (orgs.length > 0) {
    const orgId = (input.orgId ?? "").trim();
    if (!orgId || !orgs.includes(orgId)) return false;
  }
  return true;
}

export function isTenderWorkforceAnalysisEnabled(input: {
  orgId?: string | null;
}): boolean {
  return isTenderWorkforceAnalysisEnabledWithEnv(input, process.env);
}

export function describeTenderWorkforceFlag(): Record<string, unknown> {
  return {
    enabled: envBool(process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED),
    orgAllowlist: envList(process.env.TENDER_WORKFORCE_ANALYSIS_ORG_ALLOWLIST),
  };
}

/**
 * T5-P1 §20 — 计划来源开关（**不是** T5 总闸）。
 *
 * 唯一职责：选择 LLM planner 还是 server-authored 确定性计划。
 * default OFF → 行为与当前 main 完全一致（同 trigger / 同 runtime / 同 UI / 同产物）。
 * ON 时若确定性计划校验失败：**fail-closed，绝不偷偷回落 LLM planner**
 * （回落会掩盖确定性契约缺陷；正确回滚方式是关掉本 flag——见 T5 §21）。
 *
 * 沿用仓库 4 符号 flag 模式（WithEnv 纯函数 / 薄包装 / describe），不新建 flag 体系。
 */
export function isTenderDeterministicPlanEnabledWithEnv(
  input: { orgId?: string | null },
  env: TenderWorkforceFlagEnv = process.env,
): boolean {
  if (!envBool(env.TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED)) return false;
  const orgs = envList(env.TENDER_WORKFORCE_DETERMINISTIC_PLAN_ORG_ALLOWLIST);
  if (orgs.length > 0) {
    const orgId = (input.orgId ?? "").trim();
    if (!orgId || !orgs.includes(orgId)) return false;
  }
  return true;
}

export function isTenderDeterministicPlanEnabled(input: {
  orgId?: string | null;
}): boolean {
  return isTenderDeterministicPlanEnabledWithEnv(input, process.env);
}

export function describeTenderDeterministicPlanFlag(): Record<string, unknown> {
  return {
    enabled: envBool(
      process.env.TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED,
    ),
    orgAllowlist: envList(
      process.env.TENDER_WORKFORCE_DETERMINISTIC_PLAN_ORG_ALLOWLIST,
    ),
  };
}
