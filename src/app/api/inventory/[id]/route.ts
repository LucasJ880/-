import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "super_admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await params;
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
}
