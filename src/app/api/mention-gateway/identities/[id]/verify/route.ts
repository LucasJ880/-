/**
 * POST /api/mention-gateway/identities/:id/verify — PENDING → ACTIVE；
 * 或 ACTIVE + LEGACY_SELF_ASSERTED → ADMIN_PROVISIONED 升级（M2-A §29）。
 * 重新验证 ownership / 目标用户 / membership / caller 权限。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  identityServiceResponse,
  requireIdentityAdminContext,
} from "@/lib/mention-gateway/identity-admin";
import { verifyIdentity } from "@/lib/mention-gateway/identity-service";

const BodySchema = z.object({}).strict();

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const admin = await requireIdentityAdminContext(request);
  if (admin instanceof NextResponse) return admin;
  const { id } = await ctx.params;

  const body = await request.json().catch(() => ({}));
  if (!BodySchema.safeParse(body ?? {}).success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const result = await verifyIdentity({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    identityId: id,
  });
  return identityServiceResponse(result);
});
