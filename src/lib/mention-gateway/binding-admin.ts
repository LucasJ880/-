/**
 * Mention Gateway M2-B — 绑定管理 API 的路由守卫与响应映射（薄壳共用）
 *
 * - 全部管理操作（含 GET list）受 MENTION_GATEWAY_BINDING_ADMIN_ENABLED（默认 false）门控；
 *   未启用 → 404（不暴露管理面存在性）
 * - 管理 org 只来自服务端 requireTenantContext；orgId 绝不来自 body
 * - target 级权限在 binding-service 内走 canonical 门
 *   （project → requireProjectWriteAccess 决策表；customer → sales.customer.update）
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { requireTenantContext, type TenantContext } from "@/lib/tenancy";
import { isMentionBindingAdminEnabledWithEnv } from "./flags";
import type { BindingServiceResult, ChannelBindingRecord } from "./binding-service";

const RATE_LIMIT = {
  name: "mention-binding-admin",
  windowMs: 60_000,
  maxRequests: 30,
} as const;

export function bindingAdminDisabledResponse(): NextResponse {
  // 404：未启用时不暴露管理面存在性
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

export async function requireBindingAdminContext(
  request: NextRequest,
): Promise<{ tenant: TenantContext } | NextResponse> {
  if (!isMentionBindingAdminEnabledWithEnv(process.env)) {
    return bindingAdminDisabledResponse();
  }
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;
  const rl = await checkRateLimitAsync(RATE_LIMIT, tenant.userId);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }
  return { tenant };
}

const ERROR_STATUS: Record<string, number> = {
  INVALID_PROVIDER: 400,
  INVALID_KEY: 400,
  INVALID_TARGET: 400,
  CONTEXT_ROLE_INVALID: 400,
  PROVIDER_TENANT_UNVERIFIED: 422,
  CALLER_FORBIDDEN: 403,
  TARGET_NOT_FOUND: 404,
  TARGET_PERSONAL_PROJECT: 403,
  BINDING_ALREADY_EXISTS: 409,
  REQUIRE_ENABLE_OR_REBIND: 409,
  BINDING_REVOKED_TERMINAL: 409,
  BINDING_NOT_FOUND: 404,
  INVALID_STATE: 409,
  BINDING_STATE_CHANGED: 409,
  CROSS_ORG_FORBIDDEN: 403,
};

/** binding DTO：管理面最小字段；raw channel/thread id 属功能字段（表本身持有），不含任何 secret */
export function toBindingDto(binding: ChannelBindingRecord | Record<string, unknown>) {
  const b = binding as ChannelBindingRecord;
  return {
    id: b.id,
    provider: b.provider,
    providerTenantId: b.providerTenantId,
    providerChannelId: b.providerChannelId,
    bindingLevel: b.bindingLevel,
    providerThreadId: b.providerThreadId || null,
    orgId: b.orgId,
    projectId: b.projectId,
    customerId: b.customerId,
    contextRole: b.contextRole,
    status: b.status,
    disabledAt: b.disabledAt ?? null,
    revokedAt: b.revokedAt ?? null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function bindingServiceResponse(result: BindingServiceResult): NextResponse {
  if (result.ok) {
    return NextResponse.json({
      binding: toBindingDto(result.binding),
      outcome: result.outcome,
    });
  }
  return NextResponse.json(
    { error: result.code, message: result.message },
    { status: ERROR_STATUS[result.code] ?? 500 },
  );
}
