/**
 * CHAIN-2 情报推荐并入自动起草收件人的开关（默认关，判断点 4 B）
 *
 * TENDER_RFQ_INTEL_RECIPIENTS_ENABLED：未设 / 为假 = 关。
 * TENDER_RFQ_INTEL_RECIPIENTS_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时：自动起草的收件人只来自操作者自己的常用供应商或分组（与本功能之前相同）。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isRfqIntelRecipientsEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_RFQ_INTEL_RECIPIENTS_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_RFQ_INTEL_RECIPIENTS_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isRfqIntelRecipientsEnabledForOrg(orgId: string | null | undefined): boolean {
  return isRfqIntelRecipientsEnabledForOrgWithEnv(orgId, process.env);
}
