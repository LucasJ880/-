import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generatePlan } from "@/lib/agent/orchestrator";
import { listTemplates } from "@/lib/agent/templates";
import type { TriggerType } from "@/lib/agent/types";

/**
 * GET /api/agent/tasks?projectId=xxx
 * 列出项目的 AI 任务
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 20, 100);

  const tasks = await db.agentTask.findMany({
    where: { projectId },
    include: {
      steps: {
        orderBy: { stepIndex: "asc" },
        select: {
          id: true,
          stepIndex: true,
          skillId: true,
          agentName: true,
          title: true,
          status: true,
          riskLevel: true,
          requiresApproval: true,
          outputSummary: true,
          startedAt: true,
          completedAt: true,
          error: true,
          approvalRequests: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { deadlineAt: true, status: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ tasks, templates: listTemplates() });
}

/**
 * POST /api/agent/tasks
 * 创建 AI 任务（编排器生成计划）
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const { intent, projectId, templateId, triggerType } = body as {
    intent: string;
    projectId: string;
    templateId?: string;
    triggerType?: TriggerType;
  };

  if (!intent || !projectId) {
    return NextResponse.json({ error: "缺少 intent 或 projectId" }, { status: 400 });
  }

  try {
    const result = await generatePlan({
      intent,
      projectId,
      userId: user.id,
      templateId,
      triggerType,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
