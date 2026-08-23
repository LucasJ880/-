/**
 * 工具执行前统一安全边界（fail-closed）
 *
 * 语义（P0-2 / P0-3）：
 * - allowedToolNames === undefined → 调用方未声明 allowlist，不按名称拦截（兼容旧调用）
 * - allowedToolNames === []        → 零工具，全部拒绝
 * - 工具 args 不得覆盖服务端 scopeGuard（orgId / principalUserId / projectId / customerId）
 *   · customerId（M2-C / C1）：与 projectId 同语义——scopeGuard.customerId 存在且 args.customerId
 *     明确给出不同值 → SCOPE_CUSTOMER_OVERRIDE；scopeGuard 未声明 customerId 时不检查（legacy 不变）
 *
 * 参考 Draft PR #52 pre-execute-guard.ts，适配当前 main 的 ToolExecutionContext。
 */

import type { ToolExecutionContext } from "./types";

export type PreExecuteDenyCode =
  | "TOOL_NOT_ALLOWLISTED"
  | "SCOPE_ORG_OVERRIDE"
  | "SCOPE_USER_OVERRIDE"
  | "SCOPE_PROJECT_OVERRIDE"
  | "SCOPE_CUSTOMER_OVERRIDE"
  | "SCOPE_MISSING";

export type PreExecuteDecision =
  | { ok: true }
  | { ok: false; code: PreExecuteDenyCode; error: string };

export function assertToolAllowlist(
  toolName: string,
  allowedToolNames: string[] | undefined,
): PreExecuteDecision {
  if (allowedToolNames === undefined) return { ok: true };
  if (!allowedToolNames.includes(toolName)) {
    return {
      ok: false,
      code: "TOOL_NOT_ALLOWLISTED",
      error: `工具不在本次运行的 allowlist 中: ${toolName}`,
    };
  }
  return { ok: true };
}

/**
 * 验证 tool args 不得覆盖服务端权威 scopeGuard。
 * scopeGuard 缺失时放行（旧路径兼容）；传入 scopeGuard 即 fail-closed。
 */
export function assertArgsMatchScopeGuard(
  args: Record<string, unknown>,
  scopeGuard: ToolExecutionContext["scopeGuard"],
): PreExecuteDecision {
  if (!scopeGuard) return { ok: true };

  if (!scopeGuard.orgId?.trim()) {
    return { ok: false, code: "SCOPE_MISSING", error: "scopeGuard.orgId 缺失" };
  }

  const argOrg = typeof args.orgId === "string" ? args.orgId.trim() : "";
  if (argOrg && argOrg !== scopeGuard.orgId) {
    return {
      ok: false,
      code: "SCOPE_ORG_OVERRIDE",
      error: "工具参数不得覆盖 ScopeContext.orgId",
    };
  }

  const argUser =
    typeof args.userId === "string"
      ? args.userId.trim()
      : typeof args.principalUserId === "string"
        ? args.principalUserId.trim()
        : "";
  if (argUser && argUser !== scopeGuard.principalUserId) {
    return {
      ok: false,
      code: "SCOPE_USER_OVERRIDE",
      error: "工具参数不得覆盖 ScopeContext.principalUserId",
    };
  }

  const argProject =
    typeof args.projectId === "string" ? args.projectId.trim() : "";
  if (argProject && scopeGuard.projectId && argProject !== scopeGuard.projectId) {
    return {
      ok: false,
      code: "SCOPE_PROJECT_OVERRIDE",
      error: "工具参数不得覆盖 ScopeContext.projectId",
    };
  }

  // M2-C / C1：customerId 与 projectId 同语义（fail-closed；scope 未声明时不检查）
  const argCustomer =
    typeof args.customerId === "string" ? args.customerId.trim() : "";
  if (argCustomer && scopeGuard.customerId && argCustomer !== scopeGuard.customerId) {
    return {
      ok: false,
      code: "SCOPE_CUSTOMER_OVERRIDE",
      error: "工具参数不得覆盖 ScopeContext.customerId",
    };
  }

  return { ok: true };
}

export function runPreExecuteGuards(input: {
  toolName: string;
  ctx: ToolExecutionContext;
}): PreExecuteDecision {
  const allow = assertToolAllowlist(input.toolName, input.ctx.allowedToolNames);
  if (!allow.ok) return allow;
  return assertArgsMatchScopeGuard(input.ctx.args ?? {}, input.ctx.scopeGuard);
}
