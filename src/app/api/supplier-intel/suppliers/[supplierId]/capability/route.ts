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
  try {
    const view = await loadSupplierCapabilityView(
      { orgId: tenant.orgId, userId: tenant.userId },
      supplierId,
    );
    return NextResponse.json({ view });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
