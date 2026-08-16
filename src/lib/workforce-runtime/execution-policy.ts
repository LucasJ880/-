/**
 * T5-P0C — 执行期策略上下文（真实 domain / org policy / module policy）
 *
 * 修复的缺陷（预检 §1 APPROVAL_SCOPE_POLICY_INTEGRATED = PARTIAL）：
 * executor 的两处 `canInvokeTool` 输入被硬编码——
 *   domain: "sales"（字面量，tender run 也当销售判）
 *   allowRoles: ["admin","sales"]
 *   modulesJson: undefined  → 模块门整段失活
 *   toolPolicy 缺失          → org disabledTools / forceApprovalTools 从不生效
 * 且 tender 的 7 个工具不在 RUNTIME_V2_TOOL_CATALOG 中 → descriptor 恒 undefined
 * → 风险等级静默降级为 l0_read。即**域错、策略失活、风险也错**。
 *
 * 本模块提供 server 权威的策略上下文：
 * - workDomain 取自 AgentRun.metadata.workDomain（canonical = Project.workDomain 的投影，
 *   由 createWorkforceJob 在建 run 时写入；客户端不可信输入永不参与）
 * - ToolDomain 经**显式映射**得到——两套词表不同，禁止透传：
 *     tender → project（模块 projects/bids）；delivery → project；general → system
 * - modulesJson / toolPolicy / workspaceIds 复用既有 resolveAgentTenant（一次查询拿全）
 * - freshness：同一 run 内按 TTL 缓存，避免每次 tool call 重复昂贵查询；
 *   TTL 到期即重取（策略变更最迟在 TTL 内生效）。resume 路径另有强制重取（见 resume 三道门）。
 */

import { resolveAgentTenant } from "@/lib/tenancy/resolve-agent-tenant";
import type { AgentToolPolicyOverride } from "@/lib/org-rules/types";
import {
  resolveEffectiveWorkDomain,
  type WorkDomain,
  type WorkDomainFailureCode,
  type WorkDomainResolutionSource,
} from "./work-domain";

/**
 * ProjectWorkDomain → ToolDomain（tool-auth 词表）。**纯映射，只认显式值。**
 *
 * Segment 2.5 修正：缺失/未知**不再**落到 system。把"不知道"当成一个确定域
 * 既让历史销售 Job 在第一个工具就 org_role_denied，又给 platform admin
 * 留了一条静默旁路（system 域恰好允许 admin）。缺失的处理属于
 * resolveEffectiveWorkDomain 的取证职责，不是这张映射表的兜底。
 */
export function toolDomainForWorkDomain(
  workDomain: string | null | undefined,
): "project" | "sales" | "system" | null {
  const wd = (workDomain ?? "").trim().toLowerCase();
  if (wd === "tender" || wd === "delivery") return "project";
  if (wd === "sales") return "sales";
  if (wd === "general") return "system";
  return null;
}

/** tool-auth 的角色词表（与 ToolAllowRoles 对齐；不引入第二套） */
export type WorkforceAllowRole =
  | "admin"
  | "sales"
  | "operations"
  | "manager"
  | "boss"
  | "trade"
  | "user";

/** 域对应的允许角色（取代硬编码 ["admin","sales"]） */
export function allowRolesForToolDomain(
  domain: "project" | "sales" | "system",
): readonly WorkforceAllowRole[] {
  if (domain === "sales") return ["admin", "sales"] as const;
  if (domain === "project") return ["admin", "sales", "operations"] as const;
  return ["admin"] as const;
}

export type WorkforceExecutionPolicy = {
  orgId: string;
  /** server 解析出的**有效**业务域（非客户端输入、非默认值） */
  workDomain: WorkDomain;
  /** 仅服务端可观测：该域是怎么来的（不参与任何授权判定） */
  workDomainResolutionSource: WorkDomainResolutionSource;
  toolDomain: "project" | "sales" | "system";
  allowRoles: readonly WorkforceAllowRole[];
  modulesJson: unknown;
  toolPolicy: AgentToolPolicyOverride | undefined;
  workspaceIds: string[];
  orgRole: string | null;
  hasMembership: boolean;
  isPlatformAdmin: boolean;
  /** 解析时刻（freshness 判定用） */
  resolvedAt: number;
};

