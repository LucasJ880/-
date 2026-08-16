/**
 * GET /api/projects/[id]/finance/summary — Budget vs Actual 只读模型
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess } from "@/lib/project-finance/access";
import { getBudgetVsActual } from "@/lib/project-finance/read-model";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  const summary = await getBudgetVsActual(access.orgId, id);
  return NextResponse.json({ summary });
}
