/**
 * QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 体验开关（默认关闭）
 *
 * 与 WORKFORCE_RUNTIME_* / AGENT_RUNTIME_V2_* 同一模式：
 * 1. ASSISTANT_DURABLE_FOLLOWUP_ENABLED 未开 → 关
 * 2. ORG / USER / ROLE Allowlist 非空且未命中 → 关
 * 3. 必须至少配置一个 Allowlist（禁止裸开总开关）
 *
 * 本开关只决定"普通助手是否把批量客户跟进目标转成持久任务"。它**不能**替代
 * 也不能覆盖既有安全开关：创建任务时 createWorkforceJob 仍强制
 * WORKFORCE_RUNTIME_* 开关与白名单、组织配额；执行时仍走 Workforce kill-switch、
 * 成员身份、工具策略与审批。关闭本开关后，普通聊天 / 简报 / 单项跟进 /
 * Gmail 草稿 / 项目助手行为与此前完全一致。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export type DurableFollowupFlagInput = {
  userId: string;
  orgId: string;
  role?: string | null;
};

export function isAssistantDurableFollowupEnabledWithEnv(
  input: DurableFollowupFlagInput,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!envBool(env.ASSISTANT_DURABLE_FOLLOWUP_ENABLED)) return false;

  const orgAllow = envList(env.ASSISTANT_DURABLE_FOLLOWUP_ORG_ALLOWLIST);
  if (orgAllow.length > 0 && !orgAllow.includes(input.orgId)) return false;

  const userAllow = envList(env.ASSISTANT_DURABLE_FOLLOWUP_USER_ALLOWLIST);
  if (userAllow.length > 0 && !userAllow.includes(input.userId)) return false;

  const roleAllow = envList(env.ASSISTANT_DURABLE_FOLLOWUP_ROLE_ALLOWLIST);
  if (roleAllow.length > 0 && !(input.role && roleAllow.includes(input.role))) {
    return false;
  }

  if (orgAllow.length === 0 && userAllow.length === 0 && roleAllow.length === 0) {
    return false;
  }
  return true;
}

export function isAssistantDurableFollowupEnabled(
  input: DurableFollowupFlagInput,
): boolean {
  return isAssistantDurableFollowupEnabledWithEnv(input, process.env);
}
