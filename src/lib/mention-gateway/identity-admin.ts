/**
 * Mention Gateway M2-A — 身份管理 API 的路由守卫与响应映射（薄壳共用）
 *
 * - 全部写操作受 MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED（默认 false）门控
 * - 管理 org 只来自服务端 requireTenantContext（activeOrg + active membership），绝不来自 body
 * - 权限：现有 canonical org 成员管理权限 PERMISSIONS.ORG_MEMBER_ROLE_CHANGE
 *   （org_admin / org_owner；平台管理员无 membership → requireTenantContext 403 →
 *    platform-admin provisioning 在 M2-A deferred，不为此新增任何 bypass）
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { PERMISSIONS, hasOrgPermission } from "@/lib/rbac/permissions";
import { requireTenantContext, type TenantContext } from "@/lib/tenancy";
import { isMentionIdentityAdminEnabledWithEnv } from "./flags";
import type { IdentityServiceResult } from "./identity-service";

const RATE_LIMIT = {
  name: "mention-identity-admin",
  windowMs: 60_000,
  maxRequests: 30,
} as const;

export function identityAdminDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: "IDENTITY_ADMIN_DISABLED", message: "身份管理接口未启用" },
    { status: 403 },
  );
}

export async function requireIdentityAdminContext(
  request: NextRequest,
): Promise<{ tenant: TenantContext } | NextResponse> {
  if (!isMentionIdentityAdminEnabledWithEnv(process.env)) {
    return identityAdminDisabledResponse();
  }
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;
  if (!hasOrgPermission(tenant.orgRole, PERMISSIONS.ORG_MEMBER_ROLE_CHANGE)) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "需要组织成员管理权限" },
      { status: 403 },
    );
  }
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
  PROVIDER_TENANT_UNVERIFIED: 422,
  CALLER_FORBIDDEN: 403,
  TARGET_USER_NOT_FOUND: 404,
  TARGET_USER_INACTIVE: 403,
  TARGET_NOT_MEMBER: 403,
  IDENTITY_ALREADY_CLAIMED: 409,
  IDENTITY_NOT_FOUND: 404,
  INVALID_STATE: 409,
  OLD_USER_NOT_MANAGEABLE: 409,
};

/** identity DTO：最小字段；绝不含 token / profile；providerUserId 仅授权管理面可见 */
export function toIdentityDto(identity: {
  id: string;
  provider: string;
  providerTenantId: string;
  providerUserId: string;
  userId: string;
  status: string;
  verificationMethod: string | null;
  verifiedAt: Date | null;
  linkedAt: Date;
  lastSeenAt?: Date | null;
  revokedAt: Date | null;
  createdAt?: Date;
}) {
  return {
    id: identity.id,
    provider: identity.provider,
    providerTenantId: identity.providerTenantId,
    providerUserId: identity.providerUserId,
    userId: identity.userId,
    status: identity.status,
    verificationMethod: identity.verificationMethod,
    verifiedAt: identity.verifiedAt,
    linkedAt: identity.linkedAt,
    lastSeenAt: identity.lastSeenAt ?? null,
    revokedAt: identity.revokedAt,
  };
}

export function identityServiceResponse(result: IdentityServiceResult): NextResponse {
  if (result.ok) {
    return NextResponse.json({
      identity: toIdentityDto(result.identity),
      outcome: result.outcome,
    });
  }
  return NextResponse.json(
    { error: result.code, message: result.message },
    { status: ERROR_STATUS[result.code] ?? 500 },
  );
}
