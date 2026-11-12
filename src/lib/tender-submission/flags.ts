/**
 * FLOW-H4a 提交记录的开关（默认关）
 *
 * TENDER_SUBMISSION_RECORD_ENABLED=1 打开；TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST 可选，逗号分隔的组织 id，
 * 不填 = 所有组织。关闭时接口 404，「提交」页签与「下一步」卡片与原来相同。
 * 与 TENDER_WEB_NEXT_STEP_ENABLED 分开：那个开关只管只读的显示，这个会写项目的提交时间。
 */
function envBool(v: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isSubmissionRecordEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_SUBMISSION_RECORD_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isSubmissionRecordEnabledForOrg(orgId: string | null | undefined): boolean {
  return isSubmissionRecordEnabledForOrgWithEnv(orgId, process.env);
}
