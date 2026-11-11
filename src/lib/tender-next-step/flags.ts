/**
 * FLOW-H1 项目页「下一步」开关（默认关）
 *
 * TENDER_WEB_NEXT_STEP_ENABLED：未设 / 为假 = 关。
 * TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时接口 404，页面不渲染卡片，其余与没有本功能时相同。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isWebNextStepEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_WEB_NEXT_STEP_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isWebNextStepEnabledForOrg(orgId: string | null | undefined): boolean {
  return isWebNextStepEnabledForOrgWithEnv(orgId, process.env);
}
