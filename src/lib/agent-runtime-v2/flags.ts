/**
 * Agent Runtime 2.0 Feature Flags（独立于 Supervisor / Digital Employees）
 *
 * 判定顺序：
 * 1. AGENT_RUNTIME_V2_ENABLED 未开 → 关
 * 2. ORG Allowlist 非空且未命中 → 关
 * 3. USER Allowlist 非空且未命中 → 关
 * 4. ROLE Allowlist 非空且未命中 → 关
 * 5. 任一 Allowlist 非空且均已命中 → 开
 * 6. 否则关（Phase 1 不做百分比灰度，避免误开）
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

function envInt(v: string | undefined, fallback: number): number {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export type RuntimeV2FlagEnv = Record<string, string | undefined>;

export interface RuntimeV2FlagInput {
  userId: string;
  role?: string | null;
  orgId?: string | null;
  orgCode?: string | null;
}

export function isAgentRuntimeV2EnabledWithEnv(
  input: RuntimeV2FlagInput,
  env: RuntimeV2FlagEnv = process.env,
): boolean {
  if (!envBool(env.AGENT_RUNTIME_V2_ENABLED)) return false;

  const orgAllow = envList(env.AGENT_RUNTIME_V2_ORG_ALLOWLIST);
  const orgHit =
    (!!input.orgId && orgAllow.includes(input.orgId)) ||
    (!!input.orgCode && orgAllow.includes(input.orgCode));
  if (orgAllow.length > 0 && !orgHit) return false;

  const userAllow = envList(env.AGENT_RUNTIME_V2_USER_ALLOWLIST);
  if (userAllow.length > 0 && !userAllow.includes(input.userId)) return false;

  const roleAllow = envList(env.AGENT_RUNTIME_V2_ROLE_ALLOWLIST);
  if (roleAllow.length > 0 && !(input.role && roleAllow.includes(input.role))) {
    return false;
  }

  // Phase 1：必须至少命中 org 或 user 白名单之一，禁止裸开总开关
  if (orgAllow.length === 0 && userAllow.length === 0 && roleAllow.length === 0) {
    return false;
  }
  return true;
}

export function isAgentRuntimeV2Enabled(input: RuntimeV2FlagInput): boolean {
  return isAgentRuntimeV2EnabledWithEnv(input, process.env);
}

export function getRuntimeV2Limits(env: RuntimeV2FlagEnv = process.env) {
  return {
    maxSteps: envInt(env.AGENT_RUNTIME_V2_MAX_STEPS, 8),
    maxToolCalls: envInt(env.AGENT_RUNTIME_V2_MAX_TOOL_CALLS, 12),
    maxRepairs: envInt(env.AGENT_RUNTIME_V2_MAX_REPAIRS, 2),
    maxAttemptsPerStep: envInt(env.AGENT_RUNTIME_V2_MAX_ATTEMPTS_PER_STEP, 2),
    timeoutMs: envInt(env.AGENT_RUNTIME_V2_TIMEOUT_MS, 180_000),
    parallelism: envInt(env.AGENT_RUNTIME_V2_PARALLELISM, 1),
  };
}

export function describeRuntimeV2Flag(): Record<string, unknown> {
  return {
    enabled: envBool(process.env.AGENT_RUNTIME_V2_ENABLED),
    orgAllowlist: envList(process.env.AGENT_RUNTIME_V2_ORG_ALLOWLIST),
    userAllowlist: envList(process.env.AGENT_RUNTIME_V2_USER_ALLOWLIST),
    roleAllowlist: envList(process.env.AGENT_RUNTIME_V2_ROLE_ALLOWLIST),
    limits: getRuntimeV2Limits(),
  };
}

/** 复杂任务启发式：多步骤 / 跟进处理 / 需要审批写操作 */
export function looksLikeRuntimeV2Goal(goal: string): boolean {
  const t = goal.trim();
  if (t.length < 4) return false;
  const complex =
    /最近的?销售跟进|处理一下|跟进处理|批量|帮我把|整理一下|优先级|高优|需要跟进的客户|pipeline.*跟进|跟进.*pipeline/i.test(
      t,
    );
  const multi =
    (t.includes("并且") || t.includes("然后") || t.includes("同时")) &&
    t.length > 12;
  return complex || multi;
}
