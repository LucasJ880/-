/**
 * POST — 创建 AI 投标方案任务（持久化到 AgentTask），立即返回 taskId
 * GET  — 查询任务完整状态 + 所有步骤结果
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { generatePlan } from "@/lib/agent/orchestrator";
import "@/lib/agent/skills/index";

export const POST = withAuth(async (_request, ctx, user) => {
  const { id: projectId } = await ctx.params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const plan = await generatePlan({
    intent: "AI 一键生成投标方案",
    projectId,
    userId: user.id,
    triggerType: "manual",
    templateId: "ai_bid_package",
  });

  return NextResponse.json({
    taskId: plan.taskId,
    taskType: plan.taskType,
    steps: plan.steps,
    source: plan.source,
  });
});

export const GET = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");

  let resolvedTaskId = taskId;
  if (!resolvedTaskId) {
    const latest = await db.agentTask.findFirst({
      where: { projectId, taskType: "ai_bid_package" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest) {
      return NextResponse.json({ taskId: null, steps: [] });
    }
    resolvedTaskId = latest.id;
  }

  const task = await db.agentTask.findUnique({
    where: { id: resolvedTaskId, projectId },
    select: {
      id: true,
      status: true,
      taskType: true,
      totalSteps: true,
      currentStepIndex: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      steps: {
        orderBy: { stepIndex: "asc" },
        select: {
          id: true,
          stepIndex: true,
          skillId: true,
          title: true,
          status: true,
          outputJson: true,
          outputSummary: true,
          error: true,
          startedAt: true,
          completedAt: true,
          inputJson: true,
        },
      },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const steps = task.steps.map((s) => {
    let data: Record<string, unknown> = {};
    if (s.outputJson) {
      try { data = JSON.parse(s.outputJson); } catch { /* skip */ }
    }
    let action: string | undefined;
    if (s.inputJson) {
      try {
        const mapping = JSON.parse(s.inputJson);
        const raw = mapping.action as string | undefined;
        if (raw) action = raw.replace(/^'|'$/g, "");
      } catch { /* skip */ }
    }

    return {
      id: s.id,
      stepIndex: s.stepIndex,
      skillId: s.skillId,
      title: s.title,
      action,
      status: s.status,
      success: s.status === "completed",
      summary: s.outputSummary ?? "",
      data,
      error: s.error,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      durationMs:
        s.startedAt && s.completedAt
          ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()
          : null,
    };
  });

  const completedSteps = steps.filter((s) => s.success).length;

  return NextResponse.json({
    taskId: task.id,
    status: task.status,
    taskType: task.taskType,
    totalSteps: task.totalSteps,
    completedSteps,
    success: task.status === "completed",
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    steps,
  });
});
