import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { rejectApprovalItem } from "@/lib/approval/port";

/**
 * POST /api/agent/tasks/:taskId/steps/:stepId/reject
 *
 * A-P3：审批决策统一走 ApprovalPort。
 * 安全（Security P0）：前置校验当前 principal 对任务所属项目至少有读权限
 * （租户隔离）；驳回决策语义仍由 ApprovalPort 依 userId/role 判定。
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { taskId, stepId } = await ctx.params;

  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const access = await requireProjectReadAccess(request, task.projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  const { note } = body as { note?: string };

  const approval = await db.approvalRequest.findFirst({
    where: { taskId, stepId, status: "pending" },
    select: { id: true },
  });

  if (!approval) {
    return NextResponse.json({ error: "无待处理的审批请求" }, { status: 404 });
  }

  const result = await rejectApprovalItem("approval_request", approval.id, {
    userId: user.id,
    role: user.role,
    note,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "驳回失败" },
      { status: 400 },
    );
  }

  return NextResponse.json({ status: "rejected", stepId });
});
