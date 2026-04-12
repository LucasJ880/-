/**
 * GET /api/trade/campaigns/[id]/stats
 *
 * 活动转化漏斗 + 关键指标
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

const FUNNEL_STAGES = [
  { key: "total", label: "总线索", stages: null },
  { key: "researched", label: "已研究", stages: ["qualified", "unqualified", "outreach_draft", "outreach_sent", "replied", "interested", "negotiating", "won", "lost", "no_response"] },
  { key: "qualified", label: "合格", stages: ["qualified", "outreach_draft", "outreach_sent", "replied", "interested", "negotiating", "won", "lost", "no_response"] },
  { key: "contacted", label: "已联系", stages: ["outreach_sent", "replied", "interested", "negotiating", "won", "lost", "no_response"] },
  { key: "replied", label: "已回复", stages: ["replied", "interested", "negotiating", "won"] },
  { key: "interested", label: "感兴趣", stages: ["interested", "negotiating", "won"] },
  { key: "won", label: "成交", stages: ["won"] },
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const prospects = await db.tradeProspect.findMany({
    where: { campaignId: id },
    select: { stage: true, score: true, source: true, createdAt: true },
  });

  const total = prospects.length;

  const funnel = FUNNEL_STAGES.map((f) => {
    const count = f.stages === null
      ? total
      : prospects.filter((p) => f.stages!.includes(p.stage)).length;
    return {
      key: f.key,
      label: f.label,
      count,
      rate: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  });

  const stageCounts: Record<string, number> = {};
  for (const p of prospects) {
    stageCounts[p.stage] = (stageCounts[p.stage] ?? 0) + 1;
  }

  const sourceCounts: Record<string, number> = {};
  for (const p of prospects) {
    const src = p.source ?? "unknown";
    sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
  }

  const scores = prospects.filter((p) => p.score !== null).map((p) => p.score!);
  const avgScore = scores.length > 0
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
    : 0;

  const replyRate = (() => {
    const contacted = funnel.find((f) => f.key === "contacted")?.count ?? 0;
    const replied = funnel.find((f) => f.key === "replied")?.count ?? 0;
    return contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
  })();

  return NextResponse.json({
    funnel,
    stageCounts,
    sourceCounts,
    avgScore,
    replyRate,
    total,
  });
}
