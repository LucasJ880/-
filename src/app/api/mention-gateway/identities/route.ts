/**
 * GET /api/mention-gateway/identities — 身份列表（M2-A）
 *
 * - 默认：本人身份（withAuth；只读，无需管理 flag）
 * - ?userId=<目标>：管理员视角 —— 需 MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED +
 *   requireTenantContext + ORG_MEMBER_ROLE_CHANGE，且目标必须是当前管理 org 在职成员
 *   （否则 404 语义，不泄露存在性）
 *
 * M2-A 明确没有 POST /identities/link 自助入口（SELF_LINK = DEFERRED：
 * 无 proof-of-possession 前允许自助 PENDING = identity-key squatting / DoS）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  requireIdentityAdminContext,
  toIdentityDto,
} from "@/lib/mention-gateway/identity-admin";
import {
  listIdentitiesForAdmin,
  listIdentitiesForUser,
} from "@/lib/mention-gateway/identity-service";

export const GET = withAuth(async (request, _ctx, user) => {
  const targetUserId = request.nextUrl.searchParams.get("userId")?.trim();

  if (targetUserId && targetUserId !== user.id) {
    const admin = await requireIdentityAdminContext(request);
    if (admin instanceof NextResponse) return admin;
    const result = await listIdentitiesForAdmin({
      caller: { userId: user.id, role: user.role },
      managementOrgId: admin.tenant.orgId,
      targetUserId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.code, message: result.message },
        { status: result.code === "CALLER_FORBIDDEN" ? 403 : 404 },
      );
    }
    return NextResponse.json({
      identities: result.identities.map(toIdentityDto),
    });
  }

  const identities = await listIdentitiesForUser(user.id);
  return NextResponse.json({ identities: identities.map(toIdentityDto) });
});
