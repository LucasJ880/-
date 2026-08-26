/**
 * Mention Gateway — M0 Safety Gate：Feature Flags
 *
 * 全部默认关闭：
 *   MENTION_GATEWAY_ENABLED=false
 *   MENTION_GATEWAY_MOCK_ENABLED=false        （production 运行时恒为 false，flag 无法覆盖）
 *   MENTION_GATEWAY_MEMORY_WRITE_ENABLED=false （M1 硬关：即使 =1 也不生效）
 *   MENTION_GATEWAY_EXTERNAL_SEND_ENABLED=false（M1 硬关：即使 =1 也不生效）
 *   MENTION_GATEWAY_MAX_RISK=l0_read           （只能收紧；M1 天花板 = l0_read，任何更高值被夹回）
 *
 * 这些 flag 只决定「入口是否开放」；最终授权仍由现有 ToolRegistry / canInvokeTool /
 * toolPolicy 链决定，flag 无法绕过。
 */

import type { ToolRisk } from "@/lib/agent-core/types";
import {
  detectRuntimeEnvMismatch,
  resolveQingyanRuntimeEnv,
} from "@/lib/env/runtime-isolation";

/** 供测试注入的环境变量视图 */
export type MentionGatewayFlagEnv = Record<string, string | undefined>;

/** M1 风险天花板：环境变量只能收紧，不能放宽 */
export const MENTION_GATEWAY_M1_MAX_RISK: ToolRisk = "l0_read";

/** M1 硬关：记忆写入 / 外部发送在本轮代码层面不存在对应路径，flag 仅为 M2 预留 */
export const MENTION_GATEWAY_M1_MEMORY_WRITE_HARD_OFF = true;
export const MENTION_GATEWAY_M1_EXTERNAL_SEND_HARD_OFF = true;

const RISK_ORDER: Record<ToolRisk, number> = {
  l0_read: 0,
  l1_internal_write: 1,
  l2_soft: 2,
  l3_strong: 3,
};

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function isToolRisk(v: string): v is ToolRisk {
  return v in RISK_ORDER;
}

export function isMentionGatewayEnabledWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  return envBool(env.MENTION_GATEWAY_ENABLED);
}

/**
 * 任一生产信号（QINGYAN_RUNTIME_ENV=production / VERCEL_ENV=production）或
 * 运行环境声明冲突 → 视为不可用 Mock 的环境（fail-closed）。
 */
export function isMentionMockRuntimeAllowedWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  const nodeEnv = env as NodeJS.ProcessEnv;
  if (detectRuntimeEnvMismatch(nodeEnv)) return false;
  if ((env.VERCEL_ENV || "").trim().toLowerCase() === "production") return false;
  if (
    (env.QINGYAN_RUNTIME_ENV || "").trim().toLowerCase() === "production"
  ) {
    return false;
  }
  return resolveQingyanRuntimeEnv(nodeEnv) !== "production";
}

/** Mock 入口：flag 开 + 非生产运行时；二者缺一即关 */
export function isMentionMockEnabledWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  if (!envBool(env.MENTION_GATEWAY_MOCK_ENABLED)) return false;
  return isMentionMockRuntimeAllowedWithEnv(env);
}

export function isMentionMemoryWriteEnabledWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  if (MENTION_GATEWAY_M1_MEMORY_WRITE_HARD_OFF) return false;
  return envBool(env.MENTION_GATEWAY_MEMORY_WRITE_ENABLED);
}

export function isMentionExternalSendEnabledWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  if (MENTION_GATEWAY_M1_EXTERNAL_SEND_HARD_OFF) return false;
  return envBool(env.MENTION_GATEWAY_EXTERNAL_SEND_ENABLED);
}

/**
 * maxRisk 解析：env 只能在天花板之下收紧。
 * 非法值 / 高于天花板 → 天花板（M1 = l0_read）。
 */
