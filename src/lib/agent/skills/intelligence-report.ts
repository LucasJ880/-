/**
 * 情报分析 Skill — 封装 generateProjectIntelligence 为 Agent 可调度能力
 */

import { generateProjectIntelligence } from "@/lib/files/ai-intelligence";
import { db } from "@/lib/db";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    await generateProjectIntelligence(ctx.projectId);

    const intelligence = await db.projectIntelligence.findUnique({
      where: { projectId: ctx.projectId },
      select: {
        recommendation: true,
        riskLevel: true,
        fitScore: true,
        summary: true,
        reportStatus: true,
      },
    });

    if (!intelligence) {
      return { success: false, data: {}, summary: "情报分析未生成结果" };
    }

    return {
      success: true,
      data: {
        recommendation: intelligence.recommendation,
        riskLevel: intelligence.riskLevel,
        fitScore: intelligence.fitScore,
        reportStatus: intelligence.reportStatus,
      },
      summary: `情报分析完成：${intelligence.recommendation}（匹配度 ${intelligence.fitScore}/100）`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "情报分析生成失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "intelligence_report",
  name: "招标情报分析",
  domain: "analysis",
  tier: "analysis",
  version: "2.0.0",
  description: "基于项目文档生成 12 章节投标深度情报分析报告，含 GO/NO-GO 决策矩阵（融合投标策略专家视角）",
  expertRoleId: "bid_analyst",
  actions: ["generate"],
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: { projectId: "string" },
  outputSchema: {
    recommendation: "GO | CONDITIONAL GO | NO-GO",
    riskLevel: "low | medium | high",
    fitScore: "number (0-100)",
    reportStatus: "string",
  },
  dependsOn: ["project_understanding"],
  execute,
});
