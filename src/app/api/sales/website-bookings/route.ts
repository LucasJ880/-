/**
 * 网站预约待转入列表（CAL-2 · spec calendar/website-booking-intake）
 *
 * GET /api/sales/website-bookings
 *   - 授权：sales.customer.create（任意范围）或全企业范围的 sales.customer.read，否则 403
 *   - 来源：CAL-1 账本里首次记录为新建且归因网站的事件；排除已删除 / 已转入 / 已忽略 / 开始早于当地 7 天前；≤ 200 条
 *   - 不返回描述与联系方式；日历观察未开启 → { enabled: false, items: [] }
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { listWebsiteBookings, resolveIntakeAccess } from "@/lib/calendar-watch/intake";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const access = await resolveIntakeAccess(user, orgRes.orgId);
  if (!access.canView) return NextResponse.json({ error: "无权查看网站预约" }, { status: 403 });
  const { enabled, items } = await listWebsiteBookings(orgRes.orgId);
  return NextResponse.json({ enabled, canConvert: access.canConvert, items });
});
