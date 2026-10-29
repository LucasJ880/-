/**
 * GET /api/install/tasks/[id]
 * INSTALL-1：任务详情 + 每扇窗收口状态。不在可见范围 403；未关联工艺单 409。
 * INSTALL-2a：每个收口单元（Blinds 行 + 工艺参数四段）。
 * INSTALL-2d：每单元状态（已收口 / 有问题 / 未处理）与问题内容；因提交维修单完成的任务带维修单摘要。
 * INSTALL-2e：返修预约只返回维修单各行对应的单元，并标明返修单号。
 * INSTALL-2f：未完成的任务带这次预约上已作废的维修单（单号、原因）；已作废的维修单不作为"这次的维修单"。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  authorizeInstallTask,
  installForbidden,
  installNoOrder,
  installNotFound,
  loadCloseoutSummary,
  loadInstallTask,
  loadOrderForTask,
  scopeCloseout,
  serializeTaskDetail,
} from "@/lib/install/service";
import { loadRepairForAppointment, loadTaskRepairScope, loadVoidedRepairForAppointment, repairSummaryOf } from "@/lib/install/repair-service";

export const GET = withAuth<{ id: string }>(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await loadInstallTask(id);
  if (!task) return installNotFound();

  const decision = await authorizeInstallTask(user, task, "install.task.read");
  if (!decision.allowed) return installForbidden();

  const order = await loadOrderForTask(task.id);
  if (!order) return installNoOrder();

  const [closeout, repair, ret, voided] = await Promise.all([
    loadCloseoutSummary(order),
    task.status === "completed" ? loadRepairForAppointment(order.id, task.id) : Promise.resolve(null),
    loadTaskRepairScope(order.id, task.id),
    task.status !== "completed" && task.status !== "cancelled" ? loadVoidedRepairForAppointment(order.id, task.id) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    task: serializeTaskDetail(
      task,
      order,
      scopeCloseout(closeout, ret),
      repair ? repairSummaryOf(repair) : null,
      ret ? { id: ret.id, repairNo: ret.repairNo } : null,
      voided,
    ),
  });
});
