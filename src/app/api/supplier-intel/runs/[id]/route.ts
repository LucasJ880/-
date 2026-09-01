import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { getProjectSearchRun } from "@/lib/supplier-intel/project-run-service";

type Ctx = { params: Promise<{ id: string }> };

/** B3：Run 携带 requirement/brief/queries 快照——读取必须过 canonical 项目读权限 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  try {
    const run = await getProjectSearchRun({ orgId: tenant.orgId, userId: tenant.userId }, id);
    const access = await requireProjectReadAccess(request, run.projectId!);
    if (access instanceof NextResponse) return access;
    if (access.project.orgId !== tenant.orgId) {
      return NextResponse.json({ error: "搜索运行不存在" }, { status: 404 });
    }
    const [candidateCount, signalCount] = await Promise.all([
      db.supplierCandidate.count({ where: { orgId: tenant.orgId, searchRunId: run.id } }),
      db.supplierDiscoverySignal.count({ where: { orgId: tenant.orgId, searchRunId: run.id } }),
    ]);
    return NextResponse.json({ run, counts: { candidates: candidateCount, signals: signalCount } });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
