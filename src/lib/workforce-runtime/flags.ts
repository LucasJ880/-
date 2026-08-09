/**
 * Workforce Runtime Feature Flags（Phase 2A，§25 Production entry）
 *
 * 与 AGENT_RUNTIME_V2_* 同一模式：
 * 1. WORKFORCE_RUNTIME_ENABLED 未开 → 关
 * 2. ORG Allowlist 非空且未命中 → 关
 * 3. USER Allowlist 非空且未命中 → 关
 * 4. ROLE Allowlist 非空且未命中 → 关
 * 5. 必须至少命中一个非空 Allowlist，禁止裸开总开关
 *
 * 不自动路由任何用户任务到 workforce_job：createWorkforceJob 是唯一入口，
 * 且入口处强制本 flag；普通助手行为不变。
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

export type WorkforceFlagEnv = Record<string, string | undefined>;

export interface WorkforceFlagInput {
  userId: string;
  role?: string | null;
  orgId?: string | null;
}

export function isWorkforceRuntimeEnabledWithEnv(
  input: WorkforceFlagInput,
  env: WorkforceFlagEnv = process.env,
): boolean {
  if (!envBool(env.WORKFORCE_RUNTIME_ENABLED)) return false;

  const orgAllow = envList(env.WORKFORCE_RUNTIME_ORG_ALLOWLIST);
  if (orgAllow.length > 0 && !(input.orgId && orgAllow.includes(input.orgId))) {
    return false;
  }

  const userAllow = envList(env.WORKFORCE_RUNTIME_USER_ALLOWLIST);
  if (userAllow.length > 0 && !userAllow.includes(input.userId)) return false;

  const roleAllow = envList(env.WORKFORCE_RUNTIME_ROLE_ALLOWLIST);
  if (roleAllow.length > 0 && !(input.role && roleAllow.includes(input.role))) {
    return false;
  }

  // 禁止裸开：必须至少配置一个 Allowlist
  if (
    orgAllow.length === 0 &&
    userAllow.length === 0 &&
    roleAllow.length === 0
  ) {
    return false;
  }
  return true;
}

export function isWorkforceRuntimeEnabled(input: WorkforceFlagInput): boolean {
  return isWorkforceRuntimeEnabledWithEnv(input, process.env);
}

export function describeWorkforceFlag(): Record<string, unknown> {
  return {
    enabled: envBool(process.env.WORKFORCE_RUNTIME_ENABLED),
    orgAllowlist: envList(process.env.WORKFORCE_RUNTIME_ORG_ALLOWLIST),
    userAllowlist: envList(process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST),
    roleAllowlist: envList(process.env.WORKFORCE_RUNTIME_ROLE_ALLOWLIST),
  };
}
