import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveApproval } from "@/lib/agent/approval";

type Ctx = { params: Promise<{ taskId: string; stepId: string }> };

/**
 * POST /api/agent/tasks/:taskId/steps/:stepId/reject
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { taskId, stepId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const { note } = body as { note?: string };

  const approval = await db.approvalRequest.findFirst({
    where: { taskId, stepId, status: "pending" },
  });

  if (!approval) {
    return NextResponse.json({ error: "无待处理的审批请求" }, { status: 404 });
  }

  await resolveApproval({
    approvalId: approval.id,
    decision: "rejected",
    userId: user.id,
    note,
  });

  // 驳回后任务进入 rejected 状态
  await db.agentTask.update({
    where: { id: taskId },
    data: { status: "rejected" },
  });

  return NextResponse.json({ status: "rejected", stepId });
}
