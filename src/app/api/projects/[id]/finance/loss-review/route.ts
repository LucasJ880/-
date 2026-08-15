/**
 * GET   /api/projects/[id]/finance/loss-review — 落标复盘
 * PATCH /api/projects/[id]/finance/loss-review — { action: "confirm" } 人工确认最终原因
 *
 * 只有 confirm 能写 primaryLossReason / secondaryLossReasons，且必须带服务端认证的真人
 * （LOSS-02）。AI 建议只能经 service 层 suggestLossReasons() 写 aiSuggested*，
 * **本 route 不提供任何写最终原因的 AI 路径**（LOSS-03 的路由层保证）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  FinanceContractError,
  FinanceTenantError,
  LossReviewError,
  confirmLossReview,
  getLossReview,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await getLossReview(access.orgId, id));
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_WRITE);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.action ?? "") !== "confirm") {
    return NextResponse.json(
      { error: "未知 action（落标复盘仅支持 confirm：最终原因必须人工确认）" },
      { status: 400 },
    );
  }

  try {
    const review = await confirmLossReview({
      orgId: access.orgId,
      projectId: id,
      actor: serverActor(access.user.id),
      // 确认人恒为服务端已认证用户，绝不取客户端字段
      confirmedByUserId: access.user.id,
      primaryLossReason: String(body.primaryLossReason ?? ""),
      secondaryLossReasons: Array.isArray(body.secondaryLossReasons)
        ? (body.secondaryLossReasons as string[]).map(String)
        : [],
      evidence: (body.evidence as never) ?? undefined,
      ourBidAmountCad: (body.ourBidAmountCad as string) ?? null,
      winningBidAmountCad: (body.winningBidAmountCad as string) ?? null,
      winnerName: (body.winnerName as string) ?? null,
      notes: (body.notes as string) ?? undefined,
    });
    return NextResponse.json({ ok: true, review });
  } catch (e) {
    if (e instanceof LossReviewError || e instanceof FinanceContractError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: (e as { statusCode?: number }).statusCode ?? 409 },
      );
    }
    if (e instanceof FinanceTenantError) {
      return NextResponse.json({ error: "项目不存在", code: e.code }, { status: 404 });
    }
    throw e;
  }
}