export function resolveMentionGatewayMaxRiskWithEnv(
  env: MentionGatewayFlagEnv = process.env,
  ceiling: ToolRisk = MENTION_GATEWAY_M1_MAX_RISK,
): ToolRisk {
  const raw = (env.MENTION_GATEWAY_MAX_RISK || "").trim().toLowerCase();
  if (!raw || !isToolRisk(raw)) return ceiling;
  return RISK_ORDER[raw] <= RISK_ORDER[ceiling] ? raw : ceiling;
}

// ── M2-A：身份来源 / 已验证要求 / 管理 API ──────────────────────────────────

/** Mention 身份来源：fixture=M1 测试夹具；db=持久化 ExternalIdentity。非法值 → null（fail-closed，不 fallback） */
export type MentionIdentitySource = "fixture" | "db";

export function resolveMentionIdentitySourceWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): MentionIdentitySource | null {
  const raw = (env.MENTION_GATEWAY_IDENTITY_SOURCE || "").trim().toLowerCase();
  if (!raw || raw === "fixture") return "fixture";
  if (raw === "db") return "db";
  return null;
}

export type MentionBindingSource = "fixture" | "db";

/**
 * M2-B 频道绑定来源：fixture（默认，M1 语义不变）| db（持久化 ChannelContextBinding）。
 * 非法值 → null（调用方必须 fail-closed 为 GATEWAY_DISABLED，绝不 fallback fixture）。
 */
export function resolveMentionBindingSourceWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): MentionBindingSource | null {
  const raw = (env.MENTION_GATEWAY_BINDING_SOURCE || "").trim().toLowerCase();
  if (!raw || raw === "fixture") return "fixture";
  if (raw === "db") return "db";
  return null;
}

/** M2-B 绑定管理 API 总开关（写与管理 list 全部 404）；缺省 false */
export function isMentionBindingAdminEnabledWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  return envBool(env.MENTION_GATEWAY_BINDING_ADMIN_ENABLED);
}

/**
 * 要求已验证身份（**安全默认 true**）：DB 身份源下
 * `verificationMethod === "LEGACY_SELF_ASSERTED"` 的 ACTIVE 身份仍被拒。
 * 只有显式 0 / false / off / no 才关闭。
 */
export function isMentionRequireVerifiedIdentityEnabledWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  const raw = (env.MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

/** 身份管理 API（全部写操作）的开关；默认关 */
export function isMentionIdentityAdminEnabledWithEnv(
  env: MentionGatewayFlagEnv = process.env,
): boolean {
  return envBool(env.MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED);
}

export function isMentionGatewayEnabled(): boolean {
  return isMentionGatewayEnabledWithEnv(process.env);
}

export function isMentionMockEnabled(): boolean {
  return isMentionMockEnabledWithEnv(process.env);
}

export function resolveMentionGatewayMaxRisk(): ToolRisk {
  return resolveMentionGatewayMaxRiskWithEnv(process.env);
}

/** 调试 / 健康面摘要（不含任何 secret） */
export function describeMentionGatewayFlags(
  env: MentionGatewayFlagEnv = process.env,
): Record<string, unknown> {
  return {
    enabled: isMentionGatewayEnabledWithEnv(env),
    mockEnabled: isMentionMockEnabledWithEnv(env),
    mockRuntimeAllowed: isMentionMockRuntimeAllowedWithEnv(env),
    memoryWriteEnabled: isMentionMemoryWriteEnabledWithEnv(env),
    externalSendEnabled: isMentionExternalSendEnabledWithEnv(env),
    maxRisk: resolveMentionGatewayMaxRiskWithEnv(env),
    maxRiskCeiling: MENTION_GATEWAY_M1_MAX_RISK,
    identitySource: resolveMentionIdentitySourceWithEnv(env),
    bindingSource: resolveMentionBindingSourceWithEnv(env),
    bindingAdminEnabled: isMentionBindingAdminEnabledWithEnv(env),
    requireVerifiedIdentity: isMentionRequireVerifiedIdentityEnabledWithEnv(env),
    identityAdminEnabled: isMentionIdentityAdminEnabledWithEnv(env),
    runtimeEnv: resolveQingyanRuntimeEnv(env as NodeJS.ProcessEnv),
  };
}
