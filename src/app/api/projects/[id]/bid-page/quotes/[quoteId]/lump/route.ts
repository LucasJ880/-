/**
 * BIDPAGE-4 只报总价：读 / 存（openspec change quote-lump-sum-mode，spec tender/quote-lump-sum-mode）
 *
 * GET /api/projects/{id}/bid-page/quotes/{quoteId}/lump —— 内部成本权限 + 财务查看权：总价构成表（货品总数 / 明细、各项、销售税、预置）、
 *     其它成本行、引擎结果（六个数与算式）、已报价的询价回复、能否转成逐行
 * PUT 同一地址 —— 编辑权限 + 财务查看权：{ baseUpdatedAt, state } → 校验（指到哪一项）→ 事务写总价表管的成本行与配置里的税 → 快照 → 审计
 *
 * 不是总价报价 → 409；冻结 → 409；别人改过 → 409。第一步就是报价权限守卫并紧接着检查（FIX-21）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { saveLumpRequestSchema } from "@/lib/bid-page-v2/lump-sum/contract";
import { loadLumpView, saveLumpView } from "@/lib/bid-page-v2/lump-sum/service";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "internal_cost");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json(await loadLumpView({ projectId, orgId: access.orgId, quoteId, caps: gate.caps }));
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
  const parsed = saveLumpRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提交的内容格式不对，请刷新后再试", code: "VALIDATION" }, { status: 400 });
  try {
    return NextResponse.json(await saveLumpView({ projectId, orgId: access.orgId, quoteId, userId: access.user.id, caps: gate.caps, request: parsed.data }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
