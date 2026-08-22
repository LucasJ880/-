import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { QuoteEngineError, transitionQuote } from "@/lib/quote-engine/service";
import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/quote-engine/contract";

/** POST { to, note }：review/draft/cancelled 需 edit；approved/superseded/awarded 需 approve */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { to?: string; note?: string | null };
  const to = body.to as QuoteStatus;
  if (!(QUOTE_STATUSES as readonly string[]).includes(to)) return NextResponse.json({ error: "无效状态" }, { status: 400 });
  const level = to === "approved" || to === "superseded" || to === "awarded" ? "approve" : "edit";
  const access = await requireQuoteAccess(request, id, level);
  if (access instanceof NextResponse) return access;
  try {
    const q = await transitionQuote({ quoteId, projectId: id, userId: access.user.id, orgId: access.orgId, to, note: body.note ?? null });
    return NextResponse.json({ ok: true, status: q.status, version: q.version });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
    throw e;
  }
}
