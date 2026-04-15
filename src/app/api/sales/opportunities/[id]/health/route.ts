import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { aggregateDealHealth } from "@/lib/sales/communication-analyzer";

export const GET = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;

  const opp = await db.salesOpportunity.findUnique({
    where: { id },
    select: {
      id: true,
      stage: true,
      interactions: {
        where: { analysisResult: { not: Prisma.AnyNull } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { analysisResult: true, createdAt: true },
      },
    },
  });

  if (!opp) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const analyses = opp.interactions
    .map((i) => {
      const result = i.analysisResult as Record<string, unknown> | null;
      if (!result || typeof result.dealHealthScore !== "number") return null;
      return { dealHealthScore: result.dealHealthScore as number, createdAt: i.createdAt };
    })
    .filter(Boolean) as Array<{ dealHealthScore: number; createdAt: Date }>;

  const healthScore = aggregateDealHealth(analyses);

  const latestAnalysis = opp.interactions[0]?.analysisResult as Record<string, unknown> | null;

  return NextResponse.json({
    healthScore,
    analysisCount: analyses.length,
    latestSentiment: latestAnalysis?.sentiment ?? null,
    latestIntent: latestAnalysis?.intent ?? null,
    suggestedNextAction: latestAnalysis?.suggestedNextAction ?? null,
    buyerSignals: latestAnalysis?.buyerSignals ?? [],
    riskSignals: latestAnalysis?.riskSignals ?? [],
  });
});
