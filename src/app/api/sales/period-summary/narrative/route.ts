/**
 * 期间看板 AI 解读（KPI-2 · spec sales/period-narrative）
 *
 * POST /api/sales/period-summary/narrative?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=prev_period|prev_month
 *   - 开关 SALES_PERIOD_NARRATIVE_ENABLED=true 才可用，否则 404 NARRATIVE_DISABLED
 *   - 授权：sales.analytics.read；ORG → 解读全企业，仅 PRINCIPAL → 只解读本人
 *   - 期间解析与期间汇总相同（400 INVALID_PERIOD）；每人每分钟 6 次（429 RATE_LIMITED）
 *   - 只发起一次模型调用；数字 / 引用 / 格式任一校验不过 → narrative = null + fallbackReason
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import { resolvePeriodParams } from "@/lib/sales/period/load";
import { generatePeriodNarrative } from "@/lib/sales/period/narrative";
import { isPeriodNarrativeEnabled } from "@/lib/sales/period/narrative-pure";

const RATE_LIMIT = { name: "sales-period-narrative", windowMs: 60_000, maxRequests: 6 };

export const POST = withAuth(async (request, _ctx, user) => {
  if (!isPeriodNarrativeEnabled()) {
    return NextResponse.json({ error: "期间看板 AI 解读未开启", code: "NARRATIVE_DISABLED" }, { status: 404 });
  }

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.analytics.read");
  if (!scope.allowed) {
    return NextResponse.json({ error: "无权查看销售分析", reasonCode: scope.reasonCode }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const now = new Date();
  const timezone = await loadOrgTimezone(orgRes.orgId);
  const parsed = resolvePeriodParams({ from: sp.get("from"), to: sp.get("to"), compare: sp.get("compare") }, now, timezone);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "期间参数不合法：from / to 须为 YYYY-MM-DD，to 不早于 from，跨度不超过 366 天；compare 只能是 prev_period 或 prev_month", code: "INVALID_PERIOD", problem: parsed.problem },
      { status: 400 },
    );
  }

  const rl = await checkRateLimitAsync(RATE_LIMIT, `${orgRes.orgId}:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const data = await generatePeriodNarrative({
    orgId: orgRes.orgId,
    userId: user.id,
    scope: scope.ownOnly ? { kind: "own", userId: user.id } : { kind: "org" },
    period: parsed.period,
    compare: parsed.compare,
    now,
  });
  return NextResponse.json(data);
});
