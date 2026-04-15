import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (request) => {
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
  if (user.role !== "admin" && user.role !== "super_admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

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
