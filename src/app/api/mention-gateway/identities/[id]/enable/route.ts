/**
 * POST /api/mention-gateway/identities/:id/enable — DISABLED → ACTIVE（M2-A）
 * ENABLE 前重新验证 ownership / 用户 active / membership / caller 权限。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  identityServiceResponse,
  requireIdentityAdminContext,
} from "@/lib/mention-gateway/identity-admin";
import { enableIdentity } from "@/lib/mention-gateway/identity-service";

const BodySchema = z.object({ reason: z.string().max(500).optional() }).strict();

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const admin = await requireIdentityAdminContext(request);
  if (admin instanceof NextResponse) return admin;
  const { id } = await ctx.params;

  const parsed = BodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const result = await enableIdentity({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    identityId: id,
    reason: parsed.data.reason,
  });
  return identityServiceResponse(result);
});
