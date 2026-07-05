/**
 * 轻量流程执行器（A-P4：Agent 三栈合并收官）
 *
 * 取代 lib/agent 的 orchestrator.generatePlan 与 executor.executeTask/
 * resumeAfterApproval/cancelTask，成为 AgentTask 流程的唯一执行路径：
 * - 计划生成：预设模板 → 自定义模板 → LLM 规划（校验 skillId 白名单）
 * - 步骤执行：统一走 agent-core 静态技能桥接 runStaticSkill
 * - 审查 / 审批：复用 checker 与 approval（ApprovalRequest 低层服务保留）
 * - 持久化：沿用 AgentTask / AgentTaskStep（前端 AI 工作台继续读同一张表）
 */

import { db } from "@/lib/db";
import { getProjectDeepContext } from "@/lib/ai/context";
import { buildProjectDeepBlock } from "@/lib/ai/prompts";
import { createCompletion } from "@/lib/ai/client";
import { matchTemplate, getTemplate } from "@/lib/agent/templates";
import { getSkillsForOrchestrator, getSkill } from "@/lib/agent/skills";
import {
  getOrchestratorSystemPrompt,
  getOrchestratorUserPrompt,
} from "@/lib/agent/prompts/orchestrator-prompt";
import { runStepCheck } from "@/lib/agent/checker";
import { createApproval } from "@/lib/agent/approval";
import type {
  StepTemplate,
  RiskLevel,
  TriggerType,
  TaskStatus,
  SkillResult,
} from "@/lib/agent/types";
import { runStaticSkill } from "./static-bridge";

// ── 计划生成（原 orchestrator.generatePlan） ─────────────────────

export interface GenerateFlowPlanInput {
  intent: string;
  projectId: string;
  userId: string;
  triggerType?: TriggerType;
  templateId?: string;
}

export interface GenerateFlowPlanResult {
  taskId: string;
  taskType: string;
  steps: Array<{ skillId: string; title: string }>;
  source: "template" | "llm";
}

