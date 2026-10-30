/**
 * POST /api/install/tasks/[id]/start
 * INSTALL-1：被分配人（或持 install.task.update ORG）把任务 scheduled/confirmed → in_progress；审计 install.task.started。
 * 已是 in_progress → 200 幂等；已完成 / 取消 → 409。
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { logAudit } from "@/lib/audit/logger";
import { INSTALL_TASK_STARTED } from "@/lib/install/closeout";
import {
  authorizeInstallTask,
  installForbidden,
  installNotFound,
  loadInstallTask,
} from "@/lib/install/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await loadInstallTask(id);
  if (!task) return installNotFound();

  const decision = await authorizeInstallTask(user, task, "install.task.update");
  if (!decision.allowed) return installForbidden();

  if (task.status === "in_progress") {
    return NextResponse.json({ ok: true, status: task.status, idempotent: true });
  }
  if (task.status !== "scheduled" && task.status !== "confirmed") {
    return NextResponse.json(
      { error: `任务当前状态为 ${task.status}，不能开始安装`, code: "BAD_STATUS" },
      { status: 409 },
    );
  }

  const updated = await db.appointment.update({
    where: { id: task.id },
    data: { status: "in_progress" },
    select: { status: true },
  });

  await logAudit({
    userId: user.id,
    orgId: task.customer.orgId,
    action: INSTALL_TASK_STARTED,
    targetType: "appointment",
    targetId: task.id,
    beforeData: { status: task.status },
    afterData: { status: updated.status, scope: decision.matchedScope ?? null },
    request,
  });

  return NextResponse.json({ ok: true, status: updated.status });
});
