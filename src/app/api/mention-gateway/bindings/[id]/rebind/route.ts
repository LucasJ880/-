/**
 * POST /api/mention-gateway/bindings/:id/rebind — 显式改绑（OLD ∧ NEW 权限；CROSS_ORG_REBIND 禁止）
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  bindingServiceResponse,
  requireBindingAdminContext,
} from "@/lib/mention-gateway/binding-admin";
import { rebindChannelBinding } from "@/lib/mention-gateway/binding-service";

const BodySchema = z
  .object({
    targetType: z.enum(["project", "customer"]),
    targetId: z.string().min(1).max(128),
    contextRole: z.enum(["tender"]).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const admin = await requireBindingAdminContext(request);
  if (admin instanceof NextResponse) return admin;
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const result = await rebindChannelBinding({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    bindingId: id,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    contextRole: parsed.data.contextRole ?? null,
    reason: parsed.data.reason,
  });
  return bindingServiceResponse(result);
});
