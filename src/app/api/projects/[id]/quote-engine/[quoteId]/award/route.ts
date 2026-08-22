import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { awardQuoteToBudget, QuoteEngineError } from "@/lib/quote-engine/service";

/** POST { mode: "with_budget" | "without_budget" }：with_budget = 预算版本 + awarded 同一事务（失败/未启用 → 409，quote 保持 approved）；without_budget = 显式不建预算直接 award */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "approve");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { mode?: "with_budget" | "without_budget" };
  const mode = body.mode === "without_budget" ? "without_budget" : "with_budget";
  try {
    const r = await awardQuoteToBudget({ quoteId, projectId: id, userId: access.user.id, orgId: access.orgId, mode });
    return NextResponse.json({ ok: true, mode: r.mode, status: r.quote.status, budgetLines: r.budgetLines, budgetVersionId: r.budgetVersionId, budgetCreated: r.budgetCreated });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
    throw e;
  }
}
