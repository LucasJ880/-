/**
 * 销售工具的「服务端权威客户作用域」纯函数（M2-C）
 *
 * 当 ToolExecutionContext.scopeGuard.customerId 存在（客户上下文的 Mention Gateway 等）：
 * - effectiveCustomerId 固定为 scopeGuard.customerId（模型不得自行挑选其它客户）
 * - 不允许按 customerName 重新搜索并切换客户（name 只能是无权威的提示）
 * - opportunityId 必须属于同 org 且属于该客户，否则 fail-closed
 * - 报价 DTO 不得暴露 shareToken
 *
 * scopeGuard 未声明 customerId 时（legacy：Web Operator / agent-core chat / 技能）全部保持原行为。
 * 本文件不访问 DB，便于纯逻辑测试。
 */

import type { ToolExecutionContext } from "../types";

export function isCustomerScoped(ctx: Pick<ToolExecutionContext, "scopeGuard">): boolean {
  const id = ctx.scopeGuard?.customerId;
  return typeof id === "string" && id.trim().length > 0;
}

export type EffectiveCustomer =
  | { customerId: string; source: "scope" | "args" }
  | { customerId: undefined; source: "none" };

/**
 * SERVER AUTHORITATIVE CUSTOMER ID：
 * scope 存在 → 永远返回 scope（args 不同值已由 pre-execute guard 以 SCOPE_CUSTOMER_OVERRIDE 拒绝；
 * 此处再兜底，绝不采用 args）；scope 不存在 → 采用 args（legacy）。
 */
export function resolveEffectiveCustomerId(
  ctx: Pick<ToolExecutionContext, "scopeGuard">,
  argCustomerId: unknown,
): EffectiveCustomer {
  if (isCustomerScoped(ctx)) {
    return { customerId: ctx.scopeGuard!.customerId!.trim(), source: "scope" };
  }
  const arg = typeof argCustomerId === "string" ? argCustomerId.trim() : "";
  return arg ? { customerId: arg, source: "args" } : { customerId: undefined, source: "none" };
}

/** 按客户名搜索并切换客户：仅 legacy（无 customer scope）允许 */
export function customerNameLookupAllowed(
  ctx: Pick<ToolExecutionContext, "scopeGuard">,
): boolean {
  return !isCustomerScoped(ctx);
}

export type OpportunityScopeCheck =
  | { ok: true }
  | { ok: false; error: string; code: "OPPORTUNITY_NOT_FOUND" | "OPPORTUNITY_OUT_OF_SCOPE" };

/**
 * 客户作用域下的商机校验：opportunity.orgId === ctx.orgId 且 opportunity.customerId === effectiveCustomerId。
 * 不泄露跨租户存在性：两类失败都返回同一文案。
 */
export function assertOpportunityWithinCustomerScope(
  opportunity: { orgId: string | null; customerId: string | null } | null,
  ctx: Pick<ToolExecutionContext, "orgId">,
  effectiveCustomerId: string,
): OpportunityScopeCheck {
  const message = "商机不存在或不属于当前客户";
  if (!opportunity) return { ok: false, error: message, code: "OPPORTUNITY_NOT_FOUND" };
  if (opportunity.orgId !== ctx.orgId || opportunity.customerId !== effectiveCustomerId) {
    return { ok: false, error: message, code: "OPPORTUNITY_OUT_OF_SCOPE" };
  }
  return { ok: true };
}

/** 客户作用域下从报价 DTO 中移除 shareToken（legacy 保留原样） */
export function redactQuoteShareTokens<T extends { shareToken?: unknown }>(
  quotes: readonly T[],
  ctx: Pick<ToolExecutionContext, "scopeGuard">,
): Array<Omit<T, "shareToken"> | T> {
  if (!isCustomerScoped(ctx)) return [...quotes];
  return quotes.map((q) => {
    const { shareToken: _omitted, ...rest } = q;
    void _omitted;
    return rest;
  });
}
