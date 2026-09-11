/**
 * GPT-6 Astra feature flag — 复用 Supervisor 灰度语义，独立 kill switch。
 *
 * 判定顺序（fail-closed）：
 * 1. ENABLE_GPT6_ASTRA 未开 → 关（生产紧急回滚）
 * 2. ORG allowlist 非空且未命中 → 关
 * 3. ROLE allowlist 非空且未命中 → 关
 * 4. USER allowlist 非空且未命中 → 关
 * 5. 任一 allowlist 非空且均已命中 → 开
 * 6. 否则按 ROLLOUT_PCT（无 userId 时仅 pct>=100 开启）
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

export type Gpt6FlagEnv = Record<string, string | undefined>;

export interface Gpt6FlagInput {
  userId?: string | null;
  role?: string | null;
  orgId?: string | null;
  orgCode?: string | null;
}

export const GPT6_PHASE1_WORKFLOWS = [
  "supervisor",
  "planner",
  "researcher",
] as const;

export function isGpt6AstraEnabledWithEnv(
  input: Gpt6FlagInput = {},
  env: Gpt6FlagEnv = process.env,
): boolean {
  if (!envBool(env.ENABLE_GPT6_ASTRA)) return false;

  const orgAllow = envList(env.ENABLE_GPT6_ASTRA_ORG_ALLOWLIST);
  const orgHit =
    (!!input.orgId && orgAllow.includes(input.orgId)) ||
    (!!input.orgCode && orgAllow.includes(input.orgCode));
  if (orgAllow.length > 0 && !orgHit) return false;

  const roleAllow = envList(env.ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST);
  if (roleAllow.length > 0 && !(input.role && roleAllow.includes(input.role))) {
    return false;
  }

  const userAllow = envList(env.ENABLE_GPT6_ASTRA_USER_ALLOWLIST);
  const userId = input.userId?.trim() || "";
  if (userAllow.length > 0) {
    if (!userId || !userAllow.includes(userId)) return false;
  }

  if (orgAllow.length > 0 || roleAllow.length > 0 || userAllow.length > 0) {
    return true;
  }

  const pct = Number(env.ENABLE_GPT6_ASTRA_ROLLOUT_PCT ?? "0");
  if (!Number.isFinite(pct) || pct <= 0) return false;
  if (pct >= 100) return true;
  if (!userId) return false;
  return userPercentBucket(userId) < pct;
}

export function isGpt6AstraEnabled(input: Gpt6FlagInput = {}): boolean {
  return isGpt6AstraEnabledWithEnv(input, process.env);
}

export function gpt6WorkflowAllowlist(env: Gpt6FlagEnv = process.env): Set<string> {
  const raw = env.ENABLE_GPT6_ASTRA_WORKFLOWS?.trim();
  if (!raw) return new Set(GPT6_PHASE1_WORKFLOWS);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isGpt6WorkflowEnabledWithEnv(
  workflow: string,
  input: Gpt6FlagInput = {},
  env: Gpt6FlagEnv = process.env,
): boolean {
  if (!isGpt6AstraEnabledWithEnv(input, env)) return false;
  return gpt6WorkflowAllowlist(env).has(workflow.trim().toLowerCase());
}

export function describeGpt6Flag(
  env: Gpt6FlagEnv = process.env,
): Record<string, unknown> {
  return {
    enabled: envBool(env.ENABLE_GPT6_ASTRA),
    userAllowlist: envList(env.ENABLE_GPT6_ASTRA_USER_ALLOWLIST),
    roleAllowlist: envList(env.ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST),
    orgAllowlist: envList(env.ENABLE_GPT6_ASTRA_ORG_ALLOWLIST),
    rolloutPct: Number(env.ENABLE_GPT6_ASTRA_ROLLOUT_PCT ?? "0"),
    workflows: [...gpt6WorkflowAllowlist(env)],
  };
}