/** 策略上下文 TTL：同 run 内复用，过期重取（默认 60s，可按 env 调） */
export const EXECUTION_POLICY_TTL_MS = 60_000;

type CacheEntry = { key: string; policy: WorkforceExecutionPolicy };
const cache = new Map<string, CacheEntry>();

function cacheKey(runId: string, userId: string): string {
  return `${runId}:${userId}`;
}

export function isExecutionPolicyFresh(
  policy: WorkforceExecutionPolicy,
  now: number = Date.now(),
  ttlMs: number = EXECUTION_POLICY_TTL_MS,
): boolean {
  return now - policy.resolvedAt < ttlMs;
}

/** 供测试清理（生产不调用） */
export function __clearExecutionPolicyCache(): void {
  cache.clear();
}

export type ResolveExecutionPolicyResult =
  | { ok: true; policy: WorkforceExecutionPolicy }
  | {
      ok: false;
      /** 直接用作 durable step errorCode（与既有 snake_case 错误词表同规范） */
      code: WorkDomainFailureCode | "policy_context_unavailable";
      error: string;
    };

/**
 * 解析执行期策略上下文（server 权威）。
 *
 * fail-closed 两处：租户解析失败、**有效业务域无法证明**。
 * 后者绝不退化成任何默认域——admin 也不例外（§12 DOMAIN-12）。
 *
 * 缓存（§10）：键 runId:userId，存的是**最终 server 解析结果**（含有效域与来源）。
 * 只缓存成功解析；歧义/缺失永不入缓存，因此不存在"第一个工具定域、后续工具搭便车"
 * 的放行窗口。工具证据取自计划落库时一次性创建的全部 step，run 级稳定。
 */
export async function resolveWorkforceExecutionPolicy(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string | null | undefined;
  /** AgentRun.metadata（server 写入；含 workDomain） */
  runMetadata: Record<string, unknown> | null | undefined;
  forceRefresh?: boolean;
  now?: number;
}): Promise<ResolveExecutionPolicyResult> {
  const now = input.now ?? Date.now();
  const key = cacheKey(input.runId, input.userId);
  if (!input.forceRefresh) {
    const hit = cache.get(key);
    if (hit && isExecutionPolicyFresh(hit.policy, now)) {
      return { ok: true, policy: hit.policy };
    }
  }

  const domain = await resolveEffectiveWorkDomain({
    orgId: input.orgId,
    runId: input.runId,
    runMetadata: input.runMetadata,
  });
  if (!domain.ok) {
    return { ok: false, code: domain.code, error: domain.error };
  }

  const resolved = await resolveAgentTenant(
    { id: input.userId, role: input.role ?? "" },
    input.orgId,
  ).catch(() => null);
  if (!resolved || "error" in resolved) {
    return {
      ok: false,
      code: "policy_context_unavailable",
      error: "无法解析组织租户策略（org/module/toolPolicy）",
    };
  }

  // 显式域已经过 normalize，映射必定命中；null 属不可达的编程错误，仍 fail-closed
  const toolDomain = toolDomainForWorkDomain(domain.workDomain);
  if (!toolDomain) {
    return {
      ok: false,
      code: "work_domain_ambiguous",
      error: `业务域 ${domain.workDomain} 没有对应的 ToolDomain 映射`,
    };
  }

  const policy: WorkforceExecutionPolicy = {
    orgId: input.orgId,
    workDomain: domain.workDomain,
    workDomainResolutionSource: domain.source,
    toolDomain,
    allowRoles: allowRolesForToolDomain(toolDomain),
    modulesJson: resolved.modulesJson,
    toolPolicy: resolved.toolPolicy,
    workspaceIds: resolved.workspaceIds ?? [],
    orgRole: resolved.orgRole ?? null,
    hasMembership: resolved.hasMembership,
    isPlatformAdmin: resolved.isPlatformAdmin,
    resolvedAt: now,
  };
  cache.set(key, { key, policy });
  return { ok: true, policy };
}
