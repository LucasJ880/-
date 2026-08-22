import { NextRequest, NextResponse } from "next/server";
import { requireCostAccess } from "@/lib/project-finance/access";
import { ForecastError, setManualCostForecast } from "@/lib/project-finance/forecast-service";
import { getProjectFinancialPerformance } from "@/lib/project-finance/performance";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/** POST：人工完工预测 { expectedRemainingCostCad, note? }（COST_WRITE）→ 返回最新 Financial Performance */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_WRITE);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { expectedRemainingCostCad?: unknown; note?: unknown };
  const v = typeof body.expectedRemainingCostCad === "string" ? Number(body.expectedRemainingCostCad) : body.expectedRemainingCostCad;
  try {
    const result = await setManualCostForecast({ orgId: access.orgId, projectId: id, userId: access.user.id, expectedRemainingCostCad: typeof v === "number" ? v : NaN, note: typeof body.note === "string" ? body.note : null });
    const performance = await getProjectFinancialPerformance(access.orgId, id);
    return NextResponse.json({ forecast: result, performance });
  } catch (e) {
    if (e instanceof ForecastError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
