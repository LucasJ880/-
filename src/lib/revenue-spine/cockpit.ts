/**
 * Revenue Spine — Revenue Cockpit 指标（PART 12）
 */

import { db } from "@/lib/db";
import { EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES } from "@/lib/organizations/onboarding-rules";
import { computeFdeAttribution, type FdeAttributionMetrics } from "./attribution";
import { OPEN_STAGES, QUALIFIED_PIPELINE_STAGES } from "./opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "./policy";
import { buildRevenueQueue, type RevenueQueue } from "./daily-actions";

export interface RevenueCockpit {
  generatedAt: string;
  currency: string;
  metrics: {
    qualifiedPipeline: { count: number; value: number };
    quotesOutstanding: { count: number; value: number };
    hotLeads: number;
    followUpsDue: number;
    samplesInProgress: number;
    expectedRevenue: number;
    wonRevenue: { count: number; value: number; thisMonthCount: number; thisMonthValue: number };
    fdeSourcedPipeline: number;
    fdeInfluencedPipeline: number;
    fdeInfluencedRevenue: number;
    grossProfit: { status: "unavailable"; reason: string } | { status: "available"; value: number };
    openOpportunities: number;
  };
  attribution: FdeAttributionMetrics;
  stageCounts: Array<{ stage: string; count: number; value: number }>;
  todayActions: RevenueQueue["counts"];
  queue: RevenueQueue;
}

export async function computeRevenueCockpit(orgId: string, opts?: { policy?: RevenueSpinePolicy; now?: Date }): Promise<RevenueCockpit> {
  const now = opts?.now ?? new Date();
  const policy = opts?.policy ?? (await loadRevenueSpinePolicy(orgId));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [stageGroups, qualified, quotes, samples, won, wonMonth, attribution, queue, openRows] = await Promise.all([
    // 阶段分布不含入驻测试单（测试单已 disqualified，其余指标按阶段本来就排除）
    db.salesOpportunity.groupBy({
      by: ["stage"],
      where: { orgId, AND: [EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES] },
      _count: { id: true },
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.aggregate({ where: { orgId, stage: { in: [...QUALIFIED_PIPELINE_STAGES] } }, _count: { id: true }, _sum: { estimatedValue: true } }),
    db.salesOpportunity.aggregate({ where: { orgId, stage: { in: ["quoted", "follow_up"] } }, _count: { id: true }, _sum: { estimatedValue: true } }),
    db.salesOpportunity.count({ where: { orgId, stage: "sample" } }),
    db.salesOpportunity.aggregate({ where: { orgId, stage: "won" }, _count: { id: true }, _sum: { estimatedValue: true } }),
    db.salesOpportunity.aggregate({ where: { orgId, stage: "won", wonAt: { gte: monthStart } }, _count: { id: true }, _sum: { estimatedValue: true } }),
    computeFdeAttribution(orgId),
    buildRevenueQueue(orgId, { policy, now, limit: 20 }),
    db.salesOpportunity.findMany({ where: { orgId, stage: { in: [...OPEN_STAGES] } }, select: { stage: true, estimatedValue: true } }),
  ]);
  const expectedRevenue = openRows.reduce((sum, r) => sum + (r.estimatedValue ?? 0) * (policy.stageWinProbability[r.stage] ?? 0), 0);
  return {
    generatedAt: now.toISOString(),
    currency: policy.businessProfile.defaultCurrency,
    metrics: {
      qualifiedPipeline: { count: qualified._count.id, value: qualified._sum.estimatedValue ?? 0 },
      quotesOutstanding: { count: quotes._count.id, value: quotes._sum.estimatedValue ?? 0 },
      hotLeads: queue.counts.hotLeads,
      followUpsDue: queue.counts.followUpsDue,
      samplesInProgress: samples,
      expectedRevenue: Math.round(expectedRevenue * 100) / 100,
      wonRevenue: {
        count: won._count.id,
        value: won._sum.estimatedValue ?? 0,
        thisMonthCount: wonMonth._count.id,
        thisMonthValue: wonMonth._sum.estimatedValue ?? 0,
      },
      fdeSourcedPipeline: attribution.fdeSourcedPipeline,
      fdeInfluencedPipeline: attribution.fdeInfluencedPipeline,
      fdeInfluencedRevenue: attribution.fdeInfluencedRevenue,
      grossProfit: { status: "unavailable", reason: "cost basis not connected (V2 Quotation Engineer)" },
      openOpportunities: openRows.length,
    },
    attribution,
    stageCounts: stageGroups.map((g) => ({ stage: g.stage, count: g._count.id, value: g._sum.estimatedValue ?? 0 })),
    todayActions: queue.counts,
    queue,
  };
}
