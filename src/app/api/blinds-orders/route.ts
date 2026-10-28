import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calculateItem } from "@/lib/blinds/calculation-engine";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { withAuth } from "@/lib/common/api-helpers";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { orgWideOrderFilter } from "@/lib/fulfillment/service";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";

/**
 * GET /api/blinds-orders?status&orgId
 * PERM-3：持 orders.fulfillment.read（ORG）→ 全企业工艺单；否则旧范围（可见项目 + 本人创建 + 无项目时关联客户所在组织）。
 */
export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  // 企业解析失败（多企业未指定 orgId）→ 走旧范围，不报错
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  const orgWide = orgRes.ok ? await orgWideOrderFilter(user, orgRes.orgId) : null;

  if (orgWide) {
    Object.assign(where, orgWide.where);
  } else if (!isPlatformSuperAdmin(user.role)) {
    const projectIds = await getVisibleProjectIds(user.id, user.role);
    if (projectIds !== null) {
      // 自动生成的工艺单无项目、创建人是销售：同组织（经关联客户）的成员也要能在列表里看到（工厂核对）
      const memberOrgIds = (
        await db.organizationMember.findMany({
          where: { userId: user.id, status: "active" },
          select: { orgId: true },
        })
      ).map((m) => m.orgId);
      where.OR = [
        { projectId: { in: projectIds } },
        { projectId: null, creatorId: user.id },
        ...(memberOrgIds.length > 0 ? [{ projectId: null, customer: { orgId: { in: memberOrgIds } } }] : []),
      ];
    }
  }

  const rows = await db.blindsOrder.findMany({
    where,
    include: {
      _count: { select: { items: true } },
      project: { select: { id: true, name: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  let orders = rows;
  if (orgWide) {
    const drop = await orgWide.postFilter(rows);
    if (drop.size) {
      orders = rows.filter((r) => !( !r.customerId && !r.projectId && drop.has(r.creatorId) ));
    }
  }

  return NextResponse.json(orders);
});

/** POST /api/blinds-orders — PERM-3：要求 sales.order.create（任一范围） */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();

  if (!body.code || !body.customerName) {
    return NextResponse.json(
      { error: "订单号和客户名称为必填项" },
      { status: 400 }
    );
  }

  const orgRes = await resolveRequestOrgIdForUser(user, typeof body.orgId === "string" ? body.orgId : null);
  if (!orgRes.ok) return orgRes.response;
  const canCreate = await authorize({
    principal: humanPrincipal(user, orgRes.orgId),
    orgId: orgRes.orgId,
    permission: "sales.order.create",
  });
  if (!canCreate.allowed) {
    return NextResponse.json({ error: "无权创建工艺单（需要销售 / 老板岗位）" }, { status: 403 });
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
});
