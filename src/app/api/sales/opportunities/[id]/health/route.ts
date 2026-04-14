import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aggregateDealHealth } from "@/lib/sales/communication-analyzer";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
}
