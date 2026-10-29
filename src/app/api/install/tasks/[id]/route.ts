/**
 * GET /api/install/tasks/[id]
 * INSTALL-1：任务详情 + 每扇窗收口状态。不在可见范围 403；未关联工艺单 409。
 * INSTALL-2a：每个收口单元（Blinds 行 + 工艺参数四段）。
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
  serializeTaskDetail,
} from "@/lib/install/service";

export const GET = withAuth<{ id: string }>(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await loadInstallTask(id);
  if (!task) return installNotFound();

  const decision = await authorizeInstallTask(user, task, "install.task.read");
  if (!decision.allowed) return installForbidden();

  const order = await loadOrderForTask(task.id);
  if (!order) return installNoOrder();

  const closeout = await loadCloseoutSummary(order);
  return NextResponse.json({ task: serializeTaskDetail(task, order, closeout) });
});
