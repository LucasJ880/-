/**
 * BIDPAGE-6 一次定价（spec tender/quote-one-step-confirm「定为我方报价一次完成提交、批准、选定」）（openspec change quote-one-step-confirm）
 *
 * POST /api/projects/{id}/bid-page/quotes/{quoteId}/confirm —— 批准权限 + 财务查看权：{ baseUpdatedAt, expectedSellingPrice }
 *   → 草稿 / 待批准 / 已批准没选上 → 已批准 + 我方报价（一个事务）；200 { id, status, version, isOurBid, reselectedFrom, alreadyOurBid }
 *
 * 守卫级别固定、不看请求体（spec「四个接口的守卫与门」）；第一步就是报价权限守卫并紧接着检查（FIX-21）。
 * 开关关 / 不是招投标项目 → 404（不读请求体、不碰库）；没有内部成本权限或财务查看权 → 403；请求体不对 → 400。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { confirmRequestSchema } from "@/lib/bid-page-v2/quote-confirm/contract";
import { confirmAsOurBid } from "@/lib/bid-page-v2/quote-confirm/service";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "approve");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  const parsed = confirmRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提交的内容格式不对，请刷新后再试", code: "VALIDATION" }, { status: 400 });
  try {
    return NextResponse.json(await confirmAsOurBid({ projectId, orgId: access.orgId, userId: access.user.id, quoteId, request: parsed.data }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
