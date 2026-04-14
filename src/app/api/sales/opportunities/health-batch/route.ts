import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aggregateDealHealth } from "@/lib/sales/communication-analyzer";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const opportunities = await db.salesOpportunity.findMany({
    where: {
      stage: { notIn: ["completed", "lost"] },
      OR: [{ assignedToId: user.id }, { createdById: user.id }],
    },
    select: {
      id: true,
      interactions: {
        where: { analysisResult: { not: Prisma.AnyNull } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { analysisResult: true, createdAt: true },
      },
      _count: { select: { knowledgeChunks: true } },
    },
  });

  const healthMap: Record<string, {
    score: number;
    sentiment: string | null;
    tip: string | null;
    hasKnowledge: boolean;
  }> = {};

  for (const opp of opportunities) {
    const analyses = opp.interactions
      .map((i) => {
        const r = i.analysisResult as Record<string, unknown> | null;
        if (!r || typeof r.dealHealthScore !== "number") return null;
        return { dealHealthScore: r.dealHealthScore as number, createdAt: i.createdAt };
      })
      .filter(Boolean) as Array<{ dealHealthScore: number; createdAt: Date }>;

    const latest = opp.interactions[0]?.analysisResult as Record<string, unknown> | null;

    healthMap[opp.id] = {
      score: aggregateDealHealth(analyses),
      sentiment: (latest?.sentiment as string) ?? null,
      tip: (latest?.suggestedNextAction as string) ?? null,
      hasKnowledge: opp._count.knowledgeChunks > 0,
    };
  }

  return NextResponse.json({ healthMap });
}
