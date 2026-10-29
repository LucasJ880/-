/**
 * POST /api/install/tasks/[id]/complete
 * INSTALL-1：完成收口。
 * - 操作者须是被分配人或持 install.task.update（ORG）
 * - 任一窗无照片 → 409 + 未收口清单（序号 / 位置）
 * - 全部有照片 → 预约 completed（completedAt）+ 工艺单按状态机转 installed（installedAt + OrderStatusLog）
 *   + 审计 install.task.completed（窗数 / 照片张数）
 * - 预约已 completed → 200 幂等；工艺单不在可推进状态 → 409
 * INSTALL-2a：按收口单元（Blinds 行 + 工艺参数四段）判定；零单元 → 409 NO_UNITS（需出单补齐）
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { logAudit } from "@/lib/audit/logger";
import { canTransition, timestampField } from "@/lib/blinds/order-state-machine";
import { INSTALL_TASK_COMPLETED, missingWindows } from "@/lib/install/closeout";
import {
  authorizeInstallTask,
  installForbidden,
  installNoOrder,
  installNotFound,
  loadCloseoutSummary,
  loadInstallTask,
  loadOrderForTask,
} from "@/lib/install/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await loadInstallTask(id);
  if (!task) return installNotFound();

  const decision = await authorizeInstallTask(user, task, "install.task.update");
  if (!decision.allowed) return installForbidden();

  if (task.status === "completed") {
    return NextResponse.json({ ok: true, idempotent: true, status: "completed" });
  }
  if (task.status === "cancelled") {
    return NextResponse.json({ error: "任务已取消", code: "BAD_STATUS" }, { status: 409 });
  }

  const order = await loadOrderForTask(task.id);
  if (!order) return installNoOrder();

  const { summary } = await loadCloseoutSummary(order);
  if (summary.total === 0) {
    return NextResponse.json(
      { error: "工艺单没有可收口的行，请联系出单补齐", code: "NO_UNITS", completed: 0, total: 0 },
      { status: 409 },
    );
  }
  if (!summary.allCompleted) {
    return NextResponse.json(
      {
        error: "还有窗户没有拍照收口",
        code: "WINDOWS_MISSING",
        missing: missingWindows(summary),
        completed: summary.completed,
        total: summary.total,
      },
      { status: 409 },
    );
  }

  // 工艺单：已 installed / completed 时不再推进；其余必须能转 installed
  const advanceOrder = order.status !== "installed" && order.status !== "completed";
  if (advanceOrder && !canTransition(order.status, "installed")) {
    return NextResponse.json(
      { error: `工艺单状态 ${order.status} 不允许收口`, code: "ORDER_STATUS" },
      { status: 409 },
    );
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: task.id },
      data: { status: "completed", completedAt: now },
    });
    if (advanceOrder) {
      const ts = timestampField("installed");
      await tx.blindsOrder.update({
        where: { id: order.id },
        data: { status: "installed", ...(ts ? { [ts]: now } : {}) },
      });
      await tx.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: "installed",
          note: `安装收口完成（${summary.total} 项）`,
          operatorId: user.id,
        },
      });
    }
  });

  const photoCount = summary.windows.reduce((s, w) => s + w.photoCount, 0);
  await logAudit({
    userId: user.id,
    orgId: task.customer.orgId,
    action: INSTALL_TASK_COMPLETED,
    targetType: "appointment",
    targetId: task.id,
    beforeData: { appointmentStatus: task.status, orderStatus: order.status },
    afterData: {
      appointmentStatus: "completed",
      orderId: order.id,
      orderStatus: advanceOrder ? "installed" : order.status,
      windows: summary.total,
      photoCount,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    status: "completed",
    order: { id: order.id, status: advanceOrder ? "installed" : order.status },
    windows: summary.total,
    photoCount,
  });
});
