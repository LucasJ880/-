/**
 * 忽略网站预约（CAL-2）
 *
 * POST /api/sales/website-bookings/{eventId}/dismiss   body: { reason? (≤ 200 字) }
 *   - 授权同列表；重复忽略幂等返回 200；不在待转入列表 404 NOT_PENDING
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { dismissWebsiteBooking, resolveIntakeAccess } from "@/lib/calendar-watch/intake";
import { validateDismissInput } from "@/lib/calendar-watch/intake-pure";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";

export const POST = withAuth<{ eventId: string }>(async (request, ctx, user) => {
  const { eventId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: body && typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  const access = await resolveIntakeAccess(user, orgRes.orgId);
  if (!access.canView) return NextResponse.json({ error: "无权处理网站预约" }, { status: 403 });
  const v = validateDismissInput(body);
  if (!v.ok) return NextResponse.json({ error: v.message, code: "INVALID_INPUT" }, { status: 400 });
  const res = await dismissWebsiteBooking({ orgId: orgRes.orgId, userId: user.id, eventId, reason: v.reason });
  if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.status });
  return NextResponse.json({ ok: true, already: res.already });
});
