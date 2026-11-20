/**
 * CHAIN-3 进口线索开关（默认关）
 *
 * TENDER_IMPORT_LEADS_ENABLED：未设 / 为假 = 关。
 * TENDER_IMPORT_LEADS_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时：进口线索接口 404，情报页签「供应链情报」槽保持原来的规划占位。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isImportLeadsEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_IMPORT_LEADS_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_IMPORT_LEADS_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isImportLeadsEnabledForOrg(orgId: string | null | undefined): boolean {
  return isImportLeadsEnabledForOrgWithEnv(orgId, process.env);
}
