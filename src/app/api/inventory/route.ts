import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";

/** PERM-3：库存权限（FabricInventory 为全局表，企业取用户当前企业；见 design D5） */
async function inventoryPermission(
  request: Request & { nextUrl: URL },
  user: Parameters<typeof humanPrincipal>[0],
  keys: string[],
): Promise<NextResponse | null> {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  for (const permission of keys) {
    const d = await authorize({ principal: humanPrincipal(user, orgRes.orgId), orgId: orgRes.orgId, permission });
    if (d.allowed) return null;
  }
  return NextResponse.json({ error: "无权限（需要库存岗位）" }, { status: 403 });
}

export const GET = withAuth(async (request, _ctx, user) => {
  const denied = await inventoryPermission(request, user, ["inventory.read", "inventory.manage"]);
  if (denied) return denied;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const productType = url.searchParams.get("productType");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (productType) where.productType = productType;

  const fabrics = await db.fabricInventory.findMany({
    where,
    orderBy: [{ status: "asc" }, { productType: "asc" }, { fabricName: "asc" }],
    take: 500,
  });

  return NextResponse.json({ fabrics });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const denied = await inventoryPermission(request, user, ["inventory.manage"]);
  if (denied) return denied;

  const body = await request.json();
  const { sku, productType, fabricName, color, supplier, totalYards, minYards, unitCost } = body;

  if (!sku || !productType || !fabricName) {
    return NextResponse.json({ error: "SKU、产品类型、面料名不能为空" }, { status: 400 });
  }

  const yards = parseFloat(totalYards) || 0;
  const fabric = await db.fabricInventory.create({
    data: {
      sku,
      productType,
      fabricName,
      color: color || null,
      supplier: supplier || null,
      totalYards: yards,
      minYards: parseFloat(minYards) || 10,
      unitCost: parseFloat(unitCost) || 0,
      status: yards <= 0 ? "out_of_stock" : yards <= (parseFloat(minYards) || 10) ? "low" : "in_stock",
    },
  });

  return NextResponse.json({ fabric }, { status: 201 });
});
