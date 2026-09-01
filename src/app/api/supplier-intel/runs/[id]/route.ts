import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { getSearchRun } from "@/lib/supplier-intel/run-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const run = await getSearchRun({ orgId: tenant.orgId, userId: tenant.userId }, id);
  if (!run) return NextResponse.json({ error: "搜索运行不存在" }, { status: 404 });

  const [candidateCount, signalCount] = await Promise.all([
    db.supplierCandidate.count({ where: { orgId: tenant.orgId, searchRunId: run.id } }),
    db.supplierDiscoverySignal.count({ where: { orgId: tenant.orgId, searchRunId: run.id } }),
  ]);
  return NextResponse.json({ run, counts: { candidates: candidateCount, signals: signalCount } });
}
