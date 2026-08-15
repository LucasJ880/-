/**
 * PATCH /api/projects/[id]/finance/payments/[paymentId] — { action: "void", reason }
 *
 * 付款为 append-only：纠错只能 VOID + 补偿记录，**没有** DELETE 也**没有**金额原地改。
 * 与记录付款同权（PROJECT_PAYMENT_RECORD）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  FinanceContractError,
  FinanceTenantError,
  SettlementError,
  voidPayment,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id, paymentId } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_PAYMENT_RECORD);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  if (action !== "void") {
    return NextResponse.json(
      { error: `未知 action: ${action}（付款仅支持 void；不可删除、不可改额）` },
      { status: 400 },
    );
  }

  try {
    const result = await voidPayment({
      orgId: access.orgId,
      projectId: id,
      paymentId,
      actor: serverActor(access.user.id),
      voidedById: access.user.id,
      reason: String(body.reason ?? ""),
    });
    return NextResponse.json({ ok: true, voided: result.created });
  } catch (e) {
    if (e instanceof SettlementError || e instanceof FinanceContractError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: (e as { statusCode?: number }).statusCode ?? 409 },
      );
    }
    if (e instanceof FinanceTenantError) {
      return NextResponse.json({ error: "付款记录不存在", code: e.code }, { status: 404 });
    }
    throw e;
  }
}
