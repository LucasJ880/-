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

/** ProjectWorkDomain（tender|delivery|general）→ ToolDomain（tool-auth 词表） */
export function toolDomainForWorkDomain(
  workDomain: string | null | undefined,
): "project" | "sales" | "system" {
  const wd = (workDomain ?? "").trim().toLowerCase();
  if (wd === "tender" || wd === "delivery") return "project";
  if (wd === "sales") return "sales";
  // 未标注 workDomain 的历史 run：按最小权限落到 system（模块 operations）
  return wd === "general" ? "system" : "system";
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
  workDomain: string | null;
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

/**
 * 解析执行期策略上下文（server 权威）。
 * fail-closed：租户解析失败时返回 null——调用方必须拒绝执行，绝不"无策略放行"。
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
}): Promise<WorkforceExecutionPolicy | null> {
  const now = input.now ?? Date.now();
  const key = cacheKey(input.runId, input.userId);
  if (!input.forceRefresh) {
    const hit = cache.get(key);
    if (hit && isExecutionPolicyFresh(hit.policy, now)) return hit.policy;
  }

  const meta = input.runMetadata ?? {};
  const workDomain =
    typeof meta.workDomain === "string" && meta.workDomain.trim()
      ? meta.workDomain.trim()
      : null;

  const resolved = await resolveAgentTenant(
    { id: input.userId, role: input.role ?? "" },
    input.orgId,
  ).catch(() => null);
  if (!resolved || "error" in resolved) return null;

  const toolDomain = toolDomainForWorkDomain(workDomain);
  const policy: WorkforceExecutionPolicy = {
    orgId: input.orgId,
    workDomain,
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
  return policy;
}
