/**
 * 进展摘要 Skill — 使用 project_progress_summary 独立生成器
 */

import { generateProgressSummary } from "@/lib/progress/generate-summary";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const result = await generateProgressSummary(ctx.projectId);
    if (!result) {
      return { success: false, data: {}, summary: "进展摘要生成失败（数据不足或 AI 调用失败）", error: "generation_failed" };
    }

    return {
      success: true,
      data: {
        ...result.output,
        _meta: result.meta,
      },
      summary: `项目摘要已生成：${result.output.statusLabel}。${result.output.executiveSummary}`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "进展摘要生成失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "progress_summary",
  name: "进展摘要",
  domain: "report",
  tier: "analysis",
  version: "1.1.0",
  description: "聚合项目全部数据，融合项目管理专家视角（范围控制、阶段判断、阻塞识别），生成结构化的管理级项目进展摘要",
  expertRoleId: "project_manager",
  actions: ["generate"],
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: { projectId: "string" },
  outputSchema: {
    overallStatus: "green | yellow | red",
    statusLabel: "string",
    currentJudgment: "string",
    keyProgress: "array",
    blockers: "array",
    nextActions: "array",
    executiveSummary: "string",
  },
  dependsOn: ["project_understanding"],
  execute,
});
