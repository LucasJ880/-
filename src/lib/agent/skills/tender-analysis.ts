/**
 * 标书分析 Skill — 对项目关联的招标文档进行深度结构化分析
 *
 * 当项目文档中包含标书/招标文件时，自动提取关键信息并生成
 * 面向"老板决策"的结构化分析报告。
 *
 * QUALITY_FIRST：走 tender 角色（GPT-6 Astra），禁止逐 PDF 独立分析后拼接。
 */

import { createTenderCompletion } from "@/lib/ai/model-policy";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";
import { db } from "@/lib/db";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

const TENDER_FILE_KEYWORDS = [
  "tender", "bid", "rfp", "rfq", "solicitation",
  "标书", "招标", "投标", "采购",
  "procurement", "addendum", "specification",
];

const TENDER_SKILL_DISCIPLINE = `## HARD RULES（GPT-6 不得降低证据标准）
- 只陈述文档中的 CLAIM，并给出 EVIDENCE / SOURCE / CONFIDENCE。
- 无法证明时写 UNKNOWN，禁止用推断填补缺失的强制条件、认证或截止日期。
- 必须跨文档核对：RFP / SOW / Terms / Pricing / Technical / Addendum / Drawing / Spec / Appendix / Forms / Q&A。
- Addendum 必须标 ORIGINAL / SUPERSEDED / MODIFIED / NEW / UNCHANGED；后发布有效补遗优先。
- 识别 conflict / duplicate / override / dependency / missing form / cross-reference。
- 不要逐份独立分析后简单拼接。先文档清单，再综合。`;

function isTenderDocument(title: string, content: string): boolean {
  const combined = (title + " " + content.slice(0, 2000)).toLowerCase();
  return TENDER_FILE_KEYWORDS.some((kw) => combined.includes(kw));
}

function guessDocRole(title: string): string {
  const t = title.toLowerCase();
  if (/\baddendum|amendment|补遗|修订\b/.test(t)) return "ADDENDUM";
  if (/\bsow|statement of work\b/.test(t)) return "SOW";
  if (/\bpricing|price form|报价\b/.test(t)) return "PRICING_FORM";
  if (/\bdrawing|图纸\b/.test(t)) return "DRAWING";
  if (/\bspec\b/.test(t)) return "SPECIFICATION";
  if (/\bform|mandatory\b/.test(t)) return "MANDATORY_FORM";
  if (/\bq&a|question\b/.test(t)) return "QA";
  if (/\bterms|conditions\b/.test(t)) return "TERMS";
  return "RFP";
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
      take: 8,
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
    const hasAddendum = tenderDocs.some((d) =>
      /addendum|amendment|补遗/i.test(d.title),
    );
    const stage =
      tenderDocs.length > 1
        ? hasAddendum
          ? "addendum"
          : "cross_document"
        : "understanding";

    let remaining = 100_000;
    const parts: string[] = [];
    for (const doc of tenderDocs) {
      if (remaining <= 0) break;
      const slice = doc.contentText!.slice(0, Math.min(remaining, 40_000));
      remaining -= slice.length;
      parts.push(
        `<document title="${doc.title}" role="${guessDocRole(doc.title)}">\n${slice}\n</document>`,
      );
    }

    const userPrompt = `请对以下招标文件包做一次跨文档综合分析（不要逐份独立分析后拼接）：

${parts.join("\n\n")}

必须输出：
1. 文档清单
2. 强制要求 / 资格 / 技术 / 商务 / 执行可行性
3. Addendum 对照（ORIGINAL / SUPERSEDED / MODIFIED / NEW / UNCHANGED）
4. 跨文档冲突、重复、覆盖、依赖、缺表、交叉引用
5. 证据不足处明确 UNKNOWN
6. Bid / No-Bid 输入材料（不代替人工决策）

请按照你的输出格式规范，输出结构化报告。`;

    const result = await createTenderCompletion({
      systemPrompt: `${expertPrompt}\n\n${TENDER_SKILL_DISCIPLINE}`,
      userPrompt,
      mode: "deep",
      maxTokens: 4096,
      tenderStage: stage,
      promptVersion: "tender-analysis-skill@2",
      userId: ctx.userId,
    });

    const summary = result.fallbackUsed
      ? `ANALYZED_WITH_FALLBACK_MODEL\n\n${result.content}`
      : result.content;

    return {
      success: true,
      data: {
        analyzed: tenderDocs.length,
        documents: tenderDocs.map((d) => d.title),
        analyzedWithFallbackModel: result.fallbackUsed,
        model: result.model,
        requestedModel: result.requestedModel,
      },
      summary,
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
  version: "1.1.0",
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
