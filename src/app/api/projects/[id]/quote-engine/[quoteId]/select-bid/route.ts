import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { QuoteEngineError } from "@/lib/quote-engine/service";
import { selectQuoteAsTenderBid } from "@/lib/quote-engine/tender-bid";

/** POST：把 approved/awarded 报价选为 Tender 我方报价（approve 权限；draft/review 拒绝） */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "approve");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { reason?: string | null };
  try {
    const bid = await selectQuoteAsTenderBid({ projectId: id, quoteId, orgId: access.orgId, userId: access.user.id, reason: body.reason ?? null });
    return NextResponse.json({ bid });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
    throw e;
  }
}
