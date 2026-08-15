/**
 * GET /api/projects/[id]/finance/tender-summary — 单个 Tender 的完整财务全景
 *
 * 投标成本 / 交付成本 / 总成本 / 合同收入 / 已批变更 / 预测收入 / 已实现收入 /
 * 预测利润 / 最终利润（含资格与 blockers）/ 未结应付 / 落标复盘状态。
 * 全部 server-side 从权威模型计算；前端零遍历、零金额推算。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess } from "@/lib/project-finance/access";
import { FinanceTenantError, getTenderFinancialSummary } from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  try {
    return NextResponse.json(await getTenderFinancialSummary(access.orgId, id));
  } catch (e) {
    if (e instanceof FinanceTenantError) {
      return NextResponse.json({ error: "项目不存在", code: e.code }, { status: 404 });
    }
    throw e;
  }
}
