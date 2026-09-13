import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { loadSupplierCapabilityView } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string }> };

/** S3-B：一家供应商的能力/产品/资质聚合只读视图。GET 无任何写副作用。 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { supplierId } = await ctx.params;
  const url = new URL(request.url);
  try {
    // projectId / signalId / searchRunId 只是「从哪来、想看哪个」——是否属实由服务端核实，
    // 核实不过就当没传（不回错误、不泄露它们是否存在）
    const view = await loadSupplierCapabilityView(
      { orgId: tenant.orgId, userId: tenant.userId },
      supplierId,
      {
        projectId: url.searchParams.get("projectId"),
        signalId: url.searchParams.get("signalId"),
        searchRunId: url.searchParams.get("searchRunId"),
      },
    );
    return NextResponse.json({ view });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
