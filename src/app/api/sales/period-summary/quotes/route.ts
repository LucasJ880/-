/**
 * 按人报价明细（STAT-1 · spec sales/period-summary"按人报价明细"）
 *
 * GET /api/sales/period-summary/quotes?from=YYYY-MM-DD&to=YYYY-MM-DD&repId=&kind=won|quoted
 *   - 授权同期间汇总：sales.analytics.read；只持本人范围 → repId 缺省本人、为他人 403；全企业范围 repId 必填
 *   - 分组与按人表同一口径；每组最多 500 行（truncated）
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import { resolvePeriodParams } from "@/lib/sales/period/load";
import { isDrilldownKind, loadPeriodRepQuotes } from "@/lib/sales/period/drilldown";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.analytics.read");
  if (!scope.allowed) {
    return NextResponse.json({ error: "无权查看销售分析", reasonCode: scope.reasonCode }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const requested = sp.get("repId")?.trim() || null;
  let repId: string;
  if (scope.ownOnly) {
    if (requested && requested !== user.id) {
      return NextResponse.json({ error: "只能查看本人的报价明细", code: "FORBIDDEN_REP" }, { status: 403 });
    }
    repId = user.id;
  } else {
    if (!requested) {
      return NextResponse.json({ error: "缺少 repId（报价创建人）", code: "INVALID_REP" }, { status: 400 });
    }
    repId = requested;
  }

  const kindRaw = sp.get("kind");
  if (kindRaw && !isDrilldownKind(kindRaw)) {
    return NextResponse.json({ error: "kind 只能是 won 或 quoted", code: "INVALID_KIND" }, { status: 400 });
  }

  const timezone = await loadOrgTimezone(orgRes.orgId);
  const parsed = resolvePeriodParams({ from: sp.get("from"), to: sp.get("to") }, new Date(), timezone);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "期间参数不合法：from / to 须为 YYYY-MM-DD，to 不早于 from，跨度不超过 366 天", code: "INVALID_PERIOD", problem: parsed.problem },
      { status: 400 },
    );
  }

  const data = await loadPeriodRepQuotes({
    orgId: orgRes.orgId,
    repId,
    period: parsed.period,
    kind: isDrilldownKind(kindRaw) ? kindRaw : null,
  });
  return NextResponse.json(data);
});
