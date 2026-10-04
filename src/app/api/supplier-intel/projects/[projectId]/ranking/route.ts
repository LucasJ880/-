import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { loadProjectSupplierRanking } from "@/lib/supplier-intel/project-supplier-ranking";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * S4-B：项目级当前推荐 + 供应商赛马（只读 read-model）。GET 不写任何东西：
 * PRIMARY / BACKUP 每次动态派生，历史候选不被改写。顺序：flag → 租户 → 项目读权限 → org 交叉校验。
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== tenant.orgId) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  try {
    const view = await loadProjectSupplierRanking({ orgId: tenant.orgId, userId: tenant.userId }, projectId);
    return NextResponse.json({ view });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
