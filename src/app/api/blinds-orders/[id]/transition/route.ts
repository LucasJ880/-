import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canTransition, timestampField } from "@/lib/blinds/order-state-machine";
import { withAuth } from "@/lib/common/api-helpers";
import { loadProcessSpec, lockOrderSpec, orderIssues } from "@/lib/sunny-process/autogen";
import { blockingIssues } from "@/lib/sunny-process/issues";
import { canViewBlindsOrder } from "@/lib/sunny-process/server";

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

  const { installDate, assignedToId } = body as {
    toStatus: string;
    note?: string;
    cancelReason?: string;
    installDate?: string;
    assignedToId?: string;
  };

  // 与保存工艺参数 / 发给国内同一把锁：锁内重读状态与行再做门禁，避免确认与挪行交错
  const result = await db.$transaction(async (tx) => {
    await lockOrderSpec(tx, id);
    const cur = await tx.blindsOrder.findUnique({ where: { id }, include: { items: { orderBy: { itemNumber: "asc" } } } });
    if (!cur) return { ok: false as const, res: NextResponse.json({ error: "工单不存在" }, { status: 404 }) };
    if (!canTransition(cur.status, toStatus)) {
      return { ok: false as const, res: NextResponse.json({ error: `不能从 ${cur.status} 转到 ${toStatus}` }, { status: 400 }) };
    }

    // 确认门禁：草稿 → 已确认 前，阻断级待核对项必须清零
    if (cur.status === "draft" && toStatus === "confirmed") {
      const spec = await loadProcessSpec(tx, id);
      const blocked = blockingIssues(orderIssues(cur, spec));
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

    const updateData: Record<string, unknown> = { status: toStatus };
    const tsField = timestampField(toStatus);
    if (tsField) updateData[tsField] = new Date();
    if (toStatus === "cancelled" && cancelReason) {
      updateData.cancelReason = cancelReason;
    }

    if (toStatus === "scheduled" && installDate) {
      const startAt = new Date(installDate);
      const endAt = new Date(startAt.getTime() + 2 * 60 * 60 * 1000);
      const appt = await tx.appointment.create({
        data: {
          customerId: cur.customerId || "",
          opportunityId: cur.opportunityId || null,
          type: "install",
          title: `安装 — ${cur.customerName} (${cur.code})`,
          description: `工单 ${cur.code} 安装排期`,
          startAt,
          endAt,
          address: cur.address || null,
          contactPhone: cur.phone || null,
          status: "scheduled",
          assignedToId: assignedToId || user.id,
          createdById: user.id,
        },
      });
      updateData.appointmentId = appt.id;
      updateData.expectedInstallDate = startAt;
    }

    const updated = await tx.blindsOrder.update({
      where: { id },
      data: updateData,
    });

    await tx.orderStatusLog.create({
      data: {
        orderId: id,
        fromStatus: cur.status,
        toStatus,
        note: note || cancelReason || null,
        operatorId: user.id,
      },
    });
    return { ok: true as const, updated };
  });
  if (!result.ok) return result.res;
  const updated = result.updated;

  return NextResponse.json({ order: updated });
});
