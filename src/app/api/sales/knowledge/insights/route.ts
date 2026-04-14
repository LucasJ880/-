import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runBatchInsightExtraction } from "@/lib/sales/insight-extractor";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { lookbackDays, limit } = body as {
    lookbackDays?: number;
    limit?: number;
  };

  const result = await runBatchInsightExtraction(user.id, { lookbackDays, limit });

  return NextResponse.json({ success: true, ...result });
}
