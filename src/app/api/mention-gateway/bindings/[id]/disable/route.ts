/**
 * POST /api/mention-gateway/bindings/:id/disable — ACTIVE → DISABLED（可逆暂停）
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  bindingServiceResponse,
  requireBindingAdminContext,
} from "@/lib/mention-gateway/binding-admin";
import { disableChannelBinding } from "@/lib/mention-gateway/binding-service";

const BodySchema = z.object({ reason: z.string().max(500).optional() }).strict();

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const admin = await requireBindingAdminContext(request);
  if (admin instanceof NextResponse) return admin;
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const result = await disableChannelBinding({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    bindingId: id,
    reason: parsed.data.reason,
  });
  return bindingServiceResponse(result);
});
