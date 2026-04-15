import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

/**
 * GET /api/agent/tasks/recent
 *
 * 获取当前用户最近的自动化任务（含 cron 触发的巡检任务）
 */
export const GET = withAuth(async (request, _ctx, user) => {
  const triggerType = request.nextUrl.searchParams.get("triggerType");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || "10"), 20);

  const tasks = await db.agentTask.findMany({
    where: {
      createdById: user.id,
      ...(triggerType ? { triggerType } : {}),
    },
    select: {
      id: true,
      taskType: true,
      triggerType: true,
      intent: true,
      status: true,
      currentStepIndex: true,
      totalSteps: true,
      createdAt: true,
      completedAt: true,
      project: { select: { id: true, name: true } },
      steps: {
        select: {
          id: true,
          title: true,
          status: true,
          outputSummary: true,
          checkReportJson: true,
        },
        orderBy: { stepIndex: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ tasks });
});
