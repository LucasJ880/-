/**
 * GET  /api/projects/[id]/finance/revenue — 收入明细 + 汇总
 * POST /api/projects/[id]/finance/revenue — 记一条收入（合同额 / 已批变更单 / 调整）
 *
 * ProjectRevenueEntry 是**唯一权威收入源**（REVENUE_SOURCE_GAP 的解）；
 * ProjectQuote / Project.estimatedValue|ourBidPrice|winningBidPrice 一律不参与。
 * 权限：读 COST_READ；写 COST_WRITE（收入是经营事实录入，与预算编辑同权，不需要审批权）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  FinanceContractError,
  FinanceTenantError,
  FxContractError,
  RevenueLifecycleError,
  getProjectRevenueRollup,
  listRevenueEntries,
  recordRevenueEntry,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string }> };

function revenueError(e: unknown): NextResponse {
  if (
    e instanceof RevenueLifecycleError ||
    e instanceof FxContractError ||
    e instanceof FinanceContractError
  ) {
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

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;

  const [list, rollup] = await Promise.all([
    listRevenueEntries(access.orgId, id),
    getProjectRevenueRollup(access.orgId, id),
  ]);
  return NextResponse.json({
    ...list,
    rollup: {
      available: rollup.available,
      contractRevenueCad: rollup.contractRevenueCad.toString(),
      approvedChangeOrdersCad: rollup.approvedChangeOrdersCad.toString(),
      adjustmentsCad: rollup.adjustmentsCad.toString(),
      forecastRevenueCad: rollup.forecastRevenueCad.toString(),
      recognizedRevenueCad: rollup.recognizedRevenueCad.toString(),
      entryCount: rollup.entryCount,
      unrecognizedEntryCount: rollup.unrecognizedEntryCount,
    },
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_WRITE);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const entry = await recordRevenueEntry({
      orgId: access.orgId,
      projectId: id,
      actor: serverActor(access.user.id),
      entryType: String(body.entryType ?? "CONTRACT_AWARD"),
      description: (body.description as string) ?? null,
      originalAmount: String(body.originalAmount ?? "0"),
      originalCurrency: String(body.originalCurrency ?? "CAD"),
      fxRateCadPerOriginalUnit: (body.fxRateCadPerOriginalUnit as string) ?? null,
      fxRateDate: body.fxRateDate ? new Date(String(body.fxRateDate)) : null,
      fxRateSource: (body.fxRateSource as never) ?? null,
      recognizedAt: body.recognizedAt ? new Date(String(body.recognizedAt)) : new Date(),
      asRecognized: body.asRecognized === true,
      changeOrderReference: (body.changeOrderReference as string) ?? null,
      // 变更单批准人恒为服务端已认证用户（AI 不得自动批准变更收入）
      approvedById: body.entryType === "CHANGE_ORDER" ? access.user.id : null,
      createdById: access.user.id,
    });
    return NextResponse.json({ ok: true, entry }, { status: 201 });
  } catch (e) {
    return revenueError(e);
  }
}
