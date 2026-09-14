/**
 * GPT-6 Astra feature flag — 复用 Supervisor 灰度语义，独立 kill switch。
 *
 * 判定顺序（fail-closed）：
 * 1. ENABLE_GPT6_ASTRA 未开 → 关（生产紧急回滚）
 * 2. ORG allowlist 非空且未命中 → 关
 * 3. ROLE allowlist 非空且未命中 → 关
 * 4. USER allowlist 非空且未命中 → 关
 * 5. 任一 allowlist 非空且均已命中 → 开
 * 6. 否则：tender（QUALITY_FIRST）在总开关打开且 allowlist 未拦截时开启，不走 ROLLOUT_PCT
 * 7. 其他角色按 ROLLOUT_PCT（无 userId 时仅 pct>=100 开启）
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
  /** Model / workflow 角色。tender 跳过 ROLLOUT_PCT。 */
  modelRole?: string | null;
}

export const GPT6_PHASE1_WORKFLOWS = [
  "supervisor",
  "planner",
  "researcher",
  "tender",
] as const;

/** Tender 是 QUALITY_FIRST：kill switch 打开且 allowlist 未拦截时，不走百分比随机。 */
export const GPT6_QUALITY_FIRST_WORKFLOWS = ["tender"] as const;

export type Gpt6FlagDecision =
  | "kill_switch"
  | "org_unavailable"
  | "org_allowlist_miss"
  | "role_allowlist_miss"
  | "user_allowlist_miss"
  | "allowlist_hit"
  | "quality_first"
  | "rollout_open"
  | "rollout_closed"
  | "workflow_disabled";

function isQualityFirstWorkflow(name: string | null | undefined): boolean {
  const id = name?.trim().toLowerCase() ?? "";
  return (GPT6_QUALITY_FIRST_WORKFLOWS as readonly string[]).includes(id);
}

export function explainGpt6FlagWithEnv(
  input: Gpt6FlagInput = {},
  env: Gpt6FlagEnv = process.env,
): { enabled: boolean; decision: Gpt6FlagDecision } {
  if (!envBool(env.ENABLE_GPT6_ASTRA)) {
    return { enabled: false, decision: "kill_switch" };
  }

  const orgAllow = envList(env.ENABLE_GPT6_ASTRA_ORG_ALLOWLIST);
  const orgId = input.orgId?.trim() || "";
  const orgCode = input.orgCode?.trim() || "";
  const orgHit =
    (!!orgId && orgAllow.includes(orgId)) ||
    (!!orgCode && orgAllow.includes(orgCode));
  if (orgAllow.length > 0 && !orgHit) {
    return {
      enabled: false,
      decision: orgId || orgCode ? "org_allowlist_miss" : "org_unavailable",
    };
  }

  const roleAllow = envList(env.ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST);
  if (roleAllow.length > 0 && !(input.role && roleAllow.includes(input.role))) {
    return { enabled: false, decision: "role_allowlist_miss" };
  }

  const userAllow = envList(env.ENABLE_GPT6_ASTRA_USER_ALLOWLIST);
  const userId = input.userId?.trim() || "";
  if (userAllow.length > 0) {
    if (!userId || !userAllow.includes(userId)) {
      return { enabled: false, decision: "user_allowlist_miss" };
    }
  }

  if (orgAllow.length > 0 || roleAllow.length > 0 || userAllow.length > 0) {
    return { enabled: true, decision: "allowlist_hit" };
  }

  // Tender：生产确定性路由。百分比灰度会把同一次标书分析拆到不同模型。
  if (isQualityFirstWorkflow(input.modelRole) || isQualityFirstWorkflow(input.role)) {
    return { enabled: true, decision: "quality_first" };
  }

  const pct = Number(env.ENABLE_GPT6_ASTRA_ROLLOUT_PCT ?? "0");
  if (!Number.isFinite(pct) || pct <= 0) {
    return { enabled: false, decision: "rollout_closed" };
  }
  if (pct >= 100) return { enabled: true, decision: "rollout_open" };
  if (!userId) return { enabled: false, decision: "rollout_closed" };
  return userPercentBucket(userId) < pct
    ? { enabled: true, decision: "rollout_open" }
    : { enabled: false, decision: "rollout_closed" };
}

export function isGpt6AstraEnabledWithEnv(
  input: Gpt6FlagInput = {},
  env: Gpt6FlagEnv = process.env,
): boolean {
  return explainGpt6FlagWithEnv(input, env).enabled;
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
  const modelRole = input.modelRole ?? workflow;
  if (!isGpt6AstraEnabledWithEnv({ ...input, modelRole }, env)) return false;
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
