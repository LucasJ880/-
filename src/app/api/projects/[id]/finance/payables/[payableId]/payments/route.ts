/**
 * GET  /api/projects/[id]/finance/payables/[payableId]/payments — 付款明细（含已冲销行）
 * POST /api/projects/[id]/finance/payables/[payableId]/payments — 记录一笔付款
 *
 * 付款是**第四权**：需 PROJECT_PAYMENT_RECORD，不随 COST_REVIEW 自动获得（RULE 6）。
 * 幂等键由服务端拼装（route 只接受 clientKey 片段），防双击 / 重试重复放款。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  FinanceContractError,
  FinanceTenantError,
  SettlementError,
  listPayablePayments,
  recordPayment,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string; payableId: string }> };

function settlementError(e: unknown): NextResponse {
  if (e instanceof SettlementError || e instanceof FinanceContractError) {
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: (e as { statusCode?: number }).statusCode ?? 409 },
    );
  }
  if (e instanceof FinanceTenantError) {
    return NextResponse.json({ error: "应付记录不存在", code: e.code }, { status: 404 });
  }
  throw e;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id, payableId } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  const result = await listPayablePayments(access.orgId, id, payableId);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, payableId } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_PAYMENT_RECORD);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const result = await recordPayment({
      orgId: access.orgId,
      projectId: id,
      payableId,
      actor: serverActor(access.user.id),
      amountCad: String(body.amountCad ?? "0"),
      paidAt: body.paidAt ? new Date(String(body.paidAt)) : new Date(),
      paymentMethod: String(body.paymentMethod ?? "BANK_TRANSFER"),
      paymentReference: (body.paymentReference as string) ?? null,
      // 放款人恒为服务端已认证用户，绝不取客户端字段
      paidById: access.user.id,
      note: (body.note as string) ?? null,
      clientKey: String(body.clientKey ?? ""),
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (e) {
    return settlementError(e);
  }
}
