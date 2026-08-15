/**
 * POST /api/projects/[id]/finance/expenses/[expenseId]/fx-settlement — 记录 FX 最终结算
 *
 * 确认银行实际成交汇率 / 入账金额 / 手续费，并在差额非 0 时经既有 ledger 契约
 * （VOID 旧 ACTUAL + correction 新 ACTUAL）修正权威成本 —— route **绝不**直接改 ProjectCost。
 * 权限：PROJECT_PAYMENT_RECORD（结算确认属财务放款方职责，非费用审批权）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  FinanceContractError,
  FinanceTenantError,
  FxContractError,
  SettlementError,
  settleExpenseFx,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string; expenseId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, expenseId } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_PAYMENT_RECORD);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const result = await settleExpenseFx({
      orgId: access.orgId,
      projectId: id,
      expenseId,
      actor: serverActor(access.user.id),
      settledById: access.user.id,
      settledFxRateCadPerOriginalUnit: String(body.settledFxRateCadPerOriginalUnit ?? "0"),
      settlementDate: body.settlementDate ? new Date(String(body.settlementDate)) : new Date(),
      settledCadAmount: String(body.settledCadAmount ?? "0"),
      bankFeeCad: (body.bankFeeCad as string) ?? null,
      fxRateSource: body.fxRateSource === "MANUAL" ? "MANUAL" : "BANK_SETTLEMENT",
      note: (body.note as string) ?? null,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (e) {
    if (
      e instanceof FxContractError ||
      e instanceof SettlementError ||
      e instanceof FinanceContractError
    ) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: (e as { statusCode?: number }).statusCode ?? 409 },
      );
    }
    if (e instanceof FinanceTenantError) {
      return NextResponse.json({ error: "费用不存在", code: e.code }, { status: 404 });
    }
    throw e;
  }
}
