/**
 * 项目 AI 情报分析 — 基于上传文件自动生成
 *
 * 从项目所有文档的 AI 摘要 + 原始内容中，生成完整的情报分析报告，
 * 写入 ProjectIntelligence（与 BidToGo 同一张表，统一展示）。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";

interface IntelligenceResult {
  recommendation: string;
  riskLevel: string;
  fitScore: number;
  summary: string;
  reportMarkdown: string;
  fullReportJson: string;
}

const SYSTEM_PROMPT = `你是青砚 AI 情报分析师。基于项目文档内容，生成一份完整的项目情报分析报告。

输出要求：返回纯 JSON，不要包含 markdown 代码块。

JSON 结构：
{
  "recommendation": "pursue | review_carefully | low_probability | skip",
  "riskLevel": "low | medium | high",
  "fitScore": 0-100,
  "summary": "2-3句话的项目核心评估",
  "reportMarkdown": "完整的分析报告（Markdown 格式，包含以下部分）",
  "fullReport": {
    "title": "项目情报分析报告",
    "description": "项目概述",
    "strengths": ["优势1", "优势2"],
    "weaknesses": ["风险/劣势1"],
    "requirements_met": ["已满足的要求"],
    "requirements_gap": ["需补充的要求"],
    "competitive_landscape": "竞争格局分析",
    "pricing_guidance": "定价建议",
    "timeline_notes": "时间线与交付要求"
  }
}

recommendation 判定标准：
- pursue: 项目要求明确，我方能力匹配度高，利润空间合理
- review_carefully: 有一定机会但存在不确定因素，需进一步评估
- low_probability: 匹配度偏低或竞争激烈
- skip: 明显不适合或风险过高

fitScore 评估维度：
- 技术能力匹配度 (30%)
- 资质要求符合度 (20%)
- 时间可行性 (20%)
- 利润空间 (15%)
- 竞争态势 (15%)

reportMarkdown 应包含：
## 项目概述
## 需求分析
## 能力匹配评估
## 风险与挑战
## 竞争分析
## 定价建议
## 时间线分析
## 行动建议`;

function buildUserPrompt(
  projectName: string,
  projectDesc: string | null,
  documents: Array<{ title: string; aiSummaryJson: string | null; contentText: string | null }>
): string {
  const lines = [`项目名称: ${projectName}`];
  if (projectDesc) lines.push(`项目描述: ${projectDesc}`);
  lines.push("", "以下是项目相关文档的内容：", "");

  let budget = 10000;
  for (const doc of documents) {
    lines.push(`### 文档: ${doc.title}`);
    if (doc.aiSummaryJson) {
      lines.push("AI 结构化摘要:");
      lines.push(doc.aiSummaryJson);
    }
    if (doc.contentText) {
      const snippet = doc.contentText.slice(0, 6000);
      lines.push("原文摘录:");
      lines.push(snippet);
      if (doc.contentText.length > 6000) {
        lines.push(`...（已截断，原文共 ${doc.contentText.length} 字）`);
      }
    }
    lines.push("");
    budget -= (doc.aiSummaryJson?.length ?? 0) + Math.min(doc.contentText?.length ?? 0, 6000);
    if (budget <= 0) break;
  }

  lines.push("请基于以上文档生成完整的项目情报分析报告。返回 JSON。");
  return lines.join("\n");
}

function tryParseJson(raw: string): IntelligenceResult | null {
  let cleaned = raw.trim();
  const fenceStart = cleaned.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = cleaned.indexOf("\n", fenceStart);
    const fenceEnd = cleaned.lastIndexOf("```");
    if (afterFence !== -1 && fenceEnd > afterFence) {
      cleaned = cleaned.slice(afterFence + 1, fenceEnd).trim();
    }
  }
  try {
    const parsed = JSON.parse(cleaned);
    return {
      recommendation: parsed.recommendation || "review_carefully",
      riskLevel: parsed.riskLevel || "medium",
      fitScore: Math.min(100, Math.max(0, Number(parsed.fitScore) || 50)),
      summary: parsed.summary || "",
      reportMarkdown: parsed.reportMarkdown || "",
      fullReportJson: parsed.fullReport ? JSON.stringify(parsed.fullReport) : "{}",
    };
  } catch {
    return null;
  }
}

const VALID_RECOMMENDATIONS = ["pursue", "review_carefully", "low_probability", "skip"];
const VALID_RISK_LEVELS = ["low", "medium", "high"];

/**
 * 为项目生成/更新 AI 情报分析。
 * 会读取项目所有已解析文档的内容和摘要，调用 LLM 生成报告。
 */
export async function generateProjectIntelligence(projectId: string): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      documents: {
        where: { parseStatus: "done" },
        select: { title: true, contentText: true, aiSummaryJson: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      },
    },
  });

  if (!project) return;

  const docsWithContent = project.documents.filter(
    (d) => d.contentText || d.aiSummaryJson
  );
  if (docsWithContent.length === 0) return;

  try {
    const userPrompt = buildUserPrompt(project.name, project.description, docsWithContent);
    const raw = await createCompletion({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      mode: "normal",
      maxTokens: 4000,
    });

    const result = tryParseJson(raw);
    if (!result) {
      console.error(`[AiIntelligence] ${projectId} JSON 解析失败`);
      return;
    }

    const recommendation = VALID_RECOMMENDATIONS.includes(result.recommendation)
      ? result.recommendation
      : "review_carefully";
    const riskLevel = VALID_RISK_LEVELS.includes(result.riskLevel)
      ? result.riskLevel
      : "medium";

    const existing = await db.projectIntelligence.findUnique({
      where: { projectId },
      select: { id: true },
    });

    if (existing) {
      await db.projectIntelligence.update({
        where: { projectId },
        data: {
          recommendation,
          riskLevel,
          fitScore: result.fitScore,
          summary: result.summary,
          reportMarkdown: result.reportMarkdown || null,
          fullReportJson: result.fullReportJson || null,
        },
      });
    } else {
      await db.projectIntelligence.create({
        data: {
          projectId,
          recommendation,
          riskLevel,
          fitScore: result.fitScore,
          summary: result.summary,
          reportMarkdown: result.reportMarkdown || null,
          fullReportJson: result.fullReportJson || null,
        },
      });
    }
  } catch (e) {
    console.error(`[AiIntelligence] ${projectId} 生成失败:`, e);
  }
}
