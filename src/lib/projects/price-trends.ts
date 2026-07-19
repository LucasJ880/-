/**
 * 组织内历史价格趋势（按项目时间轴）
 */

import { db } from "@/lib/db";
import { computePriceGap } from "@/lib/projects/price-gap";

export type PriceTrendPoint = {
  projectId: string;
  name: string;
  date: string;
  ourBidPrice: number | null;
  winningBidPrice: number | null;
  currency: string | null;
  tenderStatus: string | null;
  clientOrganization: string | null;
  winningAsPctOfOurs: number | null;
  oursPremiumPctVsWinning: number | null;
};

export async function getOrgPriceTrends(input: {
  orgId: string;
  limit?: number;
}): Promise<{
  points: PriceTrendPoint[];
  avgWinningAsPctOfOurs: number | null;
  avgOursPremiumPct: number | null;
}> {
  const projects = await db.project.findMany({
    where: {
      orgId: input.orgId,
      OR: [
        { ourBidPrice: { not: null } },
        { winningBidPrice: { not: null } },
      ],
    },
    orderBy: [{ awardDate: "desc" }, { closeDate: "desc" }, { updatedAt: "desc" }],
    take: input.limit ?? 40,
    select: {
      id: true,
      name: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      tenderStatus: true,
      clientOrganization: true,
      awardDate: true,
      closeDate: true,
      createdAt: true,
    },
  });

  const points: PriceTrendPoint[] = projects.map((p) => {
    const gap = computePriceGap({
      ourBidPrice: p.ourBidPrice,
      winningBidPrice: p.winningBidPrice,
      currency: p.currency,
    });
    const date = (p.awardDate || p.closeDate || p.createdAt).toISOString();
    return {
      projectId: p.id,
      name: p.name,
      date,
      ourBidPrice: p.ourBidPrice,
      winningBidPrice: p.winningBidPrice,
      currency: p.currency,
      tenderStatus: p.tenderStatus,
      clientOrganization: p.clientOrganization,
      winningAsPctOfOurs: gap?.winningAsPctOfOurs ?? null,
      oursPremiumPctVsWinning: gap?.oursPremiumPctVsWinning ?? null,
    };
  });

  const pcts = points
    .map((p) => p.winningAsPctOfOurs)
    .filter((n): n is number => n != null);
  const premiums = points
    .map((p) => p.oursPremiumPctVsWinning)
    .filter((n): n is number => n != null);

  return {
    points,
    avgWinningAsPctOfOurs: pcts.length
      ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10
      : null,
    avgOursPremiumPct: premiums.length
      ? Math.round((premiums.reduce((a, b) => a + b, 0) / premiums.length) * 10) /
        10
      : null,
  };
}
