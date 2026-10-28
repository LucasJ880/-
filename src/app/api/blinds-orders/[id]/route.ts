import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { withAuth } from "@/lib/common/api-helpers";
import { itemCreateData, loadProcessSpec, lockOrderSpec, orderIssues } from "@/lib/sunny-process/autogen";
import { blockingIssues } from "@/lib/sunny-process/issues";
import { blindsOrderAccess } from "@/lib/sunny-process/server";
import type { OrderAccess } from "@/lib/fulfillment/service";

const notFound = () => NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
const forbiddenEdit = (access: OrderAccess) =>
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
      project: { select: { id: true, name: true, color: true } },
      creator: { select: { id: true, name: true } },
    },
  });

  if (!order) return notFound();

  // PERM-3：读范围 = orders.fulfillment.read（全企业）或旧范围；跨企业统一 404（工单含客户电话地址）
  const access = await blindsOrderAccess(id, user);
  if (!access?.canRead) return notFound();

  return NextResponse.json({ ...order, access: access.summary });
});

export const PUT = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();

  const existing = await db.blindsOrder.findUnique({
    where: { id },
    select: { id: true, code: true, status: true },
  });
  if (!existing) return notFound();

  // PERM-3：修改权按品类（缺品类 403 + 清单）；不可读 → 404。自动生成的草稿由持对应品类键的出单岗核对修改
  const access = await blindsOrderAccess(id, user);
  if (!access?.canRead) return notFound();
  if (!access.edit.allowed) return forbiddenEdit(access);
  // 作废走审批、安排安装要 install.task.assign：都只能经 transition 路由，PUT 不能绕过
  if ((body.status === "cancelled" || body.status === "scheduled") && body.status !== existing.status) {
    return NextResponse.json(
      { error: body.status === "cancelled" ? "作废需走审批（使用\"作废\"操作）" : "安排安装请使用\"安排安装\"操作", code: "USE_TRANSITION" },
      { status: 409 },
    );
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

  const items = body.items
    ? (body.items as Record<string, unknown>[]).map((item, index) => itemCreateData(item, index))
    : undefined;

  // 与保存工艺参数 / 发给国内同一把锁：门禁判定、版本校验与改写在同一事务里串行
  const result = await db.$transaction(async (tx) => {
    await lockOrderSpec(tx, id);
    const current = await tx.blindsOrder.findUnique({
      where: { id },
      include: { items: { orderBy: { itemNumber: "asc" } } },
    });
    if (!current) return { ok: false as const, res: NextResponse.json({ error: "工艺单不存在" }, { status: 404 }) };

    // 编辑页带着打开时的 updatedAt：期间有人「发给国内 / 退回自产」或另存过，拒绝整表覆盖，
    // 否则已挪到国内下单表的行会被旧的自产行写回来（同一窗做两次）
    if (body.items && typeof body.baseUpdatedAt === "string" && new Date(body.baseUpdatedAt).getTime() !== current.updatedAt.getTime()) {
      return { ok: false as const, res: NextResponse.json({ error: "工艺单已被他人修改（如发给国内 / 退回自产），请刷新后再改", code: "ORDER_STALE" }, { status: 409 }) };
    }

    // 确认门禁（与 transition 路由同一规则）：详情页"确认工艺单"按钮走这里改状态。
    // 从草稿 / 已取消 改到任何"进入生产链"的状态（confirmed / in_production / completed …）都要过门禁，
    // 防止 PUT {status:"in_production"} 之类绕过
    const leavesDraft =
      body.status !== undefined &&
      body.status !== current.status &&
      (current.status === "draft" || current.status === "cancelled") &&
      body.status !== "draft" &&
      body.status !== "cancelled";
    if (leavesDraft) {
      const spec = await loadProcessSpec(tx, id);
      const pending = body.items ? { code: current.code, items: body.items as unknown[] } : current;
      const blocked = blockingIssues(orderIssues(pending, spec));
      if (blocked.length > 0) {
        return {
          ok: false as const,
          res: NextResponse.json(
            { error: `还有 ${blocked.length} 项阻断待核对，不能确认`, code: "PROCESS_ORDER_BLOCKED", issues: blocked },
            { status: 409 },
          ),
        };
      }
    }

    if (items) await tx.blindsOrderItem.deleteMany({ where: { orderId: id } });
    const order = await tx.blindsOrder.update({
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
    return { ok: true as const, order };
  });
  if (!result.ok) return result.res;
  const order = result.order;

  return NextResponse.json(order);
});

export const DELETE = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const access = await blindsOrderAccess(id, user);
  if (!access?.canRead) return notFound();
  if (!access.edit.allowed) return forbiddenEdit(access);
  await db.blindsOrder.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
