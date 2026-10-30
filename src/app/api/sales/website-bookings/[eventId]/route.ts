/**
 * 网站预约详情与预填（CAL-2）
 *
 * GET /api/sales/website-bookings/{eventId}
 *   - 授权同列表；只对待转入事件（否则 404 NOT_PENDING）
 *   - 用日历观察的读取账号实时读取事件；未连接 / 授权失效 409 READER_NOT_CONNECTED；Google 里已无该事件 404 EVENT_NOT_FOUND
 *   - 返回描述原文与预填建议、调用者本人名下电话相同的客户；描述与预填不落库
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getWebsiteBookingDetail, resolveIntakeAccess } from "@/lib/calendar-watch/intake";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";

export const GET = withAuth<{ eventId: string }>(async (request, ctx, user) => {
  const { eventId } = await ctx.params;
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const access = await resolveIntakeAccess(user, orgRes.orgId);
  if (!access.canView) return NextResponse.json({ error: "无权查看网站预约" }, { status: 403 });
  const res = await getWebsiteBookingDetail({ orgId: orgRes.orgId, userId: user.id, eventId });
  if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.status });
  return NextResponse.json({ ...res.data, canConvert: access.canConvert });
});
