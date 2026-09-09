import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { loadProcurementView } from "@/lib/supplier-intel/procurement-view";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * S3-A 中文采购阅读视图（只读）。
 * 顺序不变量：flag 404-dark → 租户 → canonical 项目读门 → org 交叉校验 → 服务层再断言。
 * 这是 GET：只读取服务端已有事实，不创建 Run、不调 LLM、不发起任何外呼。
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== tenant.orgId) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  try {
    const view = await loadProcurementView({ orgId: tenant.orgId, userId: tenant.userId }, projectId);
    return NextResponse.json({ view });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
