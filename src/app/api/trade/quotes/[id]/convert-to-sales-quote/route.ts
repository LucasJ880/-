/**
 * POST /api/trade/quotes/[id]/convert-to-sales-quote
 * 人工将 TradeQuote 转为 SalesQuote（单次、可追溯）
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { logActivity } from "@/lib/trade/activity-log";
import {
  executeTradeQuoteToSalesQuoteConvert,
  type ConvertTradeQuoteToSalesQuoteBody,
} from "@/lib/trade/trade-quote-sales-quote";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as ConvertTradeQuoteToSalesQuoteBody;
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { id: tradeQuoteId } = await params;

  try {
    const r = await executeTradeQuoteToSalesQuoteConvert({
      orgId: orgRes.orgId,
      userId: auth.user.id,
      tradeQuoteId,
      body,
    });
    if (r instanceof NextResponse) return r;

    await logActivity({
      orgId: orgRes.orgId,
      prospectId: r.logMeta.prospectId,
      campaignId: r.logMeta.campaignId ?? undefined,
      action: "convert_trade_quote_to_sales_quote",
      detail: `TradeQuote=${tradeQuoteId} → SalesQuote=${r.salesQuote.id}`,
      meta: {
        tradeQuoteId,
        salesQuoteId: r.salesQuote.id,
        salesCustomerId: r.salesQuote.customerId,
        salesOpportunityId: r.salesQuote.opportunityId ?? "",
      },
    });

    return NextResponse.json({ ok: true, salesQuote: r.salesQuote });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "该外贸报价已转换过（唯一约束）" }, { status: 409 });
    }
    throw e;
  }
}
