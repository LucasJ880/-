/**
 * 报价模板推荐 Skill — 根据项目上下文推荐最合适的报价模板
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteTemplatePrompt } from "@/lib/ai/prompts";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const project = await db.project.findUnique({
      where: { id: ctx.projectId },
      select: {
        name: true,
        category: true,
        tenderStatus: true,
        clientOrganization: true,
        sourceSystem: true,
        estimatedValue: true,
        currency: true,
        location: true,
        description: true,
      },
    });

    if (!project) {
      return { success: false, data: {}, summary: "项目不存在", error: "Project not found" };
    }

    const prompt = getQuoteTemplatePrompt({ project });

    const raw = await createCompletion({
      systemPrompt: "你是报价模板推荐助手。只输出 JSON，不要输出其他内容。",
      userPrompt: prompt,
      mode: "normal",
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, data: {}, summary: "AI 返回格式异常", error: raw };
    }

    const result = JSON.parse(jsonMatch[0]) as {
      templateType: string;
      reason: string;
      confidence: string;
    };

    const validTypes = ["export_standard", "gov_procurement", "project_install", "service_unit"];
    if (!validTypes.includes(result.templateType)) {
      result.templateType = "export_standard";
    }

    return {
      success: true,
      data: { recommendation: result },
      summary: `推荐使用「${result.templateType}」模板，置信度 ${result.confidence}：${result.reason}`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "模板推荐失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "quote_template_recommend",
  name: "报价模板推荐",
  domain: "quote",
  description: "根据项目类型、客户类型、是否政府采购等，推荐最合适的报价模板",
  riskLevel: "low",
  requiresApproval: false,
  inputDescription: "projectId",
  outputDescription: "recommendation: { templateType, reason, confidence }",
  execute,
});
