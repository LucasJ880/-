import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { approveApprovalItem } from "@/lib/approval/port";

/**
 * POST /api/agent/tasks/:taskId/steps/:stepId/approve
 *
 * A-P3：审批决策统一走 ApprovalPort。
 * 安全（Security P0）：前置校验当前 principal 对任务所属项目至少有读权限
 * （租户隔离，防跨 org 凭 taskId+stepId 直接决策）；最终批准与否仍由
 * ApprovalPort 依 userId/role 判定，本 PR 不改变审批决策语义。
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
  const { note, acceptedWithRisk } = body as {
    note?: string;
    acceptedWithRisk?: boolean;
  };

  const approval = await db.approvalRequest.findFirst({
    where: { taskId, stepId, status: "pending" },
    select: { id: true },
  });

  if (!approval) {
    return NextResponse.json({ error: "无待处理的审批请求" }, { status: 404 });
  }

  const result = await approveApprovalItem("approval_request", approval.id, {
    userId: user.id,
    role: user.role,
    note,
    acceptedWithRisk,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "审批失败" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    status: result.status,
    reason: result.message,
    approved: true,
  });
});
