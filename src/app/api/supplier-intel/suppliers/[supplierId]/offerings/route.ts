import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { createOffering } from "@/lib/supplier-intel/certification-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { assertSupplierAccessForActor } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string }> };

/**
 * 新建可供产品（Supplier ≠ Product）。
 *
 * 缺价是合法状态：不传 unitPrice / priceStatus=UNKNOWN 不构成拒绝理由。
 * sourceKind 固定为 MANUAL——这个入口是人手工录入的；DISCOVERY 来源由发现流程自己写，
 * 不允许客户端自称「这是搜出来的」。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { supplierId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    await assertSupplierAccessForActor(actor, supplierId);
    const offering = await createOffering(actor, {
      supplierId,
      name: typeof body.name === "string" ? body.name : "",
      sku: typeof body.sku === "string" ? body.sku : null,
      category: typeof body.category === "string" ? body.category : null,
      description: typeof body.description === "string" ? body.description : null,
      unitPrice:
        typeof body.unitPrice === "number" || typeof body.unitPrice === "string"
          ? body.unitPrice
          : null,
      currency: typeof body.currency === "string" ? body.currency : null,
      moq: typeof body.moq === "number" ? body.moq : null,
      leadTimeDays: typeof body.leadTimeDays === "number" ? body.leadTimeDays : null,
      incoterm: typeof body.incoterm === "string" ? body.incoterm : null,
      priceStatus: typeof body.priceStatus === "string" ? body.priceStatus : "UNKNOWN",
      // 人工录入入口：来源固定，不由客户端声明
      sourceKind: "MANUAL",
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      sourceSignalId: typeof body.sourceSignalId === "string" ? body.sourceSignalId : null,
    });
    return NextResponse.json({ offering }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
