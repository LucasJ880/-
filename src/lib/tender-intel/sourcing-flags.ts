/**
 * CHAIN-2 寻源建议开关（默认关）
 *
 * TENDER_AUTO_SUPPLIER_RUN_ENABLED：未设 / 为假 = 关。
 * TENDER_AUTO_SUPPLIER_RUN_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时：审核接口不自动建候选池，寻源建议接口 404，情报页签不显示寻源建议卡。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isAutoSupplierRunEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_AUTO_SUPPLIER_RUN_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_AUTO_SUPPLIER_RUN_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isAutoSupplierRunEnabledForOrg(orgId: string | null | undefined): boolean {
  return isAutoSupplierRunEnabledForOrgWithEnv(orgId, process.env);
}
