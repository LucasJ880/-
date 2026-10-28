/**
 * 销售期间汇总（KPI-1 · spec sales/period-summary）
 *
 * GET /api/sales/period-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=prev_period|prev_month
 *   - 授权：sales.analytics.read；ORG → 全企业 + 按人，仅 PRINCIPAL → 只算本人创建的报价
 *   - from / to 是组织时区的当地日期；都缺省 = 本月 1 日至今天；不合法 → 400 INVALID_PERIOD
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import { loadSalesPeriodSummary } from "@/lib/sales/period/load";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.analytics.read");
  if (!scope.allowed) {
    return NextResponse.json({ error: "无权查看销售分析", reasonCode: scope.reasonCode }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const result = await loadSalesPeriodSummary({
    orgId: orgRes.orgId,
    scope: scope.ownOnly ? { kind: "own", userId: user.id } : { kind: "org" },
    from: sp.get("from"),
    to: sp.get("to"),
    compare: sp.get("compare"),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "期间参数不合法：from / to 须为 YYYY-MM-DD，to 不早于 from，跨度不超过 366 天；compare 只能是 prev_period 或 prev_month", code: "INVALID_PERIOD", problem: result.problem },
      { status: 400 },
    );
  }
  return NextResponse.json(result.data);
});
