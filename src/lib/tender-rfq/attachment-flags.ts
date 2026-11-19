/**
 * CHAIN-4a 询价 PDF 附件开关（默认关）
 *
 * TENDER_RFQ_ATTACHMENT_ENABLED：未设 / 为假 = 关。
 * TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 只在起草时读：关闭时新起草的卡不带附件（载荷、哈希、摘要、正文与本功能之前逐字节相同）。
 * 已起草的卡按卡上写的执行——带附件的照样核对并带附件发出，不受开关影响。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isRfqAttachmentEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_RFQ_ATTACHMENT_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isRfqAttachmentEnabledForOrg(orgId: string | null | undefined): boolean {
  return isRfqAttachmentEnabledForOrgWithEnv(orgId, process.env);
}
