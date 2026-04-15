import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

/**
 * GET /api/agent/tasks/:taskId
 * 任务详情（含步骤 + 审批）
 */
export const GET = withAuth(async (_request, ctx) => {
  const { taskId } = await ctx.params;

  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { id: true, name: true } },
      steps: {
        orderBy: { stepIndex: "asc" },
        include: {
          approvalRequests: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      approvalRequests: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  return NextResponse.json({ task });
});

/**
 * PATCH /api/agent/tasks/:taskId
 * 更新任务（目前仅支持 pause/resume）
 */
export const PATCH = withAuth(async (request, ctx) => {
  const { taskId } = await ctx.params;
  const body = await request.json();
  const { action } = body as { action: "pause" | "resume" };

  if (action === "pause") {
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "paused" },
    });
    return NextResponse.json({ success: true, status: "paused" });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
});
