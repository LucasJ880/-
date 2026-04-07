import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatePlan } from "@/lib/agent/orchestrator";
import { executeTask } from "@/lib/agent/executor";

/**
 * GET /api/cron/inspect
 *
 * Vercel Cron 定时调用：对所有活跃项目执行自动巡检。
 * 通过 CRON_SECRET 鉴权，不走用户 session。
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 查找活跃项目（排除 24 小时内已巡检的）
  const projects = await db.project.findMany({
    where: {
      status: "active",
      NOT: {
        agentTasks: {
          some: {
            taskType: "project_inspection",
            triggerType: "cron",
            createdAt: { gte: oneDayAgo },
          },
        },
      },
    },
    select: { id: true, name: true, ownerId: true },
    take: 10,
  });

  if (projects.length === 0) {
    return NextResponse.json({
      scannedAt: now.toISOString(),
      message: "无需巡检的项目",
      tasksCreated: 0,
    });
  }

  const results: Array<{ projectId: string; projectName: string; taskId: string; status: string }> = [];

  for (const project of projects) {
    try {
      const plan = await generatePlan({
        intent: "定时自动巡检",
        projectId: project.id,
        userId: project.ownerId,
        templateId: "project_inspection",
        triggerType: "cron",
      });

      const execResult = await executeTask(plan.taskId);

      results.push({
        projectId: project.id,
        projectName: project.name,
        taskId: plan.taskId,
        status: execResult.status,
      });
    } catch (err) {
      results.push({
        projectId: project.id,
        projectName: project.name,
        taskId: "",
        status: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 写入审计日志
  await db.auditLog.create({
    data: {
      userId: projects[0]?.ownerId ?? "system",
      action: "cron_inspect",
      targetType: "agent_task",
      targetId: "batch",
      afterData: JSON.stringify({
        scannedAt: now.toISOString(),
        projectCount: projects.length,
        results: results.map((r) => ({ projectId: r.projectId, taskId: r.taskId, status: r.status })),
      }),
    },
  });

  return NextResponse.json({
    scannedAt: now.toISOString(),
    tasksCreated: results.filter((r) => r.taskId).length,
    results,
  });
}
