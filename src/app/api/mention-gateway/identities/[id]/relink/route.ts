/**
 * POST /api/mention-gateway/identities/:id/relink — 显式高敏感改绑（M2-A）
 *
 * before userId → after userId 全程审计；REVOKED 的恢复也只能走这里。
 * 普通 org 管理员必须同时能管理 old + new（old 已离开 org → 409，跨 org 属
 * platform canonical flow，M2-A deferred）。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  identityServiceResponse,
  requireIdentityAdminContext,
} from "@/lib/mention-gateway/identity-admin";
import { relinkIdentity } from "@/lib/mention-gateway/identity-service";

const BodySchema = z
  .object({
    newUserId: z.string().min(1).max(128),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const admin = await requireIdentityAdminContext(request);
  if (admin instanceof NextResponse) return admin;
  const { id } = await ctx.params;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const result = await relinkIdentity({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    identityId: id,
    newUserId: parsed.data.newUserId,
    reason: parsed.data.reason,
  });
  return identityServiceResponse(result);
});
