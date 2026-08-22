import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { computeForQuote, engineOf, getQuote, QuoteEngineError } from "@/lib/quote-engine/service";
import { getCompanyIdentity } from "@/lib/quote-engine/quotation-identity";
import { buildCustomerView, customerViewLeaks } from "@/lib/quote-engine/customer-view";

/** GET：客户侧投影（项目读权限即可；服务端再做泄露自检，命中即 500 拒发） */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "read");
  if (access instanceof NextResponse) return access;
  try {
    const q = await getQuote(quoteId, id);
    const computed = computeForQuote(q);
    const view = buildCustomerView({ quote: q, calc: computed.calc.ok ? computed.calc : null, tiers: computed.standingOffer?.tiers ?? null, tax: engineOf(q).tax ?? null, company: await getCompanyIdentity(access.orgId) });
    const leaks = customerViewLeaks(view);
    if (leaks.length > 0) return NextResponse.json({ error: "客户视图泄露自检失败", leaks }, { status: 500 });
    return NextResponse.json({ customerView: view });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
