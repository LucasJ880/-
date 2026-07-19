/**
 * 从现有 Intelligence + 项目字段构建/刷新结构化摘要卡
 */

import { db } from "@/lib/db";
import {
  type AiAdviceStatus,
  type ProjectTypeTag,
  type StructuredProjectSummary,
  mapRecommendationToAdvice,
  PROJECT_TYPE_TAGS,
} from "@/lib/projects/ai-summary-types";

function detectProjectTypes(text: string): ProjectTypeTag[] {
  const t = text.toLowerCase();
  const types: ProjectTypeTag[] = [];
  if (/long.?term|multi.?year|年度|长期|blanket|standing offer/.test(t)) {
    types.push("long_term_supply");
  }
  if (/install|installation|shop drawing|现场|安装|脚手架|lift/.test(t)) {
    types.push("install");
  }
  if (
    /china|chinese|overseas|海外|中国|进口|关税|customs|manufactur/.test(t)
  ) {
    types.push("china_sourcing");
  }
  if (/custom|定制|made.to.order|非标/.test(t)) {
    types.push("custom_manufacture");
  }
  if (types.length === 0) types.push("standard_supply");
  return types.filter((x, i, arr) => arr.indexOf(x) === i);
}

export async function refreshStructuredSummary(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      aiAdviceStatus: true,
      projectTypes: true,
      intelligence: true,
      documents: {
        take: 8,
        select: { title: true, contentText: true, aiSummaryJson: true },
      },
      _count: { select: { similaritiesAsSource: true } },
    },
  });
  if (!project?.intelligence) return null;

  const corpus = [
    project.name,
    project.description,
    project.intelligence.summary,
    project.intelligence.reportMarkdown,
    ...project.documents.map(
      (d) => `${d.title} ${d.aiSummaryJson || ""} ${d.contentText?.slice(0, 800) || ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const detected = detectProjectTypes(corpus);
  const existingTypes = Array.isArray(project.projectTypes)
    ? (project.projectTypes as string[]).filter((t): t is ProjectTypeTag =>
        (PROJECT_TYPE_TAGS as readonly string[]).includes(t),
      )
    : [];
  const projectTypes = existingTypes.length ? existingTypes : detected;

  const advice: AiAdviceStatus =
    (project.aiAdviceStatus as AiAdviceStatus) ||
    mapRecommendationToAdvice(project.intelligence.recommendation);

  let full: Record<string, unknown> = {};
  try {
    full = project.intelligence.fullReportJson
      ? (JSON.parse(project.intelligence.fullReportJson) as Record<string, unknown>)
      : {};
  } catch {
    full = {};
  }

  const strengths = Array.isArray(full.strengths)
    ? (full.strengths as string[])
    : [];
  const weaknesses = Array.isArray(full.weaknesses)
    ? (full.weaknesses as string[])
    : [];
  const gaps = Array.isArray(full.requirements_gap)
    ? (full.requirements_gap as string[])
    : [];

  const structured: StructuredProjectSummary = {
    version: 1,
    aiAdviceStatus: advice,
    projectTypes,
    currentAdvice:
      project.intelligence.summary ||
      `建议：${advice}；风险 ${project.intelligence.riskLevel}`,
    biggestOpportunity: strengths[0] || full.pricing_guidance?.toString() || null,
    biggestRisk: weaknesses[0] || null,
    missingInfo: gaps.slice(0, 8),
    nextSteps: gaps.slice(0, 3).map((g) => `确认：${g}`),
    similarCount: project._count.similaritiesAsSource,
    baseAnalysis: {
      procurement: full.description || project.description || null,
      eligibility: full.requirements_met || [],
      chinaSourcingPossible: projectTypes.includes("china_sourcing"),
      installRequired: projectTypes.includes("install"),
      recommendation: project.intelligence.recommendation,
      riskLevel: project.intelligence.riskLevel,
      fitScore: project.intelligence.fitScore,
    },
    sections: {},
    updatedAt: new Date().toISOString(),
  };

  if (projectTypes.includes("long_term_supply")) {
    structured.sections.longTermSupply = {
      quantityGuaranteed: "待确认",
      priceLockRisk: "待确认",
      stockAdvice: "数量不保证时不建议提前备货",
      conclusion: "适合收到订单后采购，除非合同保证用量",
    };
  }
  if (projectTypes.includes("install")) {
    structured.sections.install = {
      ourScope: ["待确认产品供货范围"],
      ownerScope: ["待确认现场基层/电源"],
      otherTrades: ["待确认"],
      pendingScope: ["现场测量", "Shop Drawing", "Warranty"],
      maxInstallRisk: weaknesses[0] || "图纸与现场差异 / 延误罚款",
    };
  }
  if (projectTypes.includes("china_sourcing")) {
    structured.sections.chinaSourcing = {
      overseasAllowed: "待确认是否限制 Canadian Goods/Supplier",
      conclusion: "信息不足时标注待确认，不可默认中国采购可行",
      options: [
        "可以直接中国采购",
        "可以中国制造但需加拿大认证",
        "组件进口加拿大组装",
        "建议北美采购",
        "不适合中国采购",
      ],
    };
  }

  await db.projectIntelligence.update({
    where: { projectId },
    data: { structuredSummaryJson: JSON.stringify(structured) },
  });

  await db.project.update({
    where: { id: projectId },
    data: {
      projectTypes,
      ...(project.aiAdviceStatus ? {} : { aiAdviceStatus: advice }),
    },
  });

  return structured;
}
