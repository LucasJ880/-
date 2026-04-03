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

const SYSTEM_PROMPT = `你是青砚 AI 招标情报高级分析师，服务于一家中国出口型企业（产品制造+海外安装能力）。
你的任务是基于项目招标文档，生成一份**可直接用于投标决策**的深度情报分析报告。

## 公司背景（用于匹配度评估）
- 中国制造企业，具备产品出口和海外项目安装能力
- 主要市场：北美（加拿大、美国）政府采购与商业项目
- 优势：产品种类齐全、价格竞争力强、定制化能力
- 供应链：中国生产 → 海运（60-90天）→ 北美仓库/直送

## 输出要求
返回纯 JSON，不要包含 markdown 代码块。

## JSON 结构
{
  "recommendation": "pursue | review_carefully | low_probability | skip",
  "riskLevel": "low | medium | high",
  "fitScore": 0-100,
  "summary": "2-3句话的核心决策建议（以'建议投标/审慎评估/建议放弃'开头）",
  "reportMarkdown": "完整的12章节分析报告（Markdown格式，见下方要求）",
  "fullReport": {
    "title": "招标情报分析报告",
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

## recommendation 判定标准
- pursue: 项目要求明确，我方能力匹配度高，利润空间合理
- review_carefully: 有一定机会但存在不确定因素，需进一步评估
- low_probability: 匹配度偏低或竞争激烈
- skip: 明显不适合或风险过高

## fitScore 加权评估维度
- 产品/技术匹配度 (25%)
- 资质合规性 (20%)
- 时间可行性 (15%)
- 价格竞争力 (15%)
- 合规风险 (15%)
- 中标概率 (10%)

## reportMarkdown 必须包含以下12个章节（每个章节都要有实质内容）

### 一、一句话结论
以"建议投标/审慎评估/建议放弃"开头，一句话概括核心判断。

### 二、项目概述与采购背景
- 发标机构介绍与采购背景
- 合同类型（一次性/框架协议/多年期）
- 预估合同总金额范围
- 历史采购模式分析

### 三、需求范围逐项深度分析
- 产品名称与规格（逐项列出）
- 安装与服务范围
- 质保条款
- 培训要求

### 四、技术要求逐条评估
用表格形式，每行包含：要求项 | 原文引用 | 我司满足情况(✅/⚠️/❌) | 需要准备的事项

### 五、时间线与关键日期全景分析
列出所有关键日期，计算距今天数。分析从中国采购+海运+清关的全流程时间是否匹配。

### 六、评标标准与得分最大化策略
- 分析评标维度和权重
- 针对每个评分维度的建议策略
- 报价策略建议

### 七、我司匹配度详细评估
用评分表格：评估维度 | 得分(1-5) | 详细说明。维度包括：产品匹配度、安装能力、项目经验、资质合规、财务能力、供应链可靠性。

### 八、合规风险与致命红线
- 用⚠️标注致命风险（不满足即出局的条件）
- 每个风险给出应对策略

### 九、供应链与中国采购可行性分析
- Buy America / Buy Canadian 条款分析
- 海运周期与项目交付匹配度
- 关税与进口成本评估
- 供应链模式建议

### 十、竞争格局与差异化策略
- 可能的竞争对手分析
- 我司优劣势对比
- 差异化卖点建议

### 十一、GO/NO-GO 决策矩阵
表格形式：评估维度 | 权重 | 评分(1-5) | 加权分 | 关键说明。最后给出综合加权总分和决策建议。

### 十二、投标团队行动清单
表格形式：# | 待办事项 | 负责人建议 | 截止日期 | 优先级(🔴高/🟡中/🟢低) | 预计工时`;

function buildUserPrompt(
  projectName: string,
  projectDesc: string | null,
  documents: Array<{ title: string; aiSummaryJson: string | null; contentText: string | null }>
): string {
  const lines = [`项目名称: ${projectName}`];
  if (projectDesc) lines.push(`项目描述: ${projectDesc}`);
  lines.push("", "以下是项目相关文档的内容：", "");

  let budget = 30000;
  for (const doc of documents) {
    lines.push(`### 文档: ${doc.title}`);
    if (doc.aiSummaryJson) {
      lines.push("AI 结构化摘要:");
      lines.push(doc.aiSummaryJson);
    }
    if (doc.contentText) {
      const maxSnippet = Math.min(doc.contentText.length, 10000);
      const snippet = doc.contentText.slice(0, maxSnippet);
      lines.push("原文摘录:");
      lines.push(snippet);
      if (doc.contentText.length > maxSnippet) {
        lines.push(`...（已截断，原文共 ${doc.contentText.length} 字）`);
      }
    }
    lines.push("");
    budget -= (doc.aiSummaryJson?.length ?? 0) + Math.min(doc.contentText?.length ?? 0, 10000);
    if (budget <= 0) break;
  }

  lines.push("请基于以上文档生成完整的12章节招标情报分析报告。");
  lines.push("要求：每个章节都要有实质性内容，技术评估和决策矩阵要用表格，行动清单要具体到负责部门和预计工时。");
  lines.push("返回纯 JSON。");
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
      maxTokens: 10000,
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
