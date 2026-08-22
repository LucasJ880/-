import { NextRequest, NextResponse } from "next/server";
import { requireCostAccess } from "@/lib/project-finance/access";
import { getProjectFinancialPerformance } from "@/lib/project-finance/performance";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { analyzeQuoteOperations } from "@/lib/quote-engine/analyze-operations";
import { db } from "@/lib/db";

/** GET：Financial Performance（Budget vs Actual / 合同价值 / 预测 / 利润 / 告警 / 溯源）+ advisory 分析（COST_READ） */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  const performance = await getProjectFinancialPerformance(access.orgId, id);
  // 供应商集中度（advisory 输入）：awarded/选中报价的直接成本按供应商名聚合；客户视图绝不暴露
  let supplierShares: Array<{ supplierName: string; sharePct: number }> = [];
  if (performance.quote) {
    const lines = await db.quoteCostLine.findMany({ where: { quoteId: performance.quote.quoteId, included: true, calculationType: { in: ["FIXED", "PER_UNIT", "PER_HOUR", "PER_DAY", "PER_MONTH", "PER_TRIP", "PER_CONTAINER"] } }, select: { supplierName: true, calculatedCost: true } });
    const total = lines.reduce((s, l) => s + Number(l.calculatedCost ?? 0), 0);
    if (total > 0) {
      const by = new Map<string, number>();
      for (const l of lines) if (l.supplierName) by.set(l.supplierName, (by.get(l.supplierName) ?? 0) + Number(l.calculatedCost ?? 0));
      supplierShares = [...by.entries()].map(([supplierName, amt]) => ({ supplierName, sharePct: Math.round((amt / total) * 1000) / 10 }));
    }
  }
  return NextResponse.json({ performance, analysis: analyzeQuoteOperations(performance, { supplierShares }) });
}
