/**
 * Revenue Spine — FDE Revenue Attribution V1（PART 11）
 *
 * fdeSourced   = 商机由 AI 主动发现（trade_intelligence / outbound 由 FDE 创建）
 * fdeInfluenced = AI 对该商机执行过至少一个有效 revenue action（已执行的 FDE SalesAction）
 */

import { db } from "@/lib/db";
import { OPEN_STAGES, QUALIFIED_PIPELINE_STAGES } from "./opportunity-stage";

export async function markFdeTouch(input: {
  orgId: string;
  opportunityId: string;
  salesActionId: string;
  sourced?: boolean;
}): Promise<void> {
  const opp = await db.salesOpportunity.findFirst({
    where: { id: input.opportunityId, orgId: input.orgId },
    select: { firstFdeActionId: true },
  });
  if (!opp) return;
  await db.salesOpportunity.update({
    where: { id: input.opportunityId },
    data: {
      fdeInfluenced: true,
      ...(input.sourced ? { fdeSourced: true } : {}),
      firstFdeActionId: opp.firstFdeActionId ?? input.salesActionId,
      lastFdeActionId: input.salesActionId,
    },
  });
}

export interface FdeAttributionMetrics {
  fdeSourcedCount: number;
  fdeSourcedPipeline: number;
  fdeInfluencedCount: number;
  fdeInfluencedPipeline: number;
  fdeInfluencedWonCount: number;
  fdeInfluencedRevenue: number;
  /** 无真实成本数据 → null（接口已定义） */
  fdeInfluencedGrossProfit: number | null;
}

export async function computeFdeAttribution(orgId: string): Promise<FdeAttributionMetrics> {
  const open = [...OPEN_STAGES];
  const qualified = [...QUALIFIED_PIPELINE_STAGES];
  const [sourcedOpen, influencedOpen, influencedWon] = await Promise.all([
    db.salesOpportunity.aggregate({
      where: { orgId, fdeSourced: true, stage: { in: open } },
      _count: { id: true },
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.aggregate({
      where: { orgId, fdeInfluenced: true, stage: { in: qualified } },
      _count: { id: true },
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.aggregate({
      where: { orgId, fdeInfluenced: true, stage: "won" },
      _count: { id: true },
      _sum: { estimatedValue: true },
    }),
  ]);
  return {
    fdeSourcedCount: sourcedOpen._count.id,
    fdeSourcedPipeline: sourcedOpen._sum.estimatedValue ?? 0,
    fdeInfluencedCount: influencedOpen._count.id,
    fdeInfluencedPipeline: influencedOpen._sum.estimatedValue ?? 0,
    fdeInfluencedWonCount: influencedWon._count.id,
    fdeInfluencedRevenue: influencedWon._sum.estimatedValue ?? 0,
    fdeInfluencedGrossProfit: null,
  };
}
