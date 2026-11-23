/**
 * BIDPAGE-3 新版「标书与报价」页 ② 的报价列表与新建
 *
 * GET  /api/projects/{id}/bid-page/quotes —— 内部成本权限 + 财务查看权：报价列表（含做法与报价合计）、能否编辑、可用价格表行数、能否导出
 * POST /api/projects/{id}/bid-page/quotes —— 编辑权限 + 财务查看权：两问 → 新建（逐行 + 只供货 → 逐行报价；只报总价 + 只供货 / 供货加安装 → 总价报价（BIDPAGE-4）；其余 → 专业模式）
 *
 * 第一步就是报价权限守卫并紧接着检查（FIX-21）；之后新页面开关与招投标项目（404）、财务查看权（403）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { createQuoteRequestSchema } from "@/lib/bid-page-v2/quote-line/contract";
import { createLineQuote, listLineQuotes } from "@/lib/bid-page-v2/quote-line/service";
import { createLumpQuote } from "@/lib/bid-page-v2/lump-sum/service";

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
    const { entryMode, businessType } = parsed.data;
    const base = { projectId, orgId: access.orgId, userId: access.user.id, name: parsed.data.name ?? null };
    // 只报总价配只供货与供货加安装；长期供货协议照改版前模板建、从专业模式打开（createLineQuote 的非只供货分支）
    const created = entryMode === "LUMP_SUM" && businessType !== "STANDING_OFFER" ? await createLumpQuote({ ...base, businessType }) : await createLineQuote({ ...base, businessType });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
