/**
 * 报价草稿生成 Skill — 基于项目上下文 + 供应商报价生成完整草稿
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteDraftPrompt } from "@/lib/ai/prompts";
import { getProjectAiMemory, buildMemoryBlock } from "@/lib/ai/memory";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const templateType = (ctx.input.templateType as string) || "export_standard";

    const [project, inquiryItems, memory] = await Promise.all([
      db.project.findUnique({
        where: { id: ctx.projectId },
        select: {
          name: true,
          clientOrganization: true,
          description: true,
          closeDate: true,
          location: true,
          currency: true,
        },
      }),
      db.inquiryItem.findMany({
        where: { inquiry: { projectId: ctx.projectId }, status: "quoted" },
        select: {
          unitPrice: true,
          totalPrice: true,
          currency: true,
          deliveryDays: true,
          quoteNotes: true,
          supplier: { select: { name: true } },
          inquiry: { select: { scope: true } },
        },
        take: 30,
      }),
      getProjectAiMemory(ctx.projectId),
    ]);

    if (!project) {
      return { success: false, data: {}, summary: "项目不存在", error: "Project not found" };
    }

    const memoryBlock = buildMemoryBlock(memory);
    const inquiryScope =
      inquiryItems.map((i) => i.inquiry.scope).find((s) => s?.trim()) ?? null;

    const prompt = getQuoteDraftPrompt({
      project: {
        name: project.name,
        clientOrganization: project.clientOrganization,
        description: project.description,
        closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
        location: project.location,
        currency: project.currency,
      },
      supplierQuotes: inquiryItems.map((i) => ({
        supplierName: i.supplier.name,
        totalPrice: i.totalPrice != null ? String(i.totalPrice) : null,
        unitPrice: i.unitPrice != null ? String(i.unitPrice) : null,
        currency: i.currency,
        deliveryDays: i.deliveryDays,
        quoteNotes: i.quoteNotes,
      })),
      templateType,
      inquiryScope,
      memory: memoryBlock,
    });

    const raw = await createCompletion({
      systemPrompt: "你是专业的报价编制助手。根据上下文生成结构化报价草稿 JSON。只输出 JSON，不输出其他内容。",
      userPrompt: prompt,
      mode: "normal",
      maxTokens: 4000,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, data: {}, summary: "AI 返回格式异常", error: raw.slice(0, 500) };
    }

    const draft = JSON.parse(jsonMatch[0]);

    const lineCount = Array.isArray(draft.lines) ? draft.lines.length : 0;
    return {
      success: true,
      data: { draft, templateType },
      summary: `已生成报价草稿：${lineCount} 个行项目，模板 ${templateType}`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "报价草稿生成失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "quote_draft_generate",
  name: "报价草稿生成",
  domain: "quote",
  description: "基于项目资料、供应商报价、AI 记忆，生成包含行项目和商务条款的完整报价草稿",
  riskLevel: "medium",
  requiresApproval: true,
  inputDescription: "projectId, templateType (optional)",
  outputDescription: "draft: { header, lines, summary }",
  execute,
});
