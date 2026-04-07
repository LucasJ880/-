/**
 * 项目理解 Skill — 加载项目深度上下文 + AI 记忆
 */

import { getProjectDeepContext } from "@/lib/ai/context";
import { getProjectAiMemory, buildMemoryBlock } from "@/lib/ai/memory";
import { buildProjectDeepBlock } from "@/lib/ai/prompts";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const [deepCtx, memory] = await Promise.all([
      getProjectDeepContext(ctx.projectId),
      getProjectAiMemory(ctx.projectId),
    ]);

    if (!deepCtx) {
      return {
        success: false,
        data: {},
        summary: "未找到项目数据",
        error: `项目 ${ctx.projectId} 不存在或无权限`,
      };
    }

    const contextBlock = buildProjectDeepBlock(deepCtx);
    const memoryBlock = buildMemoryBlock(memory);

    return {
      success: true,
      data: {
        projectContext: deepCtx,
        memory,
        contextBlock,
        memoryBlock,
      },
      summary: `已加载项目「${deepCtx.project.name}」上下文：${deepCtx.taskStats.total} 个任务、${deepCtx.inquiries.length} 轮询价、${memory.recentAiActions.length} 条 AI 历史`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "加载项目上下文失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "project_understanding",
  name: "项目理解",
  domain: "project",
  tier: "foundation",
  version: "1.0.0",
  description: "加载项目深度上下文、任务统计、询价记录、AI 历史记忆，供后续步骤使用",
  actions: ["load"],
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: { projectId: "string" },
  outputSchema: {
    projectContext: "object",
    memory: "object",
    contextBlock: "string",
    memoryBlock: "string",
  },
  dependsOn: [],
  execute,
});
