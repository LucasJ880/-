/**
 * FLOW-H4b 交付前检查清单的开关（默认关）
 *
 * TENDER_SUBMISSION_CHECKLIST_ENABLED=1 打开；TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST 可选，逗号分隔的组织 id，
 * 不填 = 所有组织。关闭时新接口 404，「提交」页签与模型生成清单的接口都与原来相同。
 */
function envBool(v: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isSubmissionChecklistEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_SUBMISSION_CHECKLIST_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isSubmissionChecklistEnabledForOrg(orgId: string | null | undefined): boolean {
  return isSubmissionChecklistEnabledForOrgWithEnv(orgId, process.env);
}
