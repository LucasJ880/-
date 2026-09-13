import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { updateOffering } from "@/lib/supplier-intel/certification-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { assertSupplierAccessForActor } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string; offeringId: string }> };

/**
 * 更新可供产品的工作层字段。
 * 历史 Candidate 里的 offeringSnapshotJson 是按值快照，不会被这里改动影响（T11-C/D/E）。
 *
 * S3-B Slice 2：HTTP 面**必须**带 `expectedUpdatedAt`（读到时的版本号）。
 * 不带就 400——否则任何客户端都能绕开乐观并发，静默覆盖同事的改动。
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
    const expectedRaw = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";
    const expectedUpdatedAt = expectedRaw ? new Date(expectedRaw) : null;
    if (!expectedUpdatedAt || !Number.isFinite(expectedUpdatedAt.getTime())) {
      return NextResponse.json(
        { error: "缺少 expectedUpdatedAt（编辑必须基于你读到的那个版本）", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }
    // 该产品必须属于 URL 里这家供应商（防止借 A 的页面改 B 的产品）
    const { db } = await import("@/lib/db");
    const owned = await db.supplierOffering.findFirst({
      where: { id: offeringId, orgId: actor.orgId, supplierId },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "产品不存在" }, { status: 404 });
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
    if (body.attributes !== undefined && (body.attributes === null || typeof body.attributes === "object")) {
      patch.attributes = body.attributes;
    }
    const offering = await updateOffering(actor, offeringId, patch, { expectedUpdatedAt });
    return NextResponse.json({ offering });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
