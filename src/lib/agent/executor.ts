/**
 * 执行器 — 状态机驱动的步骤执行引擎
 *
 * 核心循环：
 * 1. 取当前步骤 → 2. 执行 Skill → 3. 审查 → 4. 判断是否需审批
 * → 5a. 需审批 → 暂停等待 → 5b. 不需要 → 推进下一步 → 重复
 */

import { db } from "@/lib/db";
import { getSkill } from "./skills";
import { runStepCheck } from "./checker";
import { createApproval } from "./approval";
import type { SkillContext, SkillResult, TaskStatus } from "./types";

// ── 主执行入口 ──────────────────────────────────────────────────

export async function executeTask(taskId: string): Promise<{
  status: TaskStatus;
  stoppedAt?: string;
  reason?: string;
}> {
  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  // 只有 queued 或 running 状态才能执行
  if (!["queued", "running"].includes(task.status)) {
    return {
      status: task.status as TaskStatus,
      reason: `任务状态为 ${task.status}，无法执行`,
    };
  }

  // 标记为 running
  if (task.status === "queued") {
    await updateTaskStatus(taskId, "running", { startedAt: new Date() });
  }

  // 从当前步骤开始顺序执行
  for (let i = task.currentStepIndex; i < task.steps.length; i++) {
    const step = task.steps[i];

    // 跳过已完成/已跳过的步骤
    if (["completed", "skipped", "approved"].includes(step.status)) {
      await db.agentTask.update({
        where: { id: taskId },
        data: { currentStepIndex: i + 1 },
      });
      continue;
    }

    // 如果步骤正在等待审批，暂停
    if (step.status === "waiting_approval") {
      await updateTaskStatus(taskId, "waiting_for_approval");
      return {
        status: "waiting_for_approval",
        stoppedAt: step.title,
        reason: "等待人工审批",
      };
    }

    // 执行步骤
    const result = await executeStep(taskId, step, task.projectId, task.createdById);

    if (result.needsApproval) {
      await updateTaskStatus(taskId, "waiting_for_approval");
      return {
        status: "waiting_for_approval",
        stoppedAt: step.title,
        reason: result.reason ?? "步骤需要审批",
      };
    }

    if (!result.success) {
      await updateTaskStatus(taskId, "failed", { failedAt: new Date() });
      return {
        status: "failed",
        stoppedAt: step.title,
        reason: result.reason ?? "步骤执行失败",
      };
    }

    // 推进步骤指针
    await db.agentTask.update({
      where: { id: taskId },
      data: { currentStepIndex: i + 1 },
    });
  }

  // 全部完成
  await updateTaskStatus(taskId, "completed", { completedAt: new Date() });
  return { status: "completed" };
}

// ── 审批通过后恢复 ──────────────────────────────────────────────

export async function resumeAfterApproval(taskId: string): Promise<{
  status: TaskStatus;
  stoppedAt?: string;
  reason?: string;
}> {
  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  // 将当前步骤标记为 completed（审批通过意味着步骤完成）
  const currentStep = task.steps[task.currentStepIndex];
  if (currentStep && currentStep.status === "approved") {
    await db.agentTaskStep.update({
      where: { id: currentStep.id },
      data: { status: "completed", completedAt: new Date() },
    });

    // 推进步骤指针
    await db.agentTask.update({
      where: { id: taskId },
      data: {
        currentStepIndex: task.currentStepIndex + 1,
        status: "running",
      },
    });
  }

  // 继续执行
  return executeTask(taskId);
}

// ── 取消任务 ────────────────────────────────────────────────────

export async function cancelTask(taskId: string): Promise<void> {
  await updateTaskStatus(taskId, "cancelled", { cancelledAt: new Date() });

  // 取消所有 pending 步骤
  await db.agentTaskStep.updateMany({
    where: { taskId, status: { in: ["pending", "running", "waiting_approval"] } },
    data: { status: "skipped" },
  });

  // 取消所有 pending 审批
  await db.approvalRequest.updateMany({
    where: { taskId, status: "pending" },
    data: { status: "expired" },
  });
}

// ── 重试步骤 ────────────────────────────────────────────────────

export async function retryStep(
  taskId: string,
  stepId: string
): Promise<{ status: TaskStatus; stoppedAt?: string; reason?: string }> {
  // 重置步骤状态
  await db.agentTaskStep.update({
    where: { id: stepId },
    data: {
      status: "pending",
      error: null,
      outputJson: null,
      outputSummary: null,
      checkReportJson: null,
      retryCount: { increment: 1 },
    },
  });

  // 更新任务状态为 running
  const step = await db.agentTaskStep.findUnique({ where: { id: stepId } });
  if (step) {
    await db.agentTask.update({
      where: { id: taskId },
      data: {
        status: "running",
        currentStepIndex: step.stepIndex,
        failedAt: null,
      },
    });
  }

  return executeTask(taskId);
}

