import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canTransition, timestampField } from "@/lib/blinds/order-state-machine";
import { withAuth } from "@/lib/common/api-helpers";
import { authorize, humanPrincipal } from "@/lib/authorization";
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

  // 安排安装的校验（只读）放在锁外；预约与状态在锁内一起写
  let install: { customerId: string; startAt: Date; assignee: string } | null = null;
  if (toStatus === "scheduled") {
    // INSTALL-1：安排安装 = 建安装预约。执行者须持 install.task.assign（运营 / 会计 / 老板），
    // assignedToId 必须是持 install.task.read 的安装岗；工艺单必须有客户（预约靠 customer.orgId 定企业）。
    if (!order.customerId) {
      return NextResponse.json(
        { error: "工艺单未关联客户，无法安排安装（请先在工艺单上选择客户）", code: "NO_CUSTOMER" },
        { status: 400 },
      );
    }
    const customer = await db.salesCustomer.findUnique({
      where: { id: order.customerId },
      select: { id: true, orgId: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "工艺单关联的客户不存在", code: "NO_CUSTOMER" }, { status: 400 });
    }
    const startAt = installDate ? new Date(installDate) : null;
    if (!startAt || Number.isNaN(startAt.getTime())) {
      return NextResponse.json({ error: "请选择安装时间", code: "NO_INSTALL_DATE" }, { status: 400 });
    }
    const assignee = (assignedToId ?? "").trim();
    if (!assignee) {
      return NextResponse.json({ error: "必须选择安装岗位的人", code: "NO_INSTALLER" }, { status: 400 });
    }

    const canAssign = await authorize({
      principal: humanPrincipal(user, customer.orgId),
      orgId: customer.orgId,
      permission: "install.task.assign",
    });
    if (!canAssign.allowed) {
      return NextResponse.json({ error: "只有运营 / 会计 / 老板岗位可以安排安装" }, { status: 403 });
    }
    const assigneeCanRead = await authorize({
      principal: { type: "HUMAN", id: assignee, orgId: customer.orgId },
      orgId: customer.orgId,
      permission: "install.task.read",
    });
    if (!assigneeCanRead.allowed) {
      return NextResponse.json(
        { error: "必须选择安装岗位的人（所选用户不持安装任务权限）", code: "NOT_INSTALLER" },
        { status: 400 },
      );
    }
    install = { customerId: customer.id, startAt, assignee };
  }

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

    if (install) {
      const endAt = new Date(install.startAt.getTime() + 2 * 60 * 60 * 1000);
      const appt = await tx.appointment.create({
        data: {
          customerId: install.customerId,
          opportunityId: cur.opportunityId || null,
          type: "install",
          title: `安装 — ${cur.customerName} (${cur.code})`,
          description: `工单 ${cur.code} 安装排期`,
          startAt: install.startAt,
          endAt,
          address: cur.address || null,
          contactPhone: cur.phone || null,
          status: "scheduled",
          assignedToId: install.assignee,
          createdById: user.id,
        },
      });
      updateData.appointmentId = appt.id;
      updateData.expectedInstallDate = install.startAt;
      updateData.installDate = install.startAt.toISOString().slice(0, 10);
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

  return NextResponse.json({ order: result.updated });
});
