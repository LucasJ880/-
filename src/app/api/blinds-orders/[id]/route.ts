import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calculateItem } from "@/lib/blinds/calculation-engine";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { withAuth } from "@/lib/common/api-helpers";
import { ORDER_ACCESS_SELECT, resolveOrderAccess, type OrderAccessRow } from "@/lib/fulfillment/service";

const notFound = () => NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
const forbiddenEdit = (access: Awaited<ReturnType<typeof resolveOrderAccess>>) =>
  NextResponse.json(
    {
      error:
        access.summary.missingCategories.length > 0
          ? `无权修改本单：缺少品类 ${access.summary.missingCategories.join("、")} 的出单权限`
          : "无权修改本单（需要全品类出单权限）",
      code: "FULFILLMENT_CATEGORY_FORBIDDEN",
      missingCategories: access.summary.missingCategories,
      categories: access.summary.categories,
      responsiblePositions: access.summary.responsiblePositions,
    },
    { status: 403 },
  );

export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const order = await db.blindsOrder.findUnique({
    where: { id },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
      project: { select: { id: true, name: true, color: true, orgId: true } },
      creator: { select: { id: true, name: true } },
      customer: { select: { orgId: true } },
    },
  });

  if (!order) return notFound();

  // PERM-3：读范围 = orders.fulfillment.read（全企业）或旧范围；跨企业统一 404
  const access = await resolveOrderAccess(user, order as unknown as OrderAccessRow);
  if (!access.canRead) return notFound();

  const { customer: _customer, ...rest } = order;
  void _customer;
  return NextResponse.json({
    ...rest,
    project: order.project ? { id: order.project.id, name: order.project.name, color: order.project.color } : null,
    access: access.summary,
  });
});

export const PUT = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();

  const existing = await db.blindsOrder.findUnique({
    where: { id },
    select: { ...ORDER_ACCESS_SELECT, code: true },
  });
  if (!existing) return notFound();

  // PERM-3：修改权按品类（缺品类 403 + 清单）；项目可见性仍是附加条件（不可见 → 404）
  const access = await resolveOrderAccess(user, existing as unknown as OrderAccessRow);
  if (!access.canRead) return notFound();
  if (!access.edit.allowed) return forbiddenEdit(access);

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
});

export const DELETE = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const existing = await db.blindsOrder.findUnique({ where: { id }, select: ORDER_ACCESS_SELECT });
  if (!existing) return notFound();
  const access = await resolveOrderAccess(user, existing as unknown as OrderAccessRow);
  if (!access.canRead) return notFound();
  if (!access.edit.allowed) return forbiddenEdit(access);
  await db.blindsOrder.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
