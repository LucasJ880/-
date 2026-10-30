/**
 * POST /api/install/tasks/[id]/repair  JSON { customerName, phone, notes, customerPreferredDate?, customerConfirmed? }
 * INSTALL-2d：提交维修单（spec installation/repairs「提交维修单的条件」「维修单内容」「提交维修单的效果」）。
 * - 被分配人或持 install.task.update（ORG），否则 403
 * - 还有未处理单元 → 409 UNITS_UNHANDLED（列出）；没有有问题的单元 → 409 NO_ISSUES；已收口完成 / 已取消 → 409
 * - 表头不合法 → 400；行由服务端按有问题单元生成
 * - 成功：维修单审计 + 预约 completed（install.task.completed outcome needs_repair），工艺单不动；站内通知
 * - 同一预约重复 / 并发提交 → 只一张，重复的返回 200 idempotent
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { submitRepair } from "@/lib/install/repair-service";
import {
  authorizeInstallTask,
  installForbidden,
  installNoOrder,
  installNotFound,
  loadInstallTask,
  loadOrderForTask,
} from "@/lib/install/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await loadInstallTask(id);
  if (!task) return installNotFound();

  const decision = await authorizeInstallTask(user, task, "install.task.update");
  if (!decision.allowed) return installForbidden();

  const order = await loadOrderForTask(task.id);
  if (!order) return installNoOrder();

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await submitRepair({ userId: user.id, task, order, body, request });
  return NextResponse.json(result.body, { status: result.status });
});
