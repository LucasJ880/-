/**
 * 文件 AI 结构化摘要 — 上传文件解析后自动调用
 *
 * 从 contentText 提取结构化信息（项目名、甲方、预算、技术要求等），
 * 存入 ProjectDocument.aiSummaryJson。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";

export interface DocumentAiSummary {
  documentType: string;
  title: string | null;
  issuingParty: string | null;
  projectName: string | null;
  budget: string | null;
  currency: string | null;
  keyDates: Array<{ label: string; date: string }>;
  technicalRequirements: string[];
  qualificationRequirements: string[];
  evaluationCriteria: Array<{ criterion: string; weight: string | null }>;
  scope: string | null;
  deliverables: string[];
  riskFlags: string[];
  summary: string;
}

const SUMMARY_SYSTEM_PROMPT = `你是青砚 AI 文档分析师。你的任务是从文档文本中提取关键结构化信息。

要求：
- 返回纯 JSON，不要包含 markdown 代码块或其他文本
- 所有字段用中文填写，日期用 YYYY-MM-DD 格式
- 无法确定的字段填 null 或空数组
- summary 字段用 2-3 句话概括文档核心内容
- documentType 从以下选一个：招标文件、报价请求、技术规格书、合同、采购订单、供应商资料、会议纪要、项目报告、价格表、其他

JSON 结构：
{
  "documentType": "文档类型",
  "title": "文档标题",
  "issuingParty": "发文方/甲方",
  "projectName": "项目名称",
  "budget": "预算金额（文本）",
  "currency": "币种",
  "keyDates": [{ "label": "日期说明", "date": "YYYY-MM-DD" }],
  "technicalRequirements": ["技术要求1", "技术要求2"],
  "qualificationRequirements": ["资质要求1"],
  "evaluationCriteria": [{ "criterion": "评分项", "weight": "权重" }],
  "scope": "项目范围概述",
  "deliverables": ["交付物1"],
  "riskFlags": ["风险提示1"],
  "summary": "2-3句话摘要"
}`;

function buildUserPrompt(fileName: string, contentText: string): string {
  const truncated = contentText.slice(0, 12000);
  const lines = [
    `文件名: ${fileName}`,
    "",
    "以下是文件的全文内容（可能已截断）：",
    "",
    truncated,
  ];
  if (contentText.length > 12000) {
    lines.push("", `...（原文共 ${contentText.length} 字，已截断至 12000 字）`);
  }
  lines.push("", "请提取结构化摘要，返回 JSON。");
  return lines.join("\n");
}

function tryParseJson(raw: string): DocumentAiSummary | null {
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
    return JSON.parse(cleaned) as DocumentAiSummary;
  } catch {
    return null;
  }
}

/**
 * 为已解析的文档生成 AI 结构化摘要，结果写入 aiSummaryJson。
 */
export async function generateDocumentSummary(documentId: string): Promise<void> {
  const doc = await db.projectDocument.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, contentText: true, parseStatus: true },
  });

  if (!doc || doc.parseStatus !== "done" || !doc.contentText) {
    return;
  }

  if (doc.contentText.length < 50) {
    await db.projectDocument.update({
      where: { id: documentId },
      data: { aiSummaryStatus: "done", aiSummaryJson: null },
    });
    return;
  }

  await db.projectDocument.update({
    where: { id: documentId },
    data: { aiSummaryStatus: "generating" },
  });

  try {
    const userPrompt = buildUserPrompt(doc.title, doc.contentText);
    const raw = await createCompletion({
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt,
      mode: "normal",
      maxTokens: 2000,
    });

    const parsed = tryParseJson(raw);
    if (!parsed) {
      await db.projectDocument.update({
        where: { id: documentId },
        data: { aiSummaryStatus: "failed", aiSummaryJson: null },
      });
      return;
    }

    await db.projectDocument.update({
      where: { id: documentId },
      data: {
        aiSummaryJson: JSON.stringify(parsed),
        aiSummaryStatus: "done",
      },
    });
  } catch (e) {
    console.error(`[AiSummary] ${documentId} 生成失败:`, e);
    await db.projectDocument.update({
      where: { id: documentId },
      data: { aiSummaryStatus: "failed" },
    });
  }
}