// ── 内部：执行单个步骤 ──────────────────────────────────────────

interface StepExecResult {
  success: boolean;
  needsApproval: boolean;
  reason?: string;
}

async function executeStep(
  taskId: string,
  step: { id: string; skillId: string; title: string; requiresApproval: boolean; riskLevel: string },
  projectId: string,
  userId: string
): Promise<StepExecResult> {
  const skill = getSkill(step.skillId);
  if (!skill) {
    await db.agentTaskStep.update({
      where: { id: step.id },
      data: { status: "failed", error: `未知技能: ${step.skillId}` },
    });
    return { success: false, needsApproval: false, reason: `未知技能: ${step.skillId}` };
  }

  // 标记步骤为 running
  await db.agentTaskStep.update({
    where: { id: step.id },
    data: { status: "running", startedAt: new Date() },
  });
  await updateTaskStatus(taskId, "waiting_for_subagent");

  // 准备上下文
  const ctx: SkillContext = {
    projectId,
    userId,
    taskId,
    stepId: step.id,
    input: await buildStepInput(taskId, step.id),
  };

  // 执行技能
  let result: SkillResult;
  try {
    result = await skill.execute(ctx);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.agentTaskStep.update({
      where: { id: step.id },
      data: { status: "failed", error: errMsg },
    });
    return { success: false, needsApproval: false, reason: errMsg };
  }

  // 保存结果
  await db.agentTaskStep.update({
    where: { id: step.id },
    data: {
      outputJson: JSON.stringify(result.data),
      outputSummary: result.summary,
    },
  });

  // 审查
  const checkReport = runStepCheck(step.skillId, result);
  await db.agentTaskStep.update({
    where: { id: step.id },
    data: { checkReportJson: JSON.stringify(checkReport) },
  });

  // 判断是否需要审批
  const needsApproval =
    step.requiresApproval || !checkReport.passed;

  if (needsApproval) {
    await db.agentTaskStep.update({
      where: { id: step.id },
      data: { status: "waiting_approval" },
    });

    // 获取任务关联的项目 owner 作为审批人
    const task = await db.agentTask.findUnique({
      where: { id: taskId },
      select: { createdById: true, projectId: true },
    });

    await createApproval({
      taskId,
      stepId: step.id,
      actionType: step.title,
      riskLevel: step.riskLevel as "low" | "medium" | "high",
      riskReason: !checkReport.passed
        ? `审查未通过：${checkReport.blockers.map((b) => b.message).join("；")}`
        : `步骤「${step.title}」需要人工确认`,
      previewData: result.data,
      approverUserId: task?.createdById,
      projectId: task?.projectId,
    });

    return {
      success: true,
      needsApproval: true,
      reason: `步骤「${step.title}」等待审批`,
    };
  }

  // 步骤完成
  await db.agentTaskStep.update({
    where: { id: step.id },
    data: { status: "completed", completedAt: new Date() },
  });

  return { success: true, needsApproval: false };
}

// ── 内部：构建步骤输入 ──────────────────────────────────────────

async function buildStepInput(
  taskId: string,
  _stepId: string
): Promise<Record<string, unknown>> {
  // 聚合前序步骤的输出作为当前步骤的输入
  const completedSteps = await db.agentTaskStep.findMany({
    where: { taskId, status: { in: ["completed", "approved"] } },
    orderBy: { stepIndex: "asc" },
    select: { skillId: true, outputJson: true },
  });

  const input: Record<string, unknown> = {};

  for (const prev of completedSteps) {
    if (!prev.outputJson) continue;
    try {
      const output = JSON.parse(prev.outputJson);

      // 传递模板推荐结果
      if (prev.skillId === "quote_template_recommend" && output.recommendation) {
        input.templateType = output.recommendation.templateType;
      }

      // 传递报价草稿中的 quoteId
      if (prev.skillId === "quote_draft_generate" && output.draft) {
        input.draft = output.draft;
      }

      // 传递项目上下文
      if (prev.skillId === "project_understanding") {
        input.projectContext = output;
      }
    } catch {
      // skip invalid JSON
    }
  }

  return input;
}

// ── 内部：更新任务状态 ──────────────────────────────────────────

async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  extra?: Record<string, unknown>
): Promise<void> {
  await db.agentTask.update({
    where: { id: taskId },
    data: { status, ...extra },
  });
}