export async function generateFlowPlan(
  input: GenerateFlowPlanInput,
): Promise<GenerateFlowPlanResult> {
  const { intent, projectId, userId, triggerType = "manual" } = input;

  let steps: StepTemplate[];
  let taskType: string;
  let source: "template" | "llm";

  if (input.templateId) {
    const tpl = getTemplate(input.templateId);
    if (tpl) {
      steps = tpl.steps;
      taskType = tpl.taskType;
      source = "template";
    } else {
      const customTpl = await db.customFlowTemplate.findUnique({
        where: { id: input.templateId },
      });
      if (customTpl) {
        steps = JSON.parse(customTpl.stepsJson) as StepTemplate[];
        taskType = customTpl.category || "custom";
        source = "template";
        await db.customFlowTemplate.update({
          where: { id: customTpl.id },
          data: { usageCount: { increment: 1 } },
        });
      } else {
        throw new Error(`模板 "${input.templateId}" 不存在`);
      }
    }
  } else {
    const matched = matchTemplate(intent);
    if (matched) {
      steps = matched.steps;
      taskType = matched.taskType;
      source = "template";
    } else {
      const deepCtx = await getProjectDeepContext(projectId);
      const projectContext = deepCtx ? buildProjectDeepBlock(deepCtx) : "";
      const projectName = deepCtx?.project.name ?? "未知项目";
      const availableSkills = getSkillsForOrchestrator();

      const raw = await createCompletion({
        systemPrompt: getOrchestratorSystemPrompt(),
        userPrompt: getOrchestratorUserPrompt({
          intent,
          projectName,
          projectContext,
          availableSkills,
        }),
        mode: "normal",
        maxTokens: 2000,
      });

      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("LLM 未返回有效的步骤 JSON");
      }

      const parsed = JSON.parse(jsonMatch[0]) as StepTemplate[];

      // 校验所有 skillId 都是已注册静态技能（runStaticSkill 可执行）
      for (const s of parsed) {
        if (!getSkill(s.skillId)) {
          throw new Error(`LLM 输出了未知的 skillId: "${s.skillId}"`);
        }
      }

      steps = parsed;
      taskType = "custom";
      source = "llm";
    }
  }

  const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const maxRisk = steps.reduce(
    (max, s) => Math.max(max, riskOrder[s.riskLevel] ?? 0),
    0,
  );
  const riskLevel: RiskLevel =
    maxRisk >= 2 ? "high" : maxRisk >= 1 ? "medium" : "low";
  const requiresApproval = steps.some((s) => s.requiresApproval);

  const task = await db.agentTask.create({
    data: {
      projectId,
      taskType,
      triggerType,
      intent,
      riskLevel,
      status: "queued",
      totalSteps: steps.length,
      requiresApproval,
      createdById: userId,
      steps: {
        create: steps.map((s, i) => {
          const skill = getSkill(s.skillId);
          return {
            stepIndex: i,
            skillId: s.skillId,
            agentName: skill?.name ?? s.skillId,
            title: s.title,
            description: s.description ?? null,
            riskLevel: s.riskLevel,
            requiresApproval: s.requiresApproval,
            status: "pending",
            inputJson: s.inputMapping ? JSON.stringify(s.inputMapping) : null,
          };
        }),
      },
    },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  return {
    taskId: task.id,
    taskType,
    steps: task.steps.map((s) => ({ skillId: s.skillId, title: s.title })),
    source,
  };
}

// ── 流程执行（原 executor.executeTask） ──────────────────────────

export interface FlowRunResult {
  status: TaskStatus;
  stoppedAt?: string;
  reason?: string;
}

export async function executeFlowTask(taskId: string): Promise<FlowRunResult> {
  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  if (!["queued", "running"].includes(task.status)) {
    return {
      status: task.status as TaskStatus,
      reason: `任务状态为 ${task.status}，无法执行`,
    };
  }

  if (task.status === "queued") {
    await updateTaskStatus(taskId, "running", { startedAt: new Date() });
  }

  for (let i = task.currentStepIndex; i < task.steps.length; i++) {
    const step = task.steps[i];

    if (["completed", "skipped", "approved"].includes(step.status)) {
      await db.agentTask.update({
        where: { id: taskId },
        data: { currentStepIndex: i + 1 },
      });
      continue;
    }

    if (step.status === "waiting_approval") {
      await updateTaskStatus(taskId, "waiting_for_approval");
      return {
        status: "waiting_for_approval",
        stoppedAt: step.title,
        reason: "等待人工审批",
      };
    }

    const result = await executeFlowStep(
      taskId,
      step,
      task.projectId,
      task.createdById,
    );

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

    await db.agentTask.update({
      where: { id: taskId },
      data: { currentStepIndex: i + 1 },
    });
  }

  await updateTaskStatus(taskId, "completed", { completedAt: new Date() });
  return { status: "completed" };
}

// ── 审批通过后恢复（原 executor.resumeAfterApproval） ────────────

export async function resumeFlowAfterApproval(
  taskId: string,
): Promise<FlowRunResult> {
  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  const currentStep = task.steps[task.currentStepIndex];
  if (currentStep && currentStep.status === "approved") {
    await db.agentTaskStep.update({
      where: { id: currentStep.id },
      data: { status: "completed", completedAt: new Date() },
    });

    await db.agentTask.update({
      where: { id: taskId },
      data: {
        currentStepIndex: task.currentStepIndex + 1,
        status: "running",
      },
    });
  }

  return executeFlowTask(taskId);
}

// ── 取消任务（原 executor.cancelTask） ───────────────────────────

export async function cancelFlowTask(taskId: string): Promise<void> {
  await updateTaskStatus(taskId, "cancelled", { cancelledAt: new Date() });

  await db.agentTaskStep.updateMany({
    where: {
      taskId,
      status: { in: ["pending", "running", "waiting_approval"] },
    },
    data: { status: "skipped" },
  });

  await db.approvalRequest.updateMany({
    where: { taskId, status: "pending" },
    data: { status: "expired" },
  });
}

// ── 内部：执行单个步骤 ──────────────────────────────────────────

interface StepExecResult {
  success: boolean;
  needsApproval: boolean;
  reason?: string;
}

async function executeFlowStep(
  taskId: string,
  step: {
    id: string;
    skillId: string;
    title: string;
    requiresApproval: boolean;
    riskLevel: string;
  },
  projectId: string,
  userId: string,
): Promise<StepExecResult> {
  if (!getSkill(step.skillId)) {
    await db.agentTaskStep.update({
      where: { id: step.id },
      data: { status: "failed", error: `未知技能: ${step.skillId}` },
    });
    return {
      success: false,
      needsApproval: false,
      reason: `未知技能: ${step.skillId}`,
    };
  }

  await db.agentTaskStep.update({
    where: { id: step.id },
    data: { status: "running", startedAt: new Date() },
  });
  await updateTaskStatus(taskId, "waiting_for_subagent");

  let result: SkillResult;
  try {
    result = await runStaticSkill(step.skillId, {
      projectId,
      userId,
      input: await buildStepInput(taskId, step.id),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.agentTaskStep.update({
      where: { id: step.id },
      data: { status: "failed", error: errMsg },
    });
    return { success: false, needsApproval: false, reason: errMsg };
  }

  await db.agentTaskStep.update({
    where: { id: step.id },
    data: {
      outputJson: JSON.stringify(result.data),
      outputSummary: result.summary,
    },
  });

  const checkReport = runStepCheck(step.skillId, result);
  await db.agentTaskStep.update({
    where: { id: step.id },
    data: { checkReportJson: JSON.stringify(checkReport) },
  });

  const needsApproval = step.requiresApproval || !checkReport.passed;

  if (needsApproval) {
    await db.agentTaskStep.update({
      where: { id: step.id },
      data: { status: "waiting_approval" },
    });

    const task = await db.agentTask.findUnique({
      where: { id: taskId },
      select: { createdById: true, projectId: true },
    });

    await createApproval({
      taskId,
      stepId: step.id,
      actionType: step.title,
      riskLevel: step.riskLevel as RiskLevel,
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

  await db.agentTaskStep.update({
    where: { id: step.id },
    data: { status: "completed", completedAt: new Date() },
  });

  return { success: true, needsApproval: false };
}

// ── 内部：构建步骤输入（inputMapping + 前序输出聚合） ────────────

async function buildStepInput(
  taskId: string,
  stepId: string,
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
      const mapping = JSON.parse(currentStep.inputJson) as Record<
        string,
        string
      >;
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
              const resolved = path
                .split(".")
                .reduce(
                  (obj: Record<string, unknown> | undefined, k: string) =>
                    obj && typeof obj === "object"
                      ? ((obj as Record<string, unknown>)[k] as
                          | Record<string, unknown>
                          | undefined)
                      : undefined,
                  refOutput as Record<string, unknown>,
                );
              if (resolved !== undefined) input[key] = resolved;
            } catch {
              /* skip */
            }
          }
        }
      }
    } catch {
      /* skip invalid inputJson */
    }
  }

  for (const prev of completedSteps) {
    if (!prev.outputJson) continue;
    try {
      const output = JSON.parse(prev.outputJson);

      if (prev.skillId === "quote" && output.recommendation) {
        input.templateType =
          input.templateType ?? output.recommendation.templateType;
      }
      if (prev.skillId === "quote" && output.draft) {
        input.draft = input.draft ?? output.draft;
      }
      if (prev.skillId === "project_understanding") {
        input.projectContext = output;
      }
    } catch {
      /* skip */
    }
  }

  return input;
}

// ── 内部：更新任务状态 ──────────────────────────────────────────

async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  extra?: Record<string, unknown>,
): Promise<void> {
  await db.agentTask.update({
    where: { id: taskId },
    data: { status, ...extra },
  });
}
