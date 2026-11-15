/**
 * RFQ-AUTO-2 自动起草开关（默认关）
 *
 * TENDER_RFQ_AUTO_DRAFT_ENABLED：未设 / 为假 = 关。
 * TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时：要求审核完之后不会自动起草询价，四个审核接口的响应里没有 rfqAutoDraft，界面没有任何相关文字。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isRfqAutoDraftEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_RFQ_AUTO_DRAFT_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isRfqAutoDraftEnabledForOrg(orgId: string | null | undefined): boolean {
  return isRfqAutoDraftEnabledForOrgWithEnv(orgId, process.env);
}
