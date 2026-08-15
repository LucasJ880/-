/**
 * PATCH /api/projects/[id]/finance/revenue/[entryId] — { action: "realize" | "void" }
 *
 * realize：FORECAST → REALIZED（开票 / 收款确认；填充 amountRealizedCad，不覆盖 forecast 列）
 * void   ：作废（可带 correction 新行；镜像 ProjectCost 的 void + correction）
 * 没有「改金额」动作 —— REALIZED 后实质字段不可原地改。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  FinanceContractError,
  FinanceTenantError,
  FxContractError,
  RevenueLifecycleError,
  realizeRevenueEntry,
  voidRevenueEntry,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id, entryId } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_WRITE);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const actor = serverActor(access.user.id);

  try {
    switch (action) {
      case "realize": {
        const r = await realizeRevenueEntry({
          orgId: access.orgId,
          projectId: id,
          entryId,
          actor,
          realizedById: access.user.id,
          amountRealizedCad: (body.amountRealizedCad as string) ?? null,
          realizedAt: body.realizedAt ? new Date(String(body.realizedAt)) : null,
        });
        return NextResponse.json({ ok: true, entry: r.entry, realized: r.realized });
      }
      case "void": {
        const r = await voidRevenueEntry({
          orgId: access.orgId,
          projectId: id,
          entryId,
          actor,
          voidedById: access.user.id,
          reason: String(body.reason ?? ""),
        });
        return NextResponse.json({ ok: true, entry: r.voided });
      }
      default:
        return NextResponse.json(
          { error: `未知 action: ${action}（支持 realize | void）` },
          { status: 400 },
        );
    }
  } catch (e) {
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
      return NextResponse.json({ error: "收入条目不存在", code: e.code }, { status: 404 });
    }
    throw e;
  }
}
