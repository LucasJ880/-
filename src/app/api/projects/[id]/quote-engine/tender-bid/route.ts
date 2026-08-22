import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { QuoteEngineError } from "@/lib/quote-engine/service";
import { resolveTenderBid } from "@/lib/quote-engine/tender-bid";

/** GET：Tender 我方报价（权威 = 被选中的 approved 引擎报价）；内部数字仅 internal_cost 权限可见 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "read");
  if (access instanceof NextResponse) return access;
  try {
    const bid = await resolveTenderBid({ projectId: id, orgId: access.orgId, internal: access.canViewInternal });
    return NextResponse.json({ bid, capabilities: { canViewInternal: access.canViewInternal, canApprove: access.canApprove } });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
