/**
 * RFQ-AUTO-1 跟进授权开关（默认关）
 *
 * TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED：未设 / 为假 = 关。
 * TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时：建轮次不写跟进授权，催单与追问一律逐张待批（与本功能之前相同）；
 * 已批准的带授权的轮次同样退回逐张待批。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isRfqFollowUpPreapprovalEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isRfqFollowUpPreapprovalEnabledForOrg(orgId: string | null | undefined): boolean {
  return isRfqFollowUpPreapprovalEnabledForOrgWithEnv(orgId, process.env);
}
