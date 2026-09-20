import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { loadEvaluationView } from "@/lib/supplier-intel/evaluation-run-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { getProjectSearchRun } from "@/lib/supplier-intel/project-run-service";

type Ctx = { params: Promise<{ id: string }> };

/** S4-A：评估运行视图（只读，无写副作用）。项目读权限。 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { id } = await ctx.params;
  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    const run = await getProjectSearchRun(actor, id);
    const access = await requireProjectReadAccess(request, run.projectId!);
    if (access instanceof NextResponse) return access;
    if (access.project.orgId !== tenant.orgId) return NextResponse.json({ error: "评估运行不存在" }, { status: 404 });
    const view = await loadEvaluationView(actor, id);
    return NextResponse.json({ view });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
