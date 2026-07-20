/**
 * Supervisor Feature Flag（兼容 Operator 灰度模式，不冲突）
 *
 * 判定顺序（严格）：
 * 1. AGENT_SUPERVISOR_ENABLED 未开 → 关
 * 2. ORG Allowlist 非空且未命中 → 关（ROLLOUT/角色不能绕过）
 * 3. ROLE Allowlist 非空且未命中 → 关
 * 4. USER Allowlist 非空且未命中 → 关
 * 5. 任一 Allowlist 非空且均已命中 → 开
 * 6. 否则按 ROLLOUT_PCT
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

function userPercentBucket(userId: string): number {
  let h = 5381;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) + h + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

export interface SupervisorFlagInput {
  userId: string;
  role?: string | null;
  orgId?: string | null;
  orgCode?: string | null;
}

/** 供测试注入的环境变量视图（不必完整 ProcessEnv） */
export type SupervisorFlagEnv = Record<string, string | undefined>;

/** 供测试注入，避免污染进程级其他用例时可用 withFlagEnv */
export function isSupervisorEnabledWithEnv(
  input: SupervisorFlagInput,
  env: SupervisorFlagEnv = process.env,
): boolean {
  if (!envBool(env.AGENT_SUPERVISOR_ENABLED)) return false;

  const orgAllow = envList(env.AGENT_SUPERVISOR_ORG_ALLOWLIST);
  const orgHit =
    (!!input.orgId && orgAllow.includes(input.orgId)) ||
    (!!input.orgCode && orgAllow.includes(input.orgCode));
  if (orgAllow.length > 0 && !orgHit) return false;

  const roleAllow = envList(env.AGENT_SUPERVISOR_ROLE_ALLOWLIST);
  const roleHit = Boolean(input.role && roleAllow.includes(input.role));
  if (roleAllow.length > 0 && !roleHit) return false;

  const userAllow = envList(env.AGENT_SUPERVISOR_USER_ALLOWLIST);
  const userHit = userAllow.includes(input.userId);
  if (userAllow.length > 0 && !userHit) return false;

  // 任一 allowlist 已配置且全部通过 → 开启（ROLLOUT 不得再否决，也不得在未通过时开启）
  if (orgAllow.length > 0 || roleAllow.length > 0 || userAllow.length > 0) {
    return true;
  }

  const pct = Number(env.AGENT_SUPERVISOR_ROLLOUT_PCT ?? "0");
  if (!Number.isFinite(pct) || pct <= 0) return false;
  if (pct >= 100) return true;
  return userPercentBucket(input.userId) < pct;
}

export function isSupervisorEnabled(input: SupervisorFlagInput): boolean {
  return isSupervisorEnabledWithEnv(input, process.env);
}

export function describeSupervisorFlag(): Record<string, unknown> {
  return {
    enabled: envBool(process.env.AGENT_SUPERVISOR_ENABLED),
    userAllowlist: envList(process.env.AGENT_SUPERVISOR_USER_ALLOWLIST),
    roleAllowlist: envList(process.env.AGENT_SUPERVISOR_ROLE_ALLOWLIST),
    orgAllowlist: envList(process.env.AGENT_SUPERVISOR_ORG_ALLOWLIST),
    rolloutPct: Number(process.env.AGENT_SUPERVISOR_ROLLOUT_PCT ?? "0"),
  };
}
