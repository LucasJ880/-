/**
 * GET /api/trade/quotes/[id]/sales-conversion-preview
 * 预览 TradeQuote → SalesQuote 转换（不写入）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { buildTradeQuoteToSalesQuotePreview } from "@/lib/trade/trade-quote-sales-quote";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const r = await buildTradeQuoteToSalesQuotePreview({
    orgId: orgRes.orgId,
    tradeQuoteId: id,
  });
  if (r instanceof NextResponse) return r;
  return NextResponse.json(r);
}
