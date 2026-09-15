import { NextResponse, type NextRequest } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { completeEvaluationRun } from "@/lib/supplier-intel/evaluation-run-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { getProjectSearchRun } from "@/lib/supplier-intel/project-run-service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * S4-A：收口评估运行。只有全部候选的硬门都已计算才能 COMPLETED；
 * 之后候选 / Match / 门全部不可变，改判 = 新建评估运行。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { id } = await ctx.params;
  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    const run = await getProjectSearchRun(actor, id);
    const access = await requireProjectWriteAccess(request, run.projectId!);
    if (access instanceof NextResponse) return access;
    if (access.project.orgId !== tenant.orgId) return NextResponse.json({ error: "评估运行不存在" }, { status: 404 });
    const completed = await completeEvaluationRun(actor, id);
    return NextResponse.json({ run: { id: completed.id, status: completed.status, completedAt: completed.completedAt } });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
