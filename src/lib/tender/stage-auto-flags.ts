/**
 * FLOW-H1c 阶段记录自动前进开关（默认关）
 *
 * TENDER_STAGE_AUTO_ADVANCE_ENABLED：未设 / 为假 = 关。
 * TENDER_STAGE_AUTO_ADVANCE_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时：录入报价不写阶段时间；分析完成、询价发出照原样写时间，不建不关任务，不写自动前进的审计。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isStageAutoAdvanceEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_STAGE_AUTO_ADVANCE_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_STAGE_AUTO_ADVANCE_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isStageAutoAdvanceEnabledForOrg(orgId: string | null | undefined): boolean {
  return isStageAutoAdvanceEnabledForOrgWithEnv(orgId, process.env);
}
