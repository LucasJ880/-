/**
 * POST — 执行投标方案任务的下一个 pending 步骤
 *
 * 每次调用只执行 1 步，确保单次 HTTP 不超 Vercel 60s 限制。
 * 前端逐步调用直到所有步骤完成。
 *
 * 权限（FIX-21）：第一步要项目写权限，在读请求体之前。
 * 响应对不是平台管理员的调用者只给安全视图（src/lib/agent-tasks/dto.ts 头注释的约定）：data 为空对象，
 * 这一步失败或带报错时 error 换成固定提示；库里照旧写入完整输出与原始报错，平台管理员看得到。
 * 调技能时不传组织：守卫之后项目的组织就是它自己的组织，static-bridge 的组织比较不会起作用（design D8）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { runStaticSkill, STATIC_SKILL_TOOL_NAMES } from "@/lib/agent-core/skills/static-bridge";
import { runStepCheck } from "@/lib/agent/checker";
import type { SkillResult } from "@/lib/agent/types";
import { notifyProjectMembers } from "@/lib/notifications/create";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";

/**
 * 与 src/lib/agent-tasks/dto.ts 的 SAFE_STEP_ERROR_MESSAGE 一字不差。src/lib/agent-tasks 是 runtime-architecture
 * 冻结面，新文件不能导入它（scripts/test-runtime-architecture.sh 的 NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN），
 * 所以在这里照抄；两处一字不差由 src/lib/projects/__tests__/project-routes-guard.test.ts 按源码文本比较（CI 子集里跑）。
 */
const SAFE_STEP_ERROR_MESSAGE = "处理失败，请稍后重试或联系管理员";

export const POST = withAuth(async (request, routeCtx, user) => {
  const { id: projectId } = await routeCtx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  // 平台管理员保留原始输出与原始报错；其余人（含以岗位预览身份访问的 super_admin）只拿安全视图
  const diagnostic = isPlatformAdmin(access.user);
  const stepError = (raw: string | undefined, failed: boolean) =>
    diagnostic ? raw : failed || raw ? SAFE_STEP_ERROR_MESSAGE : undefined;

  const body = await request.json();
  const taskId = body.taskId as string | undefined;

  if (!taskId) {
    return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
  }

  // 只认本项目的一键投标方案任务：同项目里别的类型的 AgentTask（如 custom_flow）按「任务不存在」处理，不执行
  const task = await db.agentTask.findUnique({
    where: { id: taskId, projectId, taskType: "ai_bid_package" },
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

  const nextStep = task.steps.find((s) => s.status === "pending");
  if (!nextStep) {
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "completed", completedAt: new Date() },
    });
    return NextResponse.json({ done: true, status: "completed", message: "所有步骤已完成" });
  }

  if (task.status === "queued") {
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });
  }

  // A-P2：执行统一走 agent-core 静态技能桥接
  const isKnownSkill = Boolean(STATIC_SKILL_TOOL_NAMES[nextStep.skillId]);
  if (!isKnownSkill) {
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
      error: stepError(`未知技能: ${nextStep.skillId}`, true),
    });
  }

  await db.agentTaskStep.update({
    where: { id: nextStep.id },
    data: { status: "running", startedAt: new Date() },
  });
  await db.agentTask.update({
    where: { id: taskId },
    data: { status: "waiting_for_subagent", currentStepIndex: nextStep.stepIndex },
  });

  const input = await buildInput(taskId, nextStep.id);

  const t0 = Date.now();
  let result: SkillResult;
  try {
    result = await runStaticSkill(nextStep.skillId, {
      projectId,
      userId: user.id,
      input,
    });
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
      error: stepError(errMsg, true),
      durationMs: Date.now() - t0,
    });
  }
  const durationMs = Date.now() - t0;

  await db.agentTaskStep.update({
    where: { id: nextStep.id },
    data: {
      outputJson: JSON.stringify(result.data),
      outputSummary: result.summary,
    },
  });

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

      notifyProjectMembers(projectId, user.id, {
        type: "agent_task",
        title: "AI 投标方案已生成",
        summary: "文档摘要、情报分析、报价草稿和邮件草稿已全部完成，可前往 AI 工作台查看",
        entityType: "agent_task",
        entityId: taskId,
        priority: "high",
        sourceKey: `bid_package_done:${taskId}`,
      }).catch((err) => console.error("[Notify] bid package done:", err));
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
    data: diagnostic ? result.data : {},
    error: stepError(result.error, !result.success),
    durationMs,
  });
});

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
