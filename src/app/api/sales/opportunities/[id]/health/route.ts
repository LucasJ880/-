import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { aggregateDealHealth } from "@/lib/sales/communication-analyzer";
import {
  resolveSalesOrgIdForRequest,
  resolveSalesScope,
} from "@/lib/sales/org-context";

export const GET = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const opp = await db.salesOpportunity.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: {
      id: true,
      stage: true,
      createdById: true,
      assignedToId: true,
      interactions: {
        where: { analysisResult: { not: Prisma.AnyNull } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { analysisResult: true, createdAt: true },
      },
    },
  });

  if (!opp) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const { ownOnly } = await resolveSalesScope(user, orgRes.orgId);
  if (
    ownOnly &&
    opp.createdById !== user.id &&
    opp.assignedToId !== user.id
  ) {
    return NextResponse.json({ error: "无权访问该机会" }, { status: 403 });
  }

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
