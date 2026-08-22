import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { computeForQuote, getQuote, QuoteEngineError } from "@/lib/quote-engine/service";
import { analyzeQuote } from "@/lib/quote-engine/analyze";

/** GET：确定性分析（advisory；internal_cost 权限） */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "internal_cost");
  if (access instanceof NextResponse) return access;
  try {
    const q = await getQuote(quoteId, id);
    const computed = computeForQuote(q);
    if (!computed.calc.ok) return NextResponse.json({ analysis: null, errors: computed.calc.errors });
    return NextResponse.json({ analysis: analyzeQuote({ quoteType: q.quoteType, calc: computed.calc, standingOffer: computed.standingOffer }) });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
