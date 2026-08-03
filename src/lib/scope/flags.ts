/**
 * QM Phase 1 Feature Flag / allowlist / shadow mode
 * 命名遵循现有 env bool + comma allowlist 模式。
 */

function envBool(v: string | undefined, defaultValue = false): boolean {
  if (v === undefined || v === "") return defaultValue;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Phase 1 新路径总开关，默认关闭 */
export function isQmScopePhase1Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envBool(env.QINGYAN_QM_SCOPE_PHASE1_ENABLED, false);
}

/** Shadow Mode 默认开启：禁止外部副作用 */
export function isQmPhase1ShadowMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envBool(env.QINGYAN_QM_PHASE1_SHADOW_MODE, true);
}

export function getQmPhase1OrgAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return envList(env.QINGYAN_QM_PHASE1_ORG_ALLOWLIST);
}

export function getQmPhase1ProjectAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return envList(env.QINGYAN_QM_PHASE1_PROJECT_ALLOWLIST);
}

export function isOrgAllowlisted(
  orgId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const list = getQmPhase1OrgAllowlist(env);
  if (list.length === 0) return false;
  return list.includes(orgId);
}

export function isProjectAllowlisted(
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const list = getQmPhase1ProjectAllowlist(env);
  if (list.length === 0) return false;
  return list.includes(projectId);
}

export function describeQmPhase1Flags(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  return {
    enabled: isQmScopePhase1Enabled(env),
    shadowMode: isQmPhase1ShadowMode(env),
    orgAllowlistCount: getQmPhase1OrgAllowlist(env).length,
    projectAllowlistCount: getQmPhase1ProjectAllowlist(env).length,
  };
}
