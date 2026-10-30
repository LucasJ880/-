/**
 * 日程来源统计（CAL-1 · spec calendar/change-attribution）
 *
 * GET /api/sales/calendar/attribution?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   - 授权：sales.analytics.read；ORG → bySource + byActor + unknownSamples；仅 PRINCIPAL → 只给本人一行
 *   - 期间按组织当地日解释，解析与期间汇总相同；不合法 → 400 INVALID_PERIOD
 *   - 新建按 Google 创建时间、修改 / 删除按 Google 更新时间落在期间计
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { db } from "@/lib/db";
import { readCalendarWatch } from "@/lib/calendar-watch/pure";
import { loadCalendarAttribution } from "@/lib/calendar-watch/stats";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import { resolvePeriodParams } from "@/lib/sales/period/load";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.analytics.read");
  if (!scope.allowed) {
    return NextResponse.json({ error: "无权查看销售分析", reasonCode: scope.reasonCode }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const timezone = await loadOrgTimezone(orgRes.orgId);
  const parsed = resolvePeriodParams({ from: sp.get("from"), to: sp.get("to") }, new Date(), timezone);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "期间参数不合法：from / to 须为 YYYY-MM-DD，to 不早于 from，跨度不超过 366 天", code: "INVALID_PERIOD", problem: parsed.problem },
      { status: 400 },
    );
  }
  const { period } = parsed;
  const org = await db.organization.findUnique({ where: { id: orgRes.orgId }, select: { settingsJson: true } });
  const summary = await loadCalendarAttribution({
    orgId: orgRes.orgId,
    period,
    scope: scope.ownOnly ? { kind: "own", userId: user.id } : { kind: "org" },
  });
  return NextResponse.json({
    period: { from: period.from, to: period.to, days: period.days, timezone: period.timezone },
    enabled: readCalendarWatch(org?.settingsJson ?? null).enabled,
    ...summary,
  });
});
