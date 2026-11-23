/**
 * BIDPAGE-3 按招标方价格表导出
 *
 * GET /api/projects/{id}/bid-page/quotes/{quoteId}/export —— 内部成本权限 + 财务查看权；只导出当前的我方报价（已定）且是逐行报价，
 * 单价与行合计与逐行表相同（同一个分摊与取整）。否则 409 并写明原因。CSV 列名与「不含 HST」是交给招标方的英文正文。
 *
 * 第一步就是报价权限守卫并紧接着检查（FIX-21）。只读，不写库。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { exportLineQuote } from "@/lib/bid-page-v2/quote-line/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "internal_cost");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  try {
    const out = await exportLineQuote({ projectId, orgId: access.orgId, quoteId });
    return new NextResponse(out.csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
