import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { withAuth } from "@/lib/common/api-helpers";
import { itemCreateData, loadProcessSpec, orderIssues } from "@/lib/sunny-process/autogen";
import { blockingIssues } from "@/lib/sunny-process/issues";
import { canViewBlindsOrder, processOrderDb } from "@/lib/sunny-process/server";

export const GET = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
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
});

export const PUT = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();

  const existing = await db.blindsOrder.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      status: true,
      projectId: true,
      creatorId: true,
      customerId: true,
    },
  });
  // 可见性：管理员 / 创建人 / 项目可见 / 关联客户所在组织成员（自动生成的草稿要由工厂核对修改）
  if (!existing || !(await canViewBlindsOrder(existing, user))) {
    return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  }

  // 确认门禁（与 transition 路由同一规则）：详情页"确认工艺单"按钮走这里改状态
  if (existing.status === "draft" && body.status === "confirmed") {
    const current = await db.blindsOrder.findUnique({
      where: { id },
      include: { items: { orderBy: { itemNumber: "asc" } } },
    });
    const spec = await loadProcessSpec(processOrderDb, id);
    const pending = body.items ? { code: existing.code, items: body.items as unknown[] } : current!;
    const blocked = blockingIssues(orderIssues(pending, spec));
    if (blocked.length > 0) {
      return NextResponse.json(
        { error: `还有 ${blocked.length} 项阻断待核对，不能确认`, code: "PROCESS_ORDER_BLOCKED", issues: blocked },
        { status: 409 },
      );
    }
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

  if (body.items) {
    await db.blindsOrderItem.deleteMany({ where: { orderId: id } });
  }

  const items = body.items
    ? (body.items as Record<string, unknown>[]).map((item, index) => itemCreateData(item, index))
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
  const existing = await db.blindsOrder.findUnique({
    where: { id },
    select: { projectId: true, creatorId: true, customerId: true },
  });
  if (!existing || !(await canViewBlindsOrder(existing, user))) {
    return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  }
  await db.blindsOrder.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
