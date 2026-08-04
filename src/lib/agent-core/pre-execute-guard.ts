/**
 * 工具执行前安全边界（fail-closed）
 *
 * - allowedToolNames === undefined → 不按名称白名单拦截（兼容旧调用）
 * - allowedToolNames === [] → 禁止一切工具
 * - Scope 冲突 → 拒绝（不进入 executor）
 */

import type { ToolExecutionContext } from "./types";

export type PreExecuteDenyCode =
  | "TOOL_NOT_ALLOWLISTED"
  | "SCOPE_ORG_OVERRIDE"
  | "SCOPE_USER_OVERRIDE"
  | "SCOPE_PROJECT_OVERRIDE"
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
      error: `工具不在 allowlist 中: ${toolName}`,
    };
  }
  return { ok: true };
}

/**
 * 验证 tool args 不得覆盖 authoritative ScopeContext。
 * scopeGuard 缺失时：若 args 含 orgId/userId/projectId 仍允许（旧路径兼容），
 * 但 Harness/QM 路径必须传入 scopeGuard。
 */
export function assertArgsMatchScopeGuard(
  args: Record<string, unknown>,
  scopeGuard: ToolExecutionContext["scopeGuard"],
): PreExecuteDecision {
  if (!scopeGuard) return { ok: true };

  if (!scopeGuard.orgId?.trim()) {
    return { ok: false, code: "SCOPE_MISSING", error: "ScopeGuard.orgId 缺失" };
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
  if (
    argProject &&
    scopeGuard.projectId &&
    argProject !== scopeGuard.projectId
  ) {
    return {
      ok: false,
      code: "SCOPE_PROJECT_OVERRIDE",
      error: "工具参数不得覆盖 ScopeContext.projectId",
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
