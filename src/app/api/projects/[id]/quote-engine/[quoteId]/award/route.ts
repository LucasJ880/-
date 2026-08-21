import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { awardQuoteToBudget, QuoteEngineError } from "@/lib/quote-engine/service";

/** POST { createBudget }：approved → awarded；成本分解映射为 ProjectBudgetVersion（财务 flag dark 时只返回映射） */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "approve");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { createBudget?: boolean };
  try {
    const r = await awardQuoteToBudget({ quoteId, projectId: id, userId: access.user.id, orgId: access.orgId, createBudget: body.createBudget !== false });
    return NextResponse.json({ ok: true, status: r.quote.status, budgetLines: r.budgetLines, budgetVersionId: r.budgetVersionId, budgetCreated: r.budgetCreated, reason: r.reason ?? null });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
    throw e;
  }
}
