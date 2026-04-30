/**
 * GET /api/trade/campaigns/[id]/stats
 *
 * 活动转化漏斗 + 关键指标
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { loadTradeCampaignForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { normalizeTradeProspectStage, type TradeProspectStage } from "@/lib/trade/stage";

const FUNNEL_STAGES: { key: string; label: string; includes: TradeProspectStage[] | null }[] = [
  { key: "total", label: "总线索", includes: null },
  {
    key: "researched",
    label: "已研究",
    includes: [
      "researched",
      "qualified",
      "contacted",
      "replied",
      "quoted",
      "follow_up",
      "converted",
      "lost",
      "archived",
    ],
  },
  {
    key: "qualified",
    label: "合格",
    includes: ["qualified", "contacted", "replied", "quoted", "follow_up", "converted", "lost", "archived"],
  },
  {
    key: "contacted",
    label: "已联系",
    includes: ["contacted", "replied", "quoted", "follow_up", "converted", "lost", "archived"],
  },
  {
    key: "replied",
    label: "已回复",
    includes: ["replied", "quoted", "follow_up", "converted"],
  },
  {
    key: "follow_up",
    label: "跟进中",
    includes: ["follow_up", "converted"],
  },
  { key: "converted", label: "成交", includes: ["converted"] },
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeCampaignForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const prospects = await db.tradeProspect.findMany({
    where: { campaignId: id, orgId: orgRes.orgId },
    select: { stage: true, score: true, source: true, createdAt: true },
  });

  const total = prospects.length;

  const normalized = prospects.map((p) => normalizeTradeProspectStage(p.stage));

  const funnel = FUNNEL_STAGES.map((f) => {
    const count =
      f.includes === null
        ? total
        : normalized.filter((n) => f.includes!.includes(n)).length;
    return {
      key: f.key,
      label: f.label,
      count,
      rate: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  });

  const stageCounts: Record<string, number> = {};
  for (const p of prospects) {
    const k = normalizeTradeProspectStage(p.stage);
    stageCounts[k] = (stageCounts[k] ?? 0) + 1;
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
    const contacted = funnel.find((x) => x.key === "contacted")?.count ?? 0;
    const replied = funnel.find((x) => x.key === "replied")?.count ?? 0;
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
