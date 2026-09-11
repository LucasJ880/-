import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { updateOffering } from "@/lib/supplier-intel/certification-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { assertSupplierAccessForActor } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string; offeringId: string }> };

/**
 * 更新可供产品的工作层字段。
 * 历史 Candidate 里的 offeringSnapshotJson 是按值快照，不会被这里改动影响（T11-C/D/E）。
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { supplierId, offeringId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    await assertSupplierAccessForActor(actor, supplierId);
    const patch: Record<string, unknown> = {};
    for (const key of [
      "name", "sku", "category", "description", "currency", "incoterm", "priceStatus", "sourceUrl",
    ]) {
      if (typeof body[key] === "string") patch[key] = body[key];
    }
    for (const key of ["moq", "leadTimeDays"]) {
      if (typeof body[key] === "number" || body[key] === null) patch[key] = body[key];
    }
    if (typeof body.unitPrice === "number" || typeof body.unitPrice === "string" || body.unitPrice === null) {
      patch.unitPrice = body.unitPrice;
    }
    const offering = await updateOffering(actor, offeringId, patch);
    return NextResponse.json({ offering });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
