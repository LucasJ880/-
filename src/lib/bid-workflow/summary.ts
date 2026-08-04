import type { ModuleStatus } from "./constants";

type ProjectLike = {
  name: string;
  clientOrganization: string | null;
  solicitationNumber: string | null;
  closeDate: Date | null;
  estimatedValue: number | null;
  currency: string | null;
  description: string | null;
  aiAdviceStatus: string | null;
  intelligence: {
    summary: string | null;
    structuredSummaryJson: string | null;
    recommendation: string | null;
    riskLevel: string | null;
  } | null;
  documents: Array<{ title: string; aiSummaryJson: string | null }>;
};

export type InitialSummary = {
  text: string;
  status: ModuleStatus;
  json: Record<string, unknown>;
};

export function buildInitialSummary(project: ProjectLike): InitialSummary {
  let structured: Record<string, unknown> = {};
  if (project.intelligence?.structuredSummaryJson) {
    try {
      structured = JSON.parse(project.intelligence.structuredSummaryJson) as Record<
        string,
        unknown
      >;
    } catch {
      structured = {};
    }
  }

  const product =
    (typeof structured.productCategory === "string" && structured.productCategory) ||
    (typeof structured.category === "string" && structured.category) ||
    null;

  const blockers: string[] = [];
  if (!project.documents.length) blockers.push("尚未上传招标文件");
  if (!project.clientOrganization) blockers.push("采购机构未确认");
  if (!project.closeDate) blockers.push("提交截止日期未知");

  const status: ModuleStatus =
    blockers.length >= 2 ? "risk" : blockers.length === 1 ? "investigating" : "unknown";

  const text = [
    `项目「${project.name}」`,
    project.clientOrganization ? `采购方：${project.clientOrganization}` : "采购方：暂时未知",
    product ? `产品/服务：${product}` : "产品/服务：调查中",
    project.solicitationNumber
      ? `Tender：${project.solicitationNumber}`
      : "Tender Number：暂时未知",
    project.closeDate
      ? `截止：${project.closeDate.toISOString().slice(0, 10)}`
      : "截止：暂时未知",
    project.intelligence?.recommendation
      ? `情报建议：${project.intelligence.recommendation}`
      : "情报建议：待分析",
    blockers.length ? `阻塞：${blockers.join("；")}` : "当前无明显文件阻塞",
  ].join("。");

  return {
    text,
    status,
    json: {
      oneLiner: text,
      procuringAgency: project.clientOrganization,
      product,
      projectType: structured.projectType ?? null,
      possiblyRecurring: structured.possiblyRecurring ?? null,
      previousWinner: structured.previousWinner ?? null,
      historicalContractValue: structured.historicalContractValue ?? null,
      estimatedValue: project.estimatedValue,
      currency: project.currency,
      recommendation: project.intelligence?.recommendation ?? project.aiAdviceStatus,
      majorBlockers: blockers,
      recentChanges: [] as string[],
      projectType: structured.projectType ?? null,
      nextActions: [
        "完善项目理解模块",
        "开展历史中标调查",
        "匹配国内供应商",
        "准备 Go/Hold/No-Go 人工决定",
      ],
      documentCount: project.documents.length,
    },
  };
}
