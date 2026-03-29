/**
 * Orchestrator 编排器
 *
 * 负责将用户意图转化为可执行的任务计划：
 * 1. 尝试匹配预置模板
 * 2. 匹配失败则调用 LLM 规划
 * 3. 创建 AgentTask + AgentTaskStep 写入数据库
 */

import { db } from "@/lib/db";
import { getProjectDeepContext } from "@/lib/ai/context";
import { buildProjectDeepBlock } from "@/lib/ai/prompts";
import { createCompletion } from "@/lib/ai/client";
import { matchTemplate, getTemplate } from "./templates";
import { getSkillsForOrchestrator, getSkill } from "./skills";
import {
  getOrchestratorSystemPrompt,
  getOrchestratorUserPrompt,
} from "./prompts/orchestrator-prompt";
import type { StepTemplate, RiskLevel, TriggerType } from "./types";

interface GeneratePlanInput {
  intent: string;
  projectId: string;
  userId: string;
  triggerType?: TriggerType;
  templateId?: string;
}

interface GeneratePlanResult {
  taskId: string;
  taskType: string;
  steps: Array<{ skillId: string; title: string }>;
  source: "template" | "llm";
}

export async function generatePlan(
  input: GeneratePlanInput
): Promise<GeneratePlanResult> {
  const { intent, projectId, userId, triggerType = "manual" } = input;

  let steps: StepTemplate[];
  let taskType: string;
  let source: "template" | "llm";

  // 1) 如果指定了模板 ID，查预设 → 查自定义
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
    // 2) 尝试关键词匹配模板
    const matched = matchTemplate(intent);
    if (matched) {
      steps = matched.steps;
      taskType = matched.taskType;
      source = "template";
    } else {
      // 3) LLM 规划
      const deepCtx = await getProjectDeepContext(projectId);
      const projectContext = deepCtx ? buildProjectDeepBlock(deepCtx) : "";
      const projectName = deepCtx?.project.name ?? "未知项目";
      const availableSkills = getSkillsForOrchestrator();

      const systemPrompt = getOrchestratorSystemPrompt();
      const userPrompt = getOrchestratorUserPrompt({
        intent,
        projectName,
        projectContext,
        availableSkills,
      });

      const raw = await createCompletion({
        systemPrompt,
        userPrompt,
        mode: "normal",
        maxTokens: 2000,
      });

      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("LLM 未返回有效的步骤 JSON");
      }

      const parsed = JSON.parse(jsonMatch[0]) as StepTemplate[];

      // 校验所有 skillId 都存在
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

  // 计算整体风险等级
  const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const maxRisk = steps.reduce(
    (max, s) => Math.max(max, riskOrder[s.riskLevel] ?? 0),
    0
  );
  const riskLevel: RiskLevel =
    maxRisk >= 2 ? "high" : maxRisk >= 1 ? "medium" : "low";
  const requiresApproval = steps.some((s) => s.requiresApproval);

  // 写入数据库
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
