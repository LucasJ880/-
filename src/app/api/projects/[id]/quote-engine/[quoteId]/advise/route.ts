/**
 * POST /api/projects/[id]/quote-engine/[quoteId]/advise · AI 建议（只读建议，绝不写库）
 * body: { kind: "duty" } → 关税税率建议（材料行说明 → Tavily → LLM，带出处）
 *       { kind: "margin" } → 毛利率建议（15–30，按售价倒扣口径）
 * 权限：edit（能改报价的人才需要建议）；flag OFF → 404 dark（requireQuoteAccess 统一处理）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { getQuote, computeForQuote } from "@/lib/quote-engine/service";
import { AdvisorError, adviseDutyRate, adviseMargin } from "@/lib/quote-engine/advisors";
import { PROCUREMENT_CATEGORIES } from "@/lib/quote-engine/contract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id: projectId, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, projectId, "edit");
  if (access instanceof NextResponse) return access;
  let body: { kind?: string };
  try {
    body = (await request.json()) as { kind?: string };
  } catch {
    return NextResponse.json({ error: "无效请求体" }, { status: 400 });
  }
  try {
    const q = await getQuote(quoteId, projectId);
    if (body.kind === "duty") {
      const materials = q.costLines
        .filter((l) => l.included && ((PROCUREMENT_CATEGORIES as readonly string[]).includes(l.category) || l.category === "MATERIAL"))
        .map((l) => l.description)
        .filter((d): d is string => !!d);
      const advice = await adviseDutyRate({ orgId: access.orgId, userId: access.user.id, materials });
      return NextResponse.json({ kind: "duty", advice });
    }
    if (body.kind === "margin") {
      const computed = computeForQuote(q);
      if (!computed.calc.ok) return NextResponse.json({ error: "报价存在输入非法，先修正再请求建议", details: computed.calc.errors }, { status: 409 });
      const advice = await adviseMargin({
        orgId: access.orgId,
        userId: access.user.id,
        quoteType: q.quoteType,
        currency: q.currency,
        projectName: q.name ?? null,
        baseCost: computed.calc.baseCost,
        breakdown: computed.calc.breakdown.filter((b) => b.category !== "PROFIT").map((b) => ({ category: b.category, amount: b.amount })),
      });
      return NextResponse.json({ kind: "margin", advice });
    }
    return NextResponse.json({ error: "kind 必须是 duty | margin" }, { status: 400 });
  } catch (e) {
    if (e instanceof AdvisorError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.code === "ADVISOR_UNAVAILABLE" ? 503 : 422 });
    const msg = e instanceof Error ? e.message : "建议器失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
