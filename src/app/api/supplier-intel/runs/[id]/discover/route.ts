import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { executeSupplierSearchRun } from "@/lib/supplier-intel/discovery-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { getSearchRun, startSearchRun } from "@/lib/supplier-intel/run-service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const actor = { orgId: tenant.orgId, userId: tenant.userId };

  try {
    const run = await getSearchRun(actor, id);
    if (!run) return NextResponse.json({ error: "搜索运行不存在" }, { status: 404 });
    if (run.status === "PLANNED") {
      await startSearchRun(actor, id); // PLANNED → RUNNING（审计 run.started）
    }
    // §21/§44：执行发现并按确定性策略收口（S4 组合编排可传 finalize:false 保持 RUNNING）
    const result = await executeSupplierSearchRun(actor, id, {
      includeInternalPool: body?.includeInternalPool !== false,
      internalPoolLimit:
        typeof body?.internalPoolLimit === "number" ? body.internalPoolLimit : undefined,
      finalize: body?.finalize !== false,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
