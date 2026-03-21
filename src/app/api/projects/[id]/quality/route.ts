import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const sp = new URL(request.url).searchParams;
  const environmentId = sp.get("environmentId")?.trim() || undefined;

  const baseCfWhere: Record<string, unknown> = { projectId };
  const baseMfWhere: Record<string, unknown> = { projectId };
  const baseConvWhere: Record<string, unknown> = { projectId };
  if (environmentId) {
    baseCfWhere.environmentId = environmentId;
    baseMfWhere.environmentId = environmentId;
    baseConvWhere.environmentId = environmentId;
  }

  const [
    totalConversations,
    totalConversationFeedbacks,
    totalMessageFeedbacks,
    avgRatingResult,
    ratingRows,
    issueTypeRows,
    statusRows,
    agentRows,
    envRows,
    recentNegative,
  ] = await Promise.all([
    db.conversation.count({ where: baseConvWhere as never }),
    db.conversationFeedback.count({ where: baseCfWhere as never }),
    db.messageFeedback.count({ where: baseMfWhere as never }),
    db.conversationFeedback.aggregate({
      where: baseCfWhere as never,
      _avg: { rating: true },
    }),
    db.conversationFeedback.groupBy({
      by: ["rating"],
      where: baseCfWhere as never,
      _count: { rating: true },
    }),
    db.conversationFeedback.groupBy({
      by: ["issueType"],
      where: { ...baseCfWhere, issueType: { not: null } } as never,
      _count: { issueType: true },
    }),
    db.conversationFeedback.groupBy({
      by: ["status"],
      where: baseCfWhere as never,
      _count: { status: true },
    }),
    db.conversationFeedback.groupBy({
      by: ["agentId"],
      where: { ...baseCfWhere, agentId: { not: null } } as never,
      _count: { agentId: true },
      _avg: { rating: true },
    }),
    db.conversationFeedback.groupBy({
      by: ["environmentId"],
      where: baseCfWhere as never,
      _count: { environmentId: true },
      _avg: { rating: true },
    }),
    db.conversationFeedback.findMany({
      where: { ...baseCfWhere, rating: { lte: 2 } } as never,
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        conversationId: true,
        rating: true,
        issueType: true,
        note: true,
        status: true,
        agentId: true,
        environmentId: true,
        createdAt: true,
      },
    }),
  ]);

  const ratingDistribution: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) ratingDistribution[i] = 0;
  for (const r of ratingRows) ratingDistribution[r.rating] = r._count.rating;

  const issueTypeDistribution: Record<string, number> = {};
  for (const r of issueTypeRows) {
    if (r.issueType) issueTypeDistribution[r.issueType] = r._count.issueType;
  }

  const statusDistribution: Record<string, number> = {};
  for (const r of statusRows) statusDistribution[r.status] = r._count.status;

  const byAgent = agentRows.map((r) => ({
    agentId: r.agentId,
    count: r._count.agentId,
    avgRating: r._avg.rating ? Math.round(r._avg.rating * 100) / 100 : null,
  }));

  const byEnvironment = envRows.map((r) => ({
    environmentId: r.environmentId,
    count: r._count.environmentId,
    avgRating: r._avg.rating ? Math.round(r._avg.rating * 100) / 100 : null,
  }));

  return NextResponse.json({
    totalConversations,
    totalConversationFeedbacks,
    totalMessageFeedbacks,
    avgRating: avgRatingResult._avg.rating
      ? Math.round(avgRatingResult._avg.rating * 100) / 100
      : null,
    ratingDistribution,
    issueTypeDistribution,
    statusDistribution,
    byAgent,
    byEnvironment,
    recentNegativeCases: recentNegative,
  });
}
