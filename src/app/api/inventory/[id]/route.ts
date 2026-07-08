import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";

export const PATCH = withAuth(async (request, ctx, user) => {
  if (user.role !== "admin" && user.role !== "super_admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json();
  const { adjustYards, type, reason } = body as {
    adjustYards?: number;
    type?: string;
    reason?: string;
  };

  const fabric = await db.fabricInventory.findUnique({ where: { id } });
  if (!fabric) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const updateData: Record<string, unknown> = {};

  if (body.minYards !== undefined) updateData.minYards = parseFloat(body.minYards);
  if (body.unitCost !== undefined) updateData.unitCost = parseFloat(body.unitCost);
  if (body.supplier !== undefined) updateData.supplier = body.supplier;
  if (body.notes !== undefined) updateData.notes = body.notes;

  // 基础信息编辑（SKU / 产品类型 / 面料名 / 颜色）
  if (typeof body.sku === "string") {
    const newSku = body.sku.trim();
    if (!newSku) {
      return NextResponse.json({ error: "SKU 不能为空" }, { status: 400 });
    }
    if (newSku.toLowerCase() !== fabric.sku.toLowerCase()) {
      const clash = await db.fabricInventory.findFirst({
        where: { sku: { equals: newSku, mode: "insensitive" }, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json({ error: `SKU "${newSku}" 已存在` }, { status: 409 });
      }
    }
    updateData.sku = newSku;
  }
  if (typeof body.productType === "string" && body.productType.trim()) {
    updateData.productType = body.productType.trim();
  }
  if (typeof body.fabricName === "string" && body.fabricName.trim()) {
    updateData.fabricName = body.fabricName.trim();
  }
  if (body.color !== undefined) {
    updateData.color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;
  }

  if (adjustYards !== undefined && adjustYards !== 0) {
    const newTotal = fabric.totalYards + adjustYards;
    const newAvailable = newTotal - fabric.reservedYards;
    updateData.totalYards = Math.max(0, newTotal);
    updateData.status =
      newAvailable <= 0 ? "out_of_stock" :
      newAvailable <= fabric.minYards ? "low" : "in_stock";

    if (adjustYards > 0) updateData.lastRestockAt = new Date();

    await db.fabricStockLog.create({
      data: {
        fabricId: id,
        type: type || (adjustYards > 0 ? "restock" : "adjust"),
        yards: adjustYards,
        reason: reason || null,
        operatorId: user.id,
      },
    });
  }

  const updated = await db.fabricInventory.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ fabric: updated });
});
