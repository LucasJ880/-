import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canTransition } from "@/lib/blinds/order-state-machine";
import { withAuth } from "@/lib/common/api-helpers";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { logAudit } from "@/lib/audit/logger";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { requestApproval } from "@/lib/approval/port";
import { listUsersWithPermission } from "@/lib/sales/approvers";
import { applyOrderTransition, isPlainTransition } from "@/lib/fulfillment/order-access";
import type { OrdersCancelBlindsOrderPayload } from "@/lib/pending-actions/types";
import { loadProcessSpec, lockOrderSpec, orderIssues } from "@/lib/sunny-process/autogen";
import { blockingIssues } from "@/lib/sunny-process/issues";
import { blindsOrderAccess } from "@/lib/sunny-process/server";

const CANCEL_ACTION_TYPE = "orders.cancel_blinds_order" as const;

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();
  const { toStatus, note, cancelReason } = body as {
    toStatus: string;
    note?: string;
    cancelReason?: string;
  };

  const order = await db.blindsOrder.findUnique({ where: { id } });
  // PERM-3：读范围 + 品类修改权（品类含 sunny-process 参数行）
  const access = order ? await blindsOrderAccess(id, user) : null;
  if (!order || !access?.canRead) {
    return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  }

  // ── 作废：持 orders.cancel 的老板提交 → 另一位老板批准（fulfillment/order-cancellation-approval）──
  if (toStatus === "cancelled") {
    if (order.status === "cancelled" || order.status === "completed") {
      return NextResponse.json({ error: `工艺单已${order.status === "cancelled" ? "作废" : "完工"}，不能作废`, code: "BAD_STATUS" }, { status: 409 });
    }
    if (!access.orgId) {
      return NextResponse.json({ error: "无法判定工艺单所属企业，不能作废" }, { status: 400 });
    }
    const orgId = access.orgId;
    const canCancel = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission: "orders.cancel" });
    if (!canCancel.allowed) {
      return NextResponse.json({ error: "只有老板岗位可以提交作废" }, { status: 403 });
    }
    const reason = (cancelReason || note || "").trim();

    if (isPlatformSuperAdmin(user.role)) {
      // 平台管理员直批（审计 selfApproved）
      await db.$transaction((tx) => applyOrderTransition(tx, order, "cancelled", user.id, reason || "平台管理员作废", { cancelReason: reason || null }));
      await logAudit({
        userId: user.id, orgId, action: "blinds_order_cancelled", targetType: "blinds_order", targetId: order.id,
        beforeData: { status: order.status },
        afterData: { status: "cancelled", reason, selfApproved: true, actorKind: "platform_admin" },
        request,
      });
      const updated = await db.blindsOrder.findUnique({ where: { id } });
      return NextResponse.json({ order: updated });
    }

    const holders = (await listUsersWithPermission(orgId, "orders.cancel")).filter((u) => u !== user.id);
    const payload: OrdersCancelBlindsOrderPayload = {
      orgId, requestedById: user.id, orderId: order.id, code: order.code, fromStatus: order.status, reason,
      resourceType: "blinds_order", resourceId: order.id, riskLevel: "CRITICAL",
      metadata: { orgId, targetType: "blinds_order", targetId: order.id },
    };
    const approval = await requestApproval({
      orgId,
      principal: { userId: user.id, actorType: "user" },
      actionType: CANCEL_ACTION_TYPE,
      title: `审批作废工艺单 ${order.code}`,
      preview: `${user.name || user.email} 申请作废工艺单 ${order.code}（当前 ${order.status}）${reason ? "：" + reason : ""}`,
      payload: payload as unknown as Record<string, unknown>,
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
      source: { module: "blinds-orders", toolName: "blinds_order_cancel", stepKey: `blinds-order-cancel:${order.id}` },
      approver: holders[0] ? { approverUserId: holders[0], requiredRole: "org_owner" } : { requiredRole: "org_owner" },
      ttlHours: 24 * 7,
      idempotencyKey: `blinds-order-cancel:${order.id}`,
      policyVersion: "blinds-order-cancel-v1",
      resourceVersion: order.status,
    });
    if (!approval.ok) {
      return NextResponse.json({ error: `生成审批失败：${approval.error}` }, { status: 500 });
    }
    const approvalId = approval.actionIds[0] ?? "";
    await logAudit({
      userId: user.id, orgId, action: "blinds_order_cancel_requested", targetType: "blinds_order", targetId: order.id,
      afterData: { reason, approvalId, approverCandidates: holders.length },
      request,
    });
    return NextResponse.json({ pending: true, approvalId, message: "作废申请已提交，等待另一位老板批准" }, { status: 202 });
  }

  if (toStatus !== "scheduled") {
    // 普通推进 / draft↔confirmed 退回：按品类修改权
    if (!isPlainTransition(order.status, toStatus)) {
      return NextResponse.json({ error: `不能从 ${order.status} 转到 ${toStatus}` }, { status: 400 });
    }
    if (!access.edit.allowed) {
      return NextResponse.json(
        { error: `无权推进本单：缺少品类 ${access.summary.missingCategories.join("、") || "（全品类）"} 的出单权限`, code: "FULFILLMENT_CATEGORY_FORBIDDEN", missingCategories: access.summary.missingCategories },
        { status: 403 },
      );
    }
  } else if (!canTransition(order.status, toStatus)) {
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
    const allowed = toStatus === "scheduled" ? canTransition(cur.status, toStatus) : isPlainTransition(cur.status, toStatus);
    if (!allowed) {
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

    const updateData: Record<string, unknown> = {};
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

    // design D7：状态 + 时间戳 + OrderStatusLog 统一由 applyOrderTransition 写
    await applyOrderTransition(tx, cur, toStatus, user.id, note || null, updateData);
    const updated = await tx.blindsOrder.findUnique({ where: { id } });
    return { ok: true as const, updated };
  });
  if (!result.ok) return result.res;

  return NextResponse.json({ order: result.updated });
});
