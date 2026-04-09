/**
 * 标书分析 Skill — 对项目关联的招标文档进行深度结构化分析
 *
 * 当项目文档中包含标书/招标文件时，自动提取关键信息并生成
 * 面向"老板决策"的结构化分析报告。
 */

import { createCompletion } from "@/lib/ai/client";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";
import { db } from "@/lib/db";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

const TENDER_FILE_KEYWORDS = [
  "tender", "bid", "rfp", "rfq", "solicitation",
  "标书", "招标", "投标", "采购",
  "procurement", "addendum", "specification",
];

function isTenderDocument(title: string, content: string): boolean {
  const combined = (title + " " + content.slice(0, 2000)).toLowerCase();
  return TENDER_FILE_KEYWORDS.some((kw) => combined.includes(kw));
}

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const docs = await db.projectDocument.findMany({
      where: {
        projectId: ctx.projectId,
        parseStatus: "done",
        contentText: { not: null },
      },
      select: { id: true, title: true, contentText: true },
      take: 5,
    });

    const tenderDocs = docs.filter(
      (d) => d.contentText && isTenderDocument(d.title, d.contentText),
    );

    if (tenderDocs.length === 0) {
      return {
        success: true,
        data: { analyzed: 0 },
        summary: "未找到标书/招标文档，无需分析",
      };
    }

    const expertPrompt = getExpertSystemPrompt("bid_analyst") || "";

    const analyses: Array<{ docTitle: string; analysis: string }> = [];

    for (const doc of tenderDocs) {
      const docContent = doc.contentText!.slice(0, 80000);
      const userPrompt = `请对以下标书/招标文件进行完整分析：

<document title="${doc.title}">
${docContent}
</document>

请按照你的输出格式规范，逐项分析并输出结构化报告。`;

      const analysis = await createCompletion({
        systemPrompt: expertPrompt,
        userPrompt,
        mode: "deep",
        maxTokens: 4096,
      });

      analyses.push({ docTitle: doc.title, analysis });
    }

    const combinedSummary = analyses
      .map((a) => `**${a.docTitle}**\n${a.analysis}`)
      .join("\n\n---\n\n");

    return {
      success: true,
      data: {
        analyzed: analyses.length,
        documents: analyses.map((a) => a.docTitle),
      },
      summary: combinedSummary,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "标书分析失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "tender_analysis",
  name: "标书分析",
  domain: "analysis",
  tier: "analysis",
  version: "1.0.0",
  description:
    "深度分析招标文件/RFP，提取产品规格、测试要求、时间线、评分体系，输出面向老板决策的结构化报告",
  actions: ["analyze_tender", "extract_specs", "evaluate_feasibility"],
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: { projectId: "string" },
  outputSchema: {
    analyzed: "number",
    documents: "string[]",
  },
  dependsOn: ["document_summary"],
  expertRoleId: "bid_analyst",
  execute,
});
