import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { approveApprovalItem } from "@/lib/approval/port";

/**
 * POST /api/agent/tasks/:taskId/steps/:stepId/approve
 *
 * A-P3：审批决策统一走 ApprovalPort。
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { taskId, stepId } = await ctx.params;
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
