import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/agent/tasks/recent
 *
 * 获取当前用户最近的自动化任务（含 cron 触发的巡检任务）
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
}
