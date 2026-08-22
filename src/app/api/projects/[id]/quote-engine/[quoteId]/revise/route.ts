import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { QuoteEngineError, reviseQuote } from "@/lib/quote-engine/service";

/** POST { reason }：创建修订版本（不覆盖历史；approved 旧版 → superseded） */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  try {
    const q = await reviseQuote({ quoteId, projectId: id, userId: access.user.id, orgId: access.orgId, reason: String(body.reason ?? "") });
    return NextResponse.json({ id: q.id, version: q.version, sourceQuoteId: q.sourceQuoteId }, { status: 201 });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
