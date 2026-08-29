import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import { loadDiscountsDto } from "@/lib/blinds/discount-settings";

/**
 * GET /api/sales/commission-summary
 *
 * 本人本月「单据毛利」口径的提成汇总：
 *   真实毛利 = Σ(SalesQuoteItem.price − costPrice)（仅含有成本快照的行）
 *   提成 = 真实毛利 × commissionRate（驾驶舱配置，默认 30%）
 *
 * 统计窗口与业绩页一致：本自然月（服务器本地），按 signedAt 落月、
 * status=signed、createdById=本人。历史单无成本快照 → 计入 uncosted，
 * 前端如实展示覆盖率，绝不虚构。
 */
export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.quote.read");
  if (!scope.allowed) {
    return NextResponse.json({ error: "无权查看提成数据" }, { status: 403 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [settings, quotes] = await Promise.all([
    loadDiscountsDto(orgRes.orgId),
    db.salesQuote.findMany({
      where: {
        orgId: orgRes.orgId,
        createdById: user.id,
        status: "signed",
        signedAt: { gte: monthStart },
      },
      select: {
        id: true,
        grandTotal: true,
        items: { select: { price: true, costPrice: true } },
      },
    }),
  ]);

  let realMargin = 0;
  let quotesWithCost = 0;
  let itemsCosted = 0;
  let itemsTotal = 0;
  for (const quote of quotes) {
    let quoteCosted = false;
    for (const item of quote.items) {
      itemsTotal += 1;
      if (item.costPrice != null) {
        realMargin += item.price - item.costPrice;
        itemsCosted += 1;
        quoteCosted = true;
      }
    }
    if (quoteCosted) quotesWithCost += 1;
  }
  realMargin = Math.round(realMargin * 100) / 100;

  const commissionRate = settings.commissionRate;
  return NextResponse.json({
    monthStart: monthStart.toISOString(),
    quotesSigned: quotes.length,
    quotesWithCost,
    itemsCosted,
    itemsTotal,
    realMargin,
    commissionRate,
    realCommission: Math.round(realMargin * commissionRate * 100) / 100,
    costRatesConfigured: Object.keys(settings.costRates).length > 0,
  });
});
