/**
 * TI-4a 投标工作区开关（默认关）
 *
 * TENDER_BID_WORKSPACE_ENABLED：未设 / 为假 = 关。
 * TENDER_BID_WORKSPACE_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时三个接口一律 404，不读不写任何投标工作区数据。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isBidWorkspaceEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_BID_WORKSPACE_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isBidWorkspaceEnabledForOrg(orgId: string | null | undefined): boolean {
  return isBidWorkspaceEnabledForOrgWithEnv(orgId, process.env);
}

export function describeBidWorkspaceFlag(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return {
    flag: "TENDER_BID_WORKSPACE_ENABLED",
    enabled: envBool(env.TENDER_BID_WORKSPACE_ENABLED),
    orgAllowlistSize: envList(env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST).length,
  };
}
