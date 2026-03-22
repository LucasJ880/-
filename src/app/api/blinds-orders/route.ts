import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { calculateItem } from "@/lib/blinds/calculation-engine";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { getVisibleProjectIds } from "@/lib/projects/visibility";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const projectIds = await getVisibleProjectIds(user.id, user.role);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  if (projectIds !== null) {
    where.OR = [
      { projectId: { in: projectIds } },
      { projectId: null, creatorId: user.id },
    ];
  }

  const orders = await db.blindsOrder.findMany({
    where,
    include: {
      _count: { select: { items: true } },
      project: { select: { id: true, name: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (!body.code || !body.customerName) {
    return NextResponse.json(
      { error: "订单号和客户名称为必填项" },
      { status: 400 }
    );
  }

  const existing = await db.blindsOrder.findUnique({
    where: { code: body.code },
  });
  if (existing) {
    return NextResponse.json(
      { error: `订单号 ${body.code} 已存在` },
      { status: 400 }
    );
  }

  const items = (body.items || []).map(
    (item: Record<string, unknown>, index: number) => {
      const input = {
        width: Number(item.width),
        height: Number(item.height),
        productType: String(item.productType),
        measureType: String(item.measureType),
        controlType: String(item.controlType),
        headrailType: String(item.headrailType),
        fabricRatio: item.fabricRatio != null ? Number(item.fabricRatio) : null,
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
  );

  const order = await db.blindsOrder.create({
    data: {
      code: body.code,
      customerName: body.customerName,
      phone: body.phone || null,
      address: body.address || null,
      installDate: body.installDate || null,
      remarks: body.remarks || null,
      ruleVersion: RULE_VERSION,
      creatorId: user.id,
      projectId: body.projectId || null,
      items: { create: items },
    },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
      project: { select: { id: true, name: true, color: true } },
    },
  });

  return NextResponse.json(order, { status: 201 });
}
