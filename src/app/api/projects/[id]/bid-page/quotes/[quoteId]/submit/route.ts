/**
 * BIDPAGE-6 提交给负责人（spec「提交给负责人」「给负责人的站内通知」）（openspec change quote-one-step-confirm）
 *
 * POST /api/projects/{id}/bid-page/quotes/{quoteId}/submit —— 编辑权限 + 财务查看权：{ baseUpdatedAt }
 *   → 草稿 → 待批准，再给项目负责人发一条站内通知；200 { id, status, version, notify, messageZh }
 *
 * 守卫级别固定、不看请求体（spec「四个接口的守卫与门」）；第一步就是报价权限守卫并紧接着检查（FIX-21）。
 * 开关关 / 不是招投标项目 → 404（不读请求体、不碰库）；没有内部成本权限或财务查看权 → 403；请求体不对 → 400。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { submitRequestSchema } from "@/lib/bid-page-v2/quote-confirm/contract";
import { submitForReview } from "@/lib/bid-page-v2/quote-confirm/service";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "edit");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  const parsed = submitRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提交的内容格式不对，请刷新后再试", code: "VALIDATION" }, { status: 400 });
  try {
    return NextResponse.json(await submitForReview({ projectId, orgId: access.orgId, userId: access.user.id, quoteId, request: parsed.data }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
