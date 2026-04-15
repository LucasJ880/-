import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { runBatchInsightExtraction } from "@/lib/sales/insight-extractor";

export const GET = withAuth(async (request) => {
  const insightType = request.nextUrl.searchParams.get("type");
  const stage = request.nextUrl.searchParams.get("stage");

  const where: Record<string, unknown> = { status: "active" };
  if (insightType) where.insightType = insightType;
  if (stage) where.dealStage = stage;

  const insights = await db.salesInsight.findMany({
    where,
    orderBy: [{ effectiveness: "desc" }, { successCount: "desc" }],
    take: 50,
  });

  const stats = {
    total: insights.length,
    winPatterns: insights.filter((i) => i.insightType === "win_pattern").length,
    lossSignals: insights.filter((i) => i.insightType === "loss_signal").length,
    avgEffectiveness: insights.length > 0
      ? insights.reduce((s, i) => s + i.effectiveness, 0) / insights.length
      : 0,
  };

  return NextResponse.json({ insights, stats });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const { lookbackDays, limit } = body as {
    lookbackDays?: number;
    limit?: number;
  };

  const result = await runBatchInsightExtraction(user.id, { lookbackDays, limit });

  return NextResponse.json({ success: true, ...result });
});
