/**
 * BIDPAGE-3 新版「标书与报价」页 ② 的报价列表与新建
 *
 * GET  /api/projects/{id}/bid-page/quotes —— 内部成本权限 + 财务查看权：报价列表（含做法与报价合计）、能否编辑、可用价格表行数、能否导出
 * POST /api/projects/{id}/bid-page/quotes —— 编辑权限 + 财务查看权：两问 → 新建（逐行 + 只供货 → 逐行报价；其余 → 专业模式）
 *
 * 第一步就是报价权限守卫并紧接着检查（FIX-21）；之后新页面开关与招投标项目（404）、财务查看权（403）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { createQuoteRequestSchema } from "@/lib/bid-page-v2/quote-line/contract";
import { createLineQuote, listLineQuotes } from "@/lib/bid-page-v2/quote-line/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireQuoteAccess(request, projectId, "internal_cost");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json(await listLineQuotes({ projectId, orgId: access.orgId, caps: gate.caps }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireQuoteAccess(request, projectId, "edit");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  const parsed = createQuoteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请选择怎么交价与业务类型", code: "VALIDATION" }, { status: 400 });
  try {
    const created = await createLineQuote({ projectId, orgId: access.orgId, userId: access.user.id, businessType: parsed.data.businessType, name: parsed.data.name ?? null });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
