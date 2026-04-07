/**
 * 供应链分析 Skill — 融合跨境电商专家 + 供应商评估专家角色
 *
 * 基于项目信息和文档，分析供应链可行性、供应商风险、
 * 物流方案、合规要求和成本结构。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

const SUPPLY_CHAIN_PROMPT = `你是青砚的供应链与跨境贸易分析专家。

基于提供的项目信息，输出一份结构化的供应链可行性分析报告。

## 输出格式
返回纯 JSON，不要包含 markdown 代码块或其他文本。

{
  "feasibility": "high | medium | low",
  "feasibilityLabel": "一句话结论（15字以内）",
  "sourcingStrategy": "建议采购模式：中国直采 / 本地采购 / 混合模式",
  "supplierAssessment": {
    "existingSupplierCount": 0,
    "riskLevel": "low | medium | high",
    "singleSourceRisks": ["单一来源风险项"],
    "recommendations": ["供应商管理建议"]
  },
  "logistics": {
    "recommendedMode": "海运/空运/铁路/混合",
    "estimatedLeadTimeDays": 0,
    "costFactors": ["关键成本因素"],
    "risks": ["物流风险"]
  },
  "compliance": {
    "requiredCertifications": ["需要的认证"],
    "tariffConsiderations": "关税/贸易壁垒分析",
    "criticalIssues": ["致命合规问题"]
  },
  "costBreakdown": {
    "categories": [
      { "name": "成本类别", "percentage": "占比", "note": "说明" }
    ],
    "marginEstimate": "预估利润空间"
  },
  "actionItems": [
    { "action": "具体动作", "priority": "high|medium|low", "deadline": "建议时限" }
  ],
  "executiveSummary": "2-3句话总结，可直接转发给管理层"
}

## 分析原则
1. 供应商评估五维模型：质量(30%)、价格(25%)、交期(20%)、服务(15%)、创新(10%)
2. 物流全链路成本：头程 + 仓储 + 尾程 + 退货损耗 + 汇率波动
3. 合规是底线：没有认证的产品绝不推荐
4. 识别关键物料单一来源供应商，建议替代方案
5. 分析必须贴合中国供应链 / 北美项目落地的现实
6. 不同渠道（工厂直采/贸易商/平台采购）的优劣要明确对比
7. 区分"已知事实 / 推断 / 待确认项"`;

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const project = await db.project.findUnique({
      where: { id: ctx.projectId },
      select: {
        name: true,
        description: true,
        clientOrganization: true,
        category: true,
        closeDate: true,
        estimatedValue: true,
        currency: true,
        inquiries: {
          select: {
            title: true,
            scope: true,
            items: {
              select: {
                status: true,
                supplier: { select: { name: true, category: true, region: true, status: true } },
              },
            },
          },
          take: 5,
        },
        documents: {
          where: { aiSummaryStatus: "done" },
          select: { title: true, aiSummary: true },
          take: 5,
        },
      },
    });

    if (!project) {
      return { success: false, data: {}, summary: "项目不存在" };
    }

    const expertPrompt = getExpertSystemPrompt("supply_chain_analyst");

    const contextParts: string[] = [
      `## 项目信息`,
      `- 项目名称: ${project.name}`,
      `- 客户: ${project.clientOrganization ?? "未知"}`,
      `- 项目类别: ${project.category ?? "未知"}`,
      `- 截止日期: ${project.closeDate?.toISOString().slice(0, 10) ?? "未知"}`,
      `- 预估金额: ${project.estimatedValue ? `${project.currency ?? ""}${project.estimatedValue}` : "未知"}`,
    ];

    if (project.description) {
      contextParts.push("", "## 项目描述", project.description.slice(0, 2000));
    }

    const suppliers = project.inquiries.flatMap((inq) =>
      inq.items.map((item) => item.supplier)
    );
    const uniqueSuppliers = Array.from(
      new Map(suppliers.map((s) => [s.name, s])).values()
    );

    if (uniqueSuppliers.length > 0) {
      contextParts.push("", "## 现有供应商（来自询价记录）");
      for (const s of uniqueSuppliers) {
        contextParts.push(`- ${s.name}（${s.category ?? "未分类"}，${s.region ?? "未知地区"}，状态: ${s.status}）`);
      }
    }

    if (project.inquiries.length > 0) {
      contextParts.push("", "## 询价记录");
      for (const inq of project.inquiries) {
        contextParts.push(`- ${inq.title}: ${inq.scope ?? ""}`);
        const responded = inq.items.filter((i) => i.status === "responded").length;
        contextParts.push(`  已回复: ${responded}/${inq.items.length}`);
      }
    }

    if (project.documents.length > 0) {
      contextParts.push("", "## 文档摘要");
      for (const doc of project.documents) {
        contextParts.push(`### ${doc.title}`);
        if (doc.aiSummary && typeof doc.aiSummary === "object") {
          contextParts.push(JSON.stringify(doc.aiSummary).slice(0, 1500));
        }
      }
    }

    const userPrompt = contextParts.join("\n");

    const systemPrompt = expertPrompt
      ? `${SUPPLY_CHAIN_PROMPT}\n\n## 专家增强\n${expertPrompt}`
      : SUPPLY_CHAIN_PROMPT;

    const raw = await createCompletion({
      systemPrompt,
      userPrompt,
      mode: "normal",
      maxTokens: 4000,
    });

    let parsed: Record<string, unknown>;
    try {
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        success: true,
        data: { rawAnalysis: raw },
        summary: "供应链分析完成（非结构化输出）",
      };
    }

    return {
      success: true,
      data: parsed,
      summary: `供应链分析完成：${(parsed.feasibilityLabel as string) || (parsed.feasibility as string) || "已生成"}`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "供应链分析失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "supply_chain_analysis",
  name: "供应链分析",
  domain: "analysis",
  tier: "analysis",
  version: "1.0.0",
  description: "融合跨境电商专家和供应商评估专家角色，分析项目供应链可行性、供应商风险、物流方案、合规要求和成本结构",
  actions: ["analyze"],
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: { projectId: "string" },
  outputSchema: {
    feasibility: "high | medium | low",
    sourcingStrategy: "string",
    supplierAssessment: "object",
    logistics: "object",
    compliance: "object",
    costBreakdown: "object",
    actionItems: "array",
  },
  dependsOn: ["project_understanding"],
  execute,
});
