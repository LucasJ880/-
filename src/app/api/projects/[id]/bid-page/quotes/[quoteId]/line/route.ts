/**
 * BIDPAGE-3 逐行报价：读 / 存
 *
 * GET /api/projects/{id}/bid-page/quotes/{quoteId}/line —— 内部成本权限 + 财务查看权：行、共用参数、预置、其它成本行、
 *     引擎结果与按货值分摊的每行数、差额、已报价的询价回复；表空时附招标分析带入的粘贴文本
 * PUT 同一地址 —— 编辑权限 + 财务查看权：{ baseUpdatedAt, state } → 校验（指到第几行）→ 事务写自己管的成本行 → 快照 → 审计
 *
 * 不是逐行报价 → 409（去专业模式）；冻结 → 409；别人改过 → 409。第一步就是报价权限守卫并紧接着检查（FIX-21）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { saveLineModeRequestSchema } from "@/lib/bid-page-v2/quote-line/contract";
import { loadLineView, saveLineView } from "@/lib/bid-page-v2/quote-line/service";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "internal_cost");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json(await loadLineView({ projectId, orgId: access.orgId, quoteId, caps: gate.caps }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "edit");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  const parsed = saveLineModeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提交的内容格式不对，请刷新后再试", code: "VALIDATION" }, { status: 400 });
  try {
    return NextResponse.json(await saveLineView({ projectId, orgId: access.orgId, quoteId, userId: access.user.id, caps: gate.caps, request: parsed.data }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
