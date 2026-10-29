/**
 * 网站预约转入（CAL-2 · 销售认领）
 *
 * POST /api/sales/website-bookings/{eventId}/convert
 *   body: { calendarId, customer: { existingCustomerId } | { name, phone?, email?, address? },
 *           appointment?: { type?, title?, startAt?, endAt?, address?, contactPhone?, description?, assignedToId? } }
 *   - 授权：sales.customer.create，否则 403；客户归调用者，预约负责人缺省调用者
 *   - 400 INVALID_INPUT；404 NOT_PENDING / CUSTOMER_NOT_FOUND；409 ALREADY_CONVERTED / CUSTOMER_EXISTS
 *   - 不新建、不修改 Google 事件
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { activeMemberIds, convertWebsiteBooking, resolveIntakeAccess } from "@/lib/calendar-watch/intake";
import { validateConvertInput } from "@/lib/calendar-watch/intake-pure";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";

export const POST = withAuth<{ eventId: string }>(async (request, ctx, user) => {
  const { eventId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: body && typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  const access = await resolveIntakeAccess(user, orgRes.orgId);
  if (!access.canConvert) return NextResponse.json({ error: "无权转入网站预约（需要新建客户权限）" }, { status: 403 });
  const v = validateConvertInput(body, { activeMemberIds: await activeMemberIds(orgRes.orgId) });
  if (!v.ok) return NextResponse.json({ error: v.message, code: "INVALID_INPUT" }, { status: 400 });
  const res = await convertWebsiteBooking({ orgId: orgRes.orgId, userId: user.id, eventId, input: v.value });
  if (!res.ok) {
    return NextResponse.json({ error: res.message, code: res.code, existingCustomer: res.existingCustomer }, { status: res.status });
  }
  return NextResponse.json(res, { status: 201 });
});
