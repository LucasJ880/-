/**
 * POST — 执行投标方案任务的下一个 pending 步骤
 *
 * 每次调用只执行 1 步，确保单次 HTTP 不超 Vercel 60s 限制。
 * 前端逐步调用直到所有步骤完成。
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSkill } from "@/lib/agent/skills";
import "@/lib/agent/skills/index";
import { runStepCheck } from "@/lib/agent/checker";
import type { SkillContext, SkillResult } from "@/lib/agent/types";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const body = await request.json();
  const taskId = body.taskId as string | undefined;

  if (!taskId) {
    return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
  }

  const task = await db.agentTask.findUnique({
    where: { id: taskId, projectId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  if (task.status === "completed") {
    return NextResponse.json({ done: true, status: "completed", message: "任务已全部完成" });
  }
  if (task.status === "failed" || task.status === "cancelled") {
    return NextResponse.json({ done: true, status: task.status, message: `任务已${task.status === "failed" ? "失败" : "取消"}` });
  }

  // 找到下一个 pending 步骤
  const nextStep = task.steps.find((s) => s.status === "pending");
  if (!nextStep) {
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "completed", completedAt: new Date() },
    });
    return NextResponse.json({ done: true, status: "completed", message: "所有步骤已完成" });
  }

  // 标记任务为 running
  if (task.status === "queued") {
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });
  }

  const skill = getSkill(nextStep.skillId);
  if (!skill) {
    await db.agentTaskStep.update({
      where: { id: nextStep.id },
      data: { status: "failed", error: `未知技能: ${nextStep.skillId}` },
    });
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "failed", failedAt: new Date() },
    });
    return NextResponse.json({
      done: false,
      stepIndex: nextStep.stepIndex,
      skillId: nextStep.skillId,
      title: nextStep.title,
      success: false,
      error: `未知技能: ${nextStep.skillId}`,
    });
  }

  // 标记步骤开始
  await db.agentTaskStep.update({
    where: { id: nextStep.id },
    data: { status: "running", startedAt: new Date() },
  });
  await db.agentTask.update({
    where: { id: taskId },
    data: { status: "waiting_for_subagent", currentStepIndex: nextStep.stepIndex },
  });

  // 构建 input
  const input = await buildInput(taskId, nextStep.id);

  const ctx: SkillContext = {
    projectId,
    userId: user.id,
    taskId,
    stepId: nextStep.id,
    input,
  };

  const t0 = Date.now();
  let result: SkillResult;
  try {
    result = await skill.execute(ctx);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.agentTaskStep.update({
      where: { id: nextStep.id },
      data: { status: "failed", error: errMsg, completedAt: new Date() },
    });
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "failed", failedAt: new Date() },
    });
    return NextResponse.json({
      done: false,
      stepIndex: nextStep.stepIndex,
      skillId: nextStep.skillId,
      title: nextStep.title,
      success: false,
      error: errMsg,
      durationMs: Date.now() - t0,
    });
  }
  const durationMs = Date.now() - t0;

  // 保存结果
  await db.agentTaskStep.update({
    where: { id: nextStep.id },
    data: {
      outputJson: JSON.stringify(result.data),
      outputSummary: result.summary,
    },
  });

  // 审查
  const checkReport = runStepCheck(nextStep.skillId, result);
  await db.agentTaskStep.update({
    where: { id: nextStep.id },
    data: { checkReportJson: JSON.stringify(checkReport) },
  });

  if (!result.success) {
    await db.agentTaskStep.update({
      where: { id: nextStep.id },
      data: { status: "failed", error: result.error ?? "执行失败", completedAt: new Date() },
    });
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "failed", failedAt: new Date() },
    });
  } else {
    await db.agentTaskStep.update({
      where: { id: nextStep.id },
      data: { status: "completed", completedAt: new Date() },
    });

    // 检查是否全部完成
    const remaining = task.steps.filter(
      (s) => s.status === "pending" && s.id !== nextStep.id
    );
    if (remaining.length === 0) {
      await db.agentTask.update({
        where: { id: taskId },
        data: {
          status: "completed",
          completedAt: new Date(),
          currentStepIndex: nextStep.stepIndex + 1,
        },
      });
    } else {
      await db.agentTask.update({
        where: { id: taskId },
        data: { status: "running", currentStepIndex: nextStep.stepIndex + 1 },
      });
    }
  }

  return NextResponse.json({
    done: !result.success || task.steps.filter((s) => s.status === "pending" && s.id !== nextStep.id).length === 0,
    stepIndex: nextStep.stepIndex,
    skillId: nextStep.skillId,
    title: nextStep.title,
    success: result.success,
    summary: result.summary,
    data: result.data,
    error: result.error,
    durationMs,
  });
}

async function buildInput(
  taskId: string,
  stepId: string
): Promise<Record<string, unknown>> {
  const [currentStep, completedSteps] = await Promise.all([
    db.agentTaskStep.findUnique({
      where: { id: stepId },
      select: { inputJson: true },
    }),
    db.agentTaskStep.findMany({
      where: { taskId, status: { in: ["completed", "approved"] } },
      orderBy: { stepIndex: "asc" },
      select: { skillId: true, stepIndex: true, outputJson: true },
    }),
  ]);

  const input: Record<string, unknown> = {};

  if (currentStep?.inputJson) {
    try {
      const mapping = JSON.parse(currentStep.inputJson) as Record<string, string>;
      for (const [key, val] of Object.entries(mapping)) {
        const literalMatch = val.match(/^'(.+)'$/);
        if (literalMatch) {
          input[key] = literalMatch[1];
        }
        const refMatch = val.match(/^steps\[(\d+)\]\.output\.(.+)$/);
        if (refMatch) {
          const refIdx = parseInt(refMatch[1], 10);
          const path = refMatch[2];
          const refStep = completedSteps.find((s) => s.stepIndex === refIdx);
          if (refStep?.outputJson) {
            try {
              const refOutput = JSON.parse(refStep.outputJson);
              const resolved = path.split(".").reduce(
                (obj: Record<string, unknown> | undefined, k: string) =>
                  obj && typeof obj === "object"
                    ? (obj as Record<string, unknown>)[k] as Record<string, unknown> | undefined
                    : undefined,
                refOutput as Record<string, unknown>
              );
              if (resolved !== undefined) input[key] = resolved;
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* skip */ }
  }

  for (const prev of completedSteps) {
    if (!prev.outputJson) continue;
    try {
      const output = JSON.parse(prev.outputJson);
      if (prev.skillId === "quote" && output.recommendation) {
        input.templateType = input.templateType ?? output.recommendation.templateType;
      }
      if (prev.skillId === "quote" && output.draft) {
        input.draft = input.draft ?? output.draft;
      }
      if (prev.skillId === "project_understanding") {
        input.projectContext = output;
      }
    } catch { /* skip */ }
  }

  return input;
}
