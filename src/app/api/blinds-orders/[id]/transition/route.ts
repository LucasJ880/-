import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canTransition, timestampField } from "@/lib/blinds/order-state-machine";
import { withAuth } from "@/lib/common/api-helpers";
import { loadProcessSpec, orderIssues } from "@/lib/sunny-process/autogen";
import { blockingIssues } from "@/lib/sunny-process/issues";
import { canViewBlindsOrder, processOrderDb } from "@/lib/sunny-process/server";

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();
  const { toStatus, note, cancelReason } = body as {
    toStatus: string;
    note?: string;
    cancelReason?: string;
  };

  const order = await db.blindsOrder.findUnique({ where: { id }, include: { items: { orderBy: { itemNumber: "asc" } } } });
  if (!order || !(await canViewBlindsOrder(order, user))) {
    return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  }

  if (!canTransition(order.status, toStatus)) {
    return NextResponse.json(
      { error: `不能从 ${order.status} 转到 ${toStatus}` },
      { status: 400 },
    );
  }

  // 确认门禁：草稿 → 已确认 前，阻断级待核对项必须清零
  if (order.status === "draft" && toStatus === "confirmed") {
    const spec = await loadProcessSpec(processOrderDb, id);
    const blocked = blockingIssues(orderIssues(order, spec));
    if (blocked.length > 0) {
      return NextResponse.json(
        { error: `还有 ${blocked.length} 项阻断待核对，不能确认`, code: "PROCESS_ORDER_BLOCKED", issues: blocked },
        { status: 409 },
      );
    }
  }

  const { installDate, assignedToId } = body as {
    toStatus: string;
    note?: string;
    cancelReason?: string;
    installDate?: string;
    assignedToId?: string;
  };

  const updateData: Record<string, unknown> = { status: toStatus };
  const tsField = timestampField(toStatus);
  if (tsField) updateData[tsField] = new Date();
  if (toStatus === "cancelled" && cancelReason) {
    updateData.cancelReason = cancelReason;
  }

  if (toStatus === "scheduled" && installDate) {
    const startAt = new Date(installDate);
    const endAt = new Date(startAt.getTime() + 2 * 60 * 60 * 1000);
    const appt = await db.appointment.create({
      data: {
        customerId: order.customerId || "",
        opportunityId: order.opportunityId || null,
        type: "install",
        title: `安装 — ${order.customerName} (${order.code})`,
        description: `工单 ${order.code} 安装排期`,
        startAt,
        endAt,
        address: order.address || null,
        contactPhone: order.phone || null,
        status: "scheduled",
        assignedToId: assignedToId || user.id,
        createdById: user.id,
      },
    });
    updateData.appointmentId = appt.id;
    updateData.expectedInstallDate = startAt;
  }

  const updated = await db.blindsOrder.update({
    where: { id },
    data: updateData,
  });

  await db.orderStatusLog.create({
    data: {
      orderId: id,
      fromStatus: order.status,
      toStatus,
      note: note || cancelReason || null,
      operatorId: user.id,
    },
  });

  return NextResponse.json({ order: updated });
});
