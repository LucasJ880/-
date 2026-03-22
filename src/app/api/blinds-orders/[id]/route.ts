import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { calculateItem } from "@/lib/blinds/calculation-engine";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { getVisibleProjectIds } from "@/lib/projects/visibility";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;
  const order = await db.blindsOrder.findUnique({
    where: { id },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
      project: { select: { id: true, name: true, color: true } },
      creator: { select: { id: true, name: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  }

  if (order.projectId) {
    const visibleIds = await getVisibleProjectIds(user.id, user.role);
    if (visibleIds !== null && !visibleIds.includes(order.projectId)) {
      return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
    }
  }

  return NextResponse.json(order);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const existing = await db.blindsOrder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  }

  if (body.code && body.code !== existing.code) {
    const dup = await db.blindsOrder.findUnique({
      where: { code: body.code },
    });
    if (dup) {
      return NextResponse.json(
        { error: `订单号 ${body.code} 已被其他工艺单使用` },
        { status: 400 }
      );
    }
  }

  // Delete old items if new items provided
  if (body.items) {
    await db.blindsOrderItem.deleteMany({ where: { orderId: id } });
  }

  const items = body.items
    ? (body.items as Record<string, unknown>[]).map(
        (item: Record<string, unknown>, index: number) => {
          const input = {
            width: Number(item.width),
            height: Number(item.height),
            productType: String(item.productType),
            measureType: String(item.measureType),
            controlType: String(item.controlType),
            headrailType: String(item.headrailType),
            fabricRatio:
              item.fabricRatio != null ? Number(item.fabricRatio) : null,
            silkRatio: item.silkRatio != null ? Number(item.silkRatio) : null,
            bottomBarWidth:
              item.bottomBarWidth != null ? Number(item.bottomBarWidth) : null,
          };
          const calc = calculateItem(input);

          return {
            itemNumber: index + 1,
            location: String(item.location || ""),
            width: input.width,
            height: input.height,
            fabricSku: String(item.fabricSku || ""),
            productType: input.productType,
            measureType: input.measureType,
            controlType: input.controlType,
            controlSide: String(item.controlSide || "R"),
            headrailType: input.headrailType,
            mountType: String(item.mountType || "顶装"),
            fabricRatio: input.fabricRatio,
            silkRatio: input.silkRatio,
            bottomBarWidth: input.bottomBarWidth,
            itemRemark: item.itemRemark ? String(item.itemRemark) : null,
            cutHeadrail: calc.cutHeadrail,
            cutTube38: calc.cutTube38,
            cutRollerBar: calc.cutRollerBar,
            cutZebraBar: calc.cutZebraBar,
            cutCoreRod: calc.cutCoreRod,
            cutShangrilaBar: calc.cutShangrilaBar,
            cutFabricWidth: calc.cutFabricWidth,
            cutFabricLength: calc.cutFabricLength,
            insertSize: calc.insertSize,
            cordLength: calc.cordLength,
            cordSleeveLen: calc.cordSleeveLen,
            squareFeet: calc.squareFeet,
            sortOrder: calc.sortOrder,
          };
        }
      )
    : undefined;

  const order = await db.blindsOrder.update({
    where: { id },
    data: {
      ...(body.code !== undefined && { code: body.code }),
      ...(body.customerName !== undefined && {
        customerName: body.customerName,
      }),
      ...(body.phone !== undefined && { phone: body.phone || null }),
      ...(body.address !== undefined && { address: body.address || null }),
      ...(body.installDate !== undefined && {
        installDate: body.installDate || null,
      }),
      ...(body.remarks !== undefined && { remarks: body.remarks || null }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.projectId !== undefined && {
        projectId: body.projectId || null,
      }),
      ruleVersion: RULE_VERSION,
      ...(items && { items: { create: items } }),
    },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
      project: { select: { id: true, name: true, color: true } },
    },
  });

  return NextResponse.json(order);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;
  await db.blindsOrder.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
