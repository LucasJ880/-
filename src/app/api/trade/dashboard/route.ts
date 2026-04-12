/**
 * GET /api/trade/dashboard
 *
 * 返回外贸 Dashboard 所需的全部统计数据：
 * - overview: 概览数字
 * - funnel: 转化漏斗
 * - trend: 过去 14 天每日新线索 / 已联系 / 回复
 * - topProspects: 得分最高的 Top 10 线索
 * - sourceDistribution: 线索来源分布
 * - quoteStats: 报价单统计
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId") ?? "default";

  const [
    totalProspects,
    stageGroups,
    topProspects,
    sourceGroups,
    trendData,
    quoteStatusGroups,
    quoteTotalResult,
    activeCampaigns,
    totalCampaigns,
  ] = await Promise.all([
    db.tradeProspect.count({ where: { orgId } }),
    db.tradeProspect.groupBy({
      by: ["stage"],
      where: { orgId },
      _count: true,
    }),
    db.tradeProspect.findMany({
      where: { orgId, score: { not: null } },
      orderBy: { score: "desc" },
      take: 10,
      select: {
        id: true,
        companyName: true,
        contactName: true,
        country: true,
        score: true,
        stage: true,
        outreachSentAt: true,
        campaign: { select: { name: true } },
      },
    }),
    db.tradeProspect.groupBy({
      by: ["source"],
      where: { orgId },
      _count: true,
    }),
    getTrendData(orgId),
    db.tradeQuote.groupBy({
      by: ["status"],
      where: { orgId },
      _count: true,
    }),
    db.tradeQuote.aggregate({
      where: { orgId },
      _sum: { totalAmount: true },
      _count: true,
    }),
    db.tradeCampaign.count({ where: { orgId, status: "active" } }),
    db.tradeCampaign.count({ where: { orgId } }),
  ]);

  const stageMap = Object.fromEntries(stageGroups.map((g) => [g.stage, g._count]));

  const funnel = [
    { stage: "discovered", label: "已发现", count: totalProspects },
    { stage: "researched", label: "已研究", count: totalProspects - (stageMap["new"] ?? 0) },
    { stage: "qualified", label: "合格", count: (stageMap["qualified"] ?? 0) + (stageMap["outreach_ready"] ?? 0) + (stageMap["outreach_sent"] ?? 0) + (stageMap["interested"] ?? 0) + (stageMap["negotiating"] ?? 0) + (stageMap["won"] ?? 0) },
    { stage: "contacted", label: "已联系", count: (stageMap["outreach_sent"] ?? 0) + (stageMap["interested"] ?? 0) + (stageMap["negotiating"] ?? 0) + (stageMap["won"] ?? 0) + (stageMap["no_response"] ?? 0) },
    { stage: "replied", label: "已回复", count: (stageMap["interested"] ?? 0) + (stageMap["negotiating"] ?? 0) + (stageMap["won"] ?? 0) },
    { stage: "won", label: "成交", count: stageMap["won"] ?? 0 },
  ];

  const sourceDistribution = sourceGroups.map((g) => ({
    source: g.source ?? "unknown",
    count: g._count,
  })).sort((a, b) => b.count - a.count);

  const quoteStatusMap = Object.fromEntries(quoteStatusGroups.map((g) => [g.status, g._count]));

  return NextResponse.json({
    overview: {
      totalCampaigns,
      activeCampaigns,
      totalProspects,
      qualified: funnel[2].count,
      contacted: funnel[3].count,
      replied: funnel[4].count,
      won: funnel[5].count,
    },
    funnel,
    trend: trendData,
    topProspects,
    sourceDistribution,
    quoteStats: {
      total: quoteTotalResult._count,
      totalAmount: quoteTotalResult._sum.totalAmount ?? 0,
      draft: quoteStatusMap["draft"] ?? 0,
      sent: quoteStatusMap["sent"] ?? 0,
      accepted: quoteStatusMap["accepted"] ?? 0,
      rejected: quoteStatusMap["rejected"] ?? 0,
    },
  });
}

async function getTrendData(orgId: string) {
  const days = 14;
  const result: { date: string; discovered: number; contacted: number; replied: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const dateStr = dayStart.toISOString().slice(0, 10);

    const [discovered, contacted, replied] = await Promise.all([
      db.tradeProspect.count({
        where: { orgId, createdAt: { gte: dayStart, lte: dayEnd } },
      }),
      db.tradeProspect.count({
        where: { orgId, outreachSentAt: { gte: dayStart, lte: dayEnd } },
      }),
      db.tradeMessage.count({
        where: {
          prospect: { orgId },
          direction: "inbound",
          createdAt: { gte: dayStart, lte: dayEnd },
        },
      }),
    ]);

    result.push({ date: dateStr, discovered, contacted, replied });
  }

  return result;
}
