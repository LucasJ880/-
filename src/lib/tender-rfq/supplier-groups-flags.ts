/**
 * RFQ-AUTO-5 供应商分组开关（默认关）
 *
 * TENDER_RFQ_SUPPLIER_GROUPS_ENABLED：未设 / 为假 = 关。
 * TENDER_RFQ_SUPPLIER_GROUPS_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时：询价入口的响应里没有 supplierGroups，保存分组的接口拒绝，界面没有任何分组相关的内容；
 * 已保存的分组留在记录里但不生效——抽屉的预选与自动起草都回到常用供应商。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isRfqSupplierGroupsEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_RFQ_SUPPLIER_GROUPS_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_RFQ_SUPPLIER_GROUPS_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isRfqSupplierGroupsEnabledForOrg(orgId: string | null | undefined): boolean {
  return isRfqSupplierGroupsEnabledForOrgWithEnv(orgId, process.env);
}
