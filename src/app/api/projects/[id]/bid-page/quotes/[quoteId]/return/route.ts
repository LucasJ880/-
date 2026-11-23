/**
 * BIDPAGE-6 退回（spec「退回」）（openspec change quote-one-step-confirm）
 *
 * POST /api/projects/{id}/bid-page/quotes/{quoteId}/return —— 批准权限 + 财务查看权：{ baseUpdatedAt, note? }
 *   → 待批准 → 草稿，原因记在审计里；200 { id, status, version }
 *
 * 守卫级别固定、不看请求体（spec「四个接口的守卫与门」）；第一步就是报价权限守卫并紧接着检查（FIX-21）。
 * 守卫之后：开关关 / 不是招投标项目 → 404（守卫之后不读请求体、不再查库）；没有内部成本权限或财务查看权 → 403；请求体不对 → 400。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { returnRequestSchema } from "@/lib/bid-page-v2/quote-confirm/contract";
import { returnToDraft } from "@/lib/bid-page-v2/quote-confirm/service";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "approve");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  const parsed = returnRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提交的内容格式不对，请刷新后再试", code: "VALIDATION" }, { status: 400 });
  try {
    return NextResponse.json(await returnToDraft({ projectId, orgId: access.orgId, userId: access.user.id, quoteId, request: parsed.data }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
