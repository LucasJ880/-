/**
 * DELETE /api/mention-gateway/identities/:id — revoke（软删除终态；不 physical delete）
 *
 * - 默认 self 路径：owner 本人（服务层 findFirst({ id, userId: caller })，IDOR 安全）
 * - ?scope=admin：管理员路径（requireIdentityAdminContext + 目标用户属管理 org）
 * - 两条路径都受 MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED 门控（写操作统一 flag）
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  identityAdminDisabledResponse,
  identityServiceResponse,
  requireIdentityAdminContext,
} from "@/lib/mention-gateway/identity-admin";
import { isMentionIdentityAdminEnabledWithEnv } from "@/lib/mention-gateway/flags";
import { revokeIdentity } from "@/lib/mention-gateway/identity-service";

const BodySchema = z.object({ reason: z.string().max(500).optional() }).strict();

export const DELETE = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!isMentionIdentityAdminEnabledWithEnv(process.env)) {
    return identityAdminDisabledResponse();
  }
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const adminScope = request.nextUrl.searchParams.get("scope") === "admin";
  if (adminScope) {
    const admin = await requireIdentityAdminContext(request);
    if (admin instanceof NextResponse) return admin;
    return identityServiceResponse(
      await revokeIdentity({
        caller: { userId: user.id, role: user.role },
        identityId: id,
        managementOrgId: admin.tenant.orgId,
        reason: parsed.data.reason,
      }),
    );
  }

  // self revoke：owner 归属在服务层强制（id + userId），跨用户一律 404
  return identityServiceResponse(
    await revokeIdentity({
      caller: { userId: user.id, role: user.role },
      identityId: id,
      managementOrgId: null,
      reason: parsed.data.reason,
    }),
  );
});
