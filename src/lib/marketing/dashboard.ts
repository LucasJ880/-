import { MARKETING_DIMENSIONS, clampScore } from "./constants";
import { calculateMarketingEconomics } from "./economics";

export interface DimensionScoreLike {
  dimension: string;
  score: number;
}

export const MARKETING_FUNNEL_STAGES = [
  { key: "impressions", label: "展示" },
  { key: "clicks", label: "点击" },
  { key: "leads", label: "线索" },
  { key: "qualifiedLeads", label: "有效线索" },
  { key: "appointments", label: "预约" },
  { key: "quotes", label: "报价" },
  { key: "wins", label: "成交" },
] as const;

export type MarketingFunnelKey = (typeof MARKETING_FUNNEL_STAGES)[number]["key"];

export interface MarketingFunnelStage {
  key: MarketingFunnelKey;
  label: string;
  value: number;
  conversionRate: number | null;
}

export interface MarketingFunnel {
  stages: MarketingFunnelStage[];
  bottleneck: {
    from: string;
    to: string;
    rate: number;
  } | null;
  inconsistent: boolean;
  economics: {
    spend: number;
    otherMarketingCost: number;
    totalMarketingCost: number;
    revenue: number;
    grossMarginRate: number | null;
    attributedGrossProfit: number | null;
    costPerLead: number | null;
    costPerQualifiedLead: number | null;
    costPerWin: number | null;
    roas: number | null;
    roi: number | null;
    breakEvenRoas: number | null;
    targetRoas: number | null;
    targetRoi: number | null;
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function unitCost(spend: number, count: number): number | null {
  if (spend <= 0 || count <= 0) return null;
  return Math.round((spend / count) * 100) / 100;
}

export function buildMarketingFunnel(
  input: Record<MarketingFunnelKey, number> & {
    spend: number;
    otherMarketingCost?: number;
    revenue: number;
    grossMarginRate?: number | null;
    targetRoas?: number | null;
    targetRoi?: number | null;
  },
): MarketingFunnel {
  let previous: MarketingFunnelStage | null = null;
  let inconsistent = false;
  const stages = MARKETING_FUNNEL_STAGES.map(({ key, label }) => {
    const value = nonNegative(input[key]);
    if (previous && value > previous.value) inconsistent = true;
    const stage: MarketingFunnelStage = {
      key,
      label,
      value,
      conversionRate: previous ? ratio(value, previous.value) : null,
    };
    previous = stage;
    return stage;
  });
  const comparable = stages
    .slice(1)
    .map((stage, index) => ({ stage, previous: stages[index] }))
    .filter(
      (row): row is { stage: MarketingFunnelStage & { conversionRate: number }; previous: MarketingFunnelStage } =>
        row.stage.conversionRate !== null && row.stage.value <= row.previous.value,
    )
    .sort((a, b) => a.stage.conversionRate - b.stage.conversionRate);
  const weakest = comparable[0] ?? null;
  const spend = nonNegative(input.spend);
  const revenue = nonNegative(input.revenue);
  const economics = calculateMarketingEconomics({
    revenue,
    adSpend: spend,
    otherMarketingCost: input.otherMarketingCost,
    grossMarginRate: input.grossMarginRate,
  });

  return {
    stages,
    bottleneck: weakest
      ? {
          from: weakest.previous.label,
          to: weakest.stage.label,
          rate: weakest.stage.conversionRate,
        }
      : null,
    inconsistent,
    economics: {
      spend,
      otherMarketingCost: economics.otherMarketingCost,
      totalMarketingCost: economics.totalMarketingCost,
      revenue,
      grossMarginRate: economics.grossMarginRate,
      attributedGrossProfit: economics.attributedGrossProfit == null
        ? null
        : Math.round(economics.attributedGrossProfit * 100) / 100,
      costPerLead: unitCost(spend, nonNegative(input.leads)),
      costPerQualifiedLead: unitCost(spend, nonNegative(input.qualifiedLeads)),
      costPerWin: unitCost(spend, nonNegative(input.wins)),
      roas: economics.roas == null ? null : Math.round(economics.roas * 100) / 100,
      roi: economics.roi == null ? null : Math.round(economics.roi * 10000) / 10000,
      breakEvenRoas: economics.breakEvenRoas == null
        ? null
        : Math.round(economics.breakEvenRoas * 100) / 100,
      targetRoas: input.targetRoas == null ? null : nonNegative(input.targetRoas),
      targetRoi: input.targetRoi == null ? null : nonNegative(input.targetRoi),
    },
  };
}

export interface MarketingDecision {
  id: string;
  priority: "urgent" | "high" | "medium";
  title: string;
  reason: string;
  href: string;
  action: string;
}

export function buildMarketingDecisionQueue(input: {
  hasValidProfile: boolean;
  metricSnapshotCount: number;
  unverifiedSnapshotCount: number;
  activeCampaigns: number;
  campaignsAwaitingApproval: number;
  runningExperiments: number;
  pendingApprovals: number;
  funnel: MarketingFunnel;
}): MarketingDecision[] {
  const decisions: MarketingDecision[] = [];
  if (!input.hasValidProfile) {
    decisions.push({
      id: "brand-truth",
      priority: "urgent",
      title: "先确认企业事实",
      reason: "地域、产品、目标客户与禁用表述尚未形成可靠营销边界。",
      href: "/operations/growth/brand",
      action: "完善企业事实",
    });
  }
  if (input.metricSnapshotCount === 0) {
    decisions.push({
      id: "measurement",
      priority: "urgent",
      title: "接入首批渠道数据",
      reason: "当前无法判断线索质量、获客成本或成交贡献。",
      href: "/operations/growth/metrics",
      action: "连接或录入数据",
    });
  } else if (input.unverifiedSnapshotCount > 0) {
    decisions.push({
      id: "data-quality",
      priority: "high",
      title: "核对营销数据口径",
      reason: `${input.unverifiedSnapshotCount} 条数据仍未验证，暂不适合据此扩大预算。`,
      href: "/operations/growth/metrics",
      action: "检查数据质量",
    });
  }
  if (input.pendingApprovals > 0) {
    decisions.push({
      id: "approvals",
      priority: "high",
      title: "处理待审批营销计划",
      reason: `${input.pendingApprovals} 项计划正在等待确认，执行链路尚未启动。`,
      href: "/operations/growth",
      action: "查看审批",
    });
  }
  if (input.funnel.bottleneck && input.metricSnapshotCount > 0) {
    decisions.push({
      id: "bottleneck",
      priority: "high",
      title: `优先修复${input.funnel.bottleneck.from} → ${input.funnel.bottleneck.to}`,
      reason: `本月该环节转化率为 ${input.funnel.bottleneck.rate}%，是当前可观测漏斗中最低的一环。`,
      href: "/operations/growth/experiments",
      action: "设计验证实验",
    });
  }
  if (input.activeCampaigns === 0 && input.campaignsAwaitingApproval === 0) {
    decisions.push({
      id: "campaign",
      priority: "high",
      title: "建立第一个可归因活动",
      reason: "建议只选一个产品、一个地域、一个 Offer 和一个主要转化。",
      href: "/operations/growth/campaigns",
      action: "创建活动",
    });
  } else if (input.activeCampaigns > 0 && input.runningExperiments === 0) {
    decisions.push({
      id: "experiment",
      priority: "medium",
      title: "为活跃活动建立单变量实验",
      reason: "活动已存在，但还没有可复盘的创意或 Offer 对照。",
      href: "/operations/growth/experiments",
      action: "创建实验",
    });
  }
  return decisions.slice(0, 3);
}

export function calculateMarketPresence(scores: DimensionScoreLike[]): number | null {
  const byDimension = new Map(scores.map((row) => [row.dimension, clampScore(row.score)]));
  const available = MARKETING_DIMENSIONS.map((dimension) => byDimension.get(dimension)).filter(
    (score): score is number => score !== undefined,
  );
  if (available.length === 0) return null;
  return Math.round(available.reduce((sum, score) => sum + score, 0) / available.length);
}

export function calculateGrowthExecution(input: {
  published: number;
  experiments: number;
  qualifiedLeads: number;
  wins: number;
  pendingReview: number;
}): number {
  const publishing = Math.min(30, input.published * 3);
  const experiments = Math.min(20, input.experiments * 5);
  const leads = Math.min(25, input.qualifiedLeads * 2.5);
  const wins = Math.min(25, input.wins * 8);
  const approvalPenalty = Math.min(10, input.pendingReview * 2);
  return clampScore(publishing + experiments + leads + wins - approvalPenalty);
}
