import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { verifyCapabilitySignal } from "@/lib/supplier-intel/capability-verification-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { assertSupplierAccessForActor } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string; capabilityId: string }> };

/**
 * S4-B：人工核验能力证据（唯一 VERIFIED 写路径）。必须带 archiveItemId（独立档案证据）。
 * 能力必须挂在**已归属到 URL 里这家供应商**的线索上——防止借 A 的页面核验 B 的能力。
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { supplierId, capabilityId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.action !== "verify") return NextResponse.json({ error: "action 只支持 verify" }, { status: 400 });
  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    await assertSupplierAccessForActor(actor, supplierId);
    const owned = await db.supplierCapabilitySignal.findFirst({
      where: { id: capabilityId, orgId: actor.orgId, discoverySignal: { is: { linkedSupplierId: supplierId, status: "LINKED" } } },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "能力记录不存在" }, { status: 404 });
    const capability = await verifyCapabilitySignal(actor, capabilityId, {
      archiveItemId: typeof body.archiveItemId === "string" ? body.archiveItemId : "",
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json({ capability });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
