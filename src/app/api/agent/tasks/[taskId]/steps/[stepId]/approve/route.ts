import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveApproval } from "@/lib/agent/approval";
import { resumeAfterApproval } from "@/lib/agent/executor";

/**
 * POST /api/agent/tasks/:taskId/steps/:stepId/approve
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
  });

  if (!approval) {
    return NextResponse.json({ error: "无待处理的审批请求" }, { status: 404 });
  }

  await resolveApproval({
    approvalId: approval.id,
    decision: "approved",
    userId: user.id,
    note,
    acceptedWithRisk,
  });

  // 审批通过后自动恢复执行
  const result = await resumeAfterApproval(taskId);
  return NextResponse.json({ ...result, approved: true });
});
