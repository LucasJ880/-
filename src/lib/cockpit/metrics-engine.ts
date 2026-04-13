/**
 * 核心指标引擎
 *
 * 聚合外贸数据 + 销售数据，计算驾驶舱所需的所有指标。
 * 支持时间周期对比（本周 vs 上周）。
 */

import { db } from "@/lib/db";
import type {
  CockpitData,
  MetricCard,
  TradeFunnel,
  FunnelStage,
  ROIMetrics,
  TrendSeries,
  TrendPoint,
} from "./types";

const FUNNEL_ORDER = [
  { stage: "new", label: "新发现" },
  { stage: "researched", label: "已研究" },
  { stage: "qualified", label: "合格" },
  { stage: "outreach_draft", label: "开发信草稿" },
  { stage: "outreach_sent", label: "已发送" },
  { stage: "replied", label: "已回复" },
  { stage: "interested", label: "有意向" },
  { stage: "negotiating", label: "谈判中" },
  { stage: "won", label: "成交" },
];

function weekAgo(weeks: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(weeksBack: number): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff - weeksBack * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildMetricCard(
  label: string,
  current: number,
  previous: number,
  unit?: string,
): MetricCard {
  const diff = previous > 0 ? (current - previous) / previous : current > 0 ? 1 : 0;
  const status = diff > 0.01 ? "up" : diff < -0.01 ? "down" : "flat";
  const pct = Math.round(Math.abs(diff) * 100);
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return {
    label,
    value: current,
    unit,
    trend: diff,
    trendLabel: previous > 0 ? `较上周 ${sign}${pct}%` : "首周数据",
    status,
  };
}

export async function computeCockpitData(orgId: string): Promise<CockpitData> {
  const now = new Date();
  const thisWeekStart = startOfWeek(0);
  const lastWeekStart = startOfWeek(1);

  // ── 并行查询所有需要的数据 ────────────────────────────────
  const [
    allProspects,
    thisWeekProspects,
    lastWeekProspects,
    allQuotes,
    thisWeekQuotes,
    lastWeekQuotes,
    campaigns,
    stageCounts,
  ] = await Promise.all([
    // 活跃线索总数
    db.tradeProspect.count({
      where: { orgId, stage: { notIn: ["unqualified", "lost"] } },
    }),
    // 本周新线索
    db.tradeProspect.count({
      where: { orgId, createdAt: { gte: thisWeekStart } },
    }),
    // 上周新线索
    db.tradeProspect.count({
      where: {
        orgId,
        createdAt: { gte: lastWeekStart, lt: thisWeekStart },
      },
    }),
    // 全部报价
    db.tradeQuote.findMany({
      where: { orgId },
      select: { status: true, totalAmount: true, currency: true, sentAt: true, createdAt: true },
    }),
    // 本周报价
    db.tradeQuote.count({
      where: { orgId, createdAt: { gte: thisWeekStart } },
    }),
    // 上周报价
    db.tradeQuote.count({
      where: {
        orgId,
        createdAt: { gte: lastWeekStart, lt: thisWeekStart },
      },
    }),
    // 活动列表
    db.tradeCampaign.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        totalProspects: true,
        qualified: true,
        contacted: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    // 各阶段线索数
    db.tradeProspect.groupBy({
      by: ["stage"],
      where: { orgId },
      _count: { id: true },
    }),
  ]);

  // ── 回复数据 ─────────────────────────────────────────────
  const repliedStages = ["replied", "interested", "negotiating", "won"];
  const outreachSent = await db.tradeProspect.count({
    where: { orgId, stage: { notIn: ["new", "researched", "qualified", "outreach_draft", "unqualified"] } },
  });
  const repliedCount = await db.tradeProspect.count({
    where: { orgId, stage: { in: repliedStages } },
  });

  const thisWeekReplied = await db.tradeProspect.count({
    where: {
      orgId,
      stage: { in: repliedStages },
      updatedAt: { gte: thisWeekStart },
    },
  });
  const lastWeekReplied = await db.tradeProspect.count({
    where: {
      orgId,
      stage: { in: repliedStages },
      updatedAt: { gte: lastWeekStart, lt: thisWeekStart },
    },
  });

  // ── 成交数据 ─────────────────────────────────────────────
  const wonCount = await db.tradeProspect.count({
    where: { orgId, stage: "won" },
  });
  const thisWeekWon = await db.tradeProspect.count({
    where: { orgId, stage: "won", updatedAt: { gte: thisWeekStart } },
  });
  const lastWeekWon = await db.tradeProspect.count({
    where: { orgId, stage: "won", updatedAt: { gte: lastWeekStart, lt: thisWeekStart } },
  });

  // ── 构建指标卡 ────────────────────────────────────────────

  const replyRate = outreachSent > 0 ? repliedCount / outreachSent : 0;
  const lastWeekOutreachSent = await db.tradeProspect.count({
    where: {
      orgId,
      stage: { notIn: ["new", "researched", "qualified", "outreach_draft", "unqualified"] },
      createdAt: { lt: thisWeekStart },
    },
  });
  const lastWeekReplyRate = lastWeekOutreachSent > 0
    ? lastWeekReplied / Math.max(lastWeekOutreachSent, 1)
    : 0;

  const totalQuoteValue = allQuotes.reduce((s, q) => s + q.totalAmount, 0);
  const wonQuoteValue = allQuotes
    .filter((q) => q.status === "accepted")
    .reduce((s, q) => s + q.totalAmount, 0);

  const thisWeekQuoteValue = allQuotes
    .filter((q) => q.createdAt >= thisWeekStart)
    .reduce((s, q) => s + q.totalAmount, 0);
  const lastWeekQuoteValue = allQuotes
    .filter((q) => q.createdAt >= lastWeekStart && q.createdAt < thisWeekStart)
    .reduce((s, q) => s + q.totalAmount, 0);

  const metrics = {
    activeProspects: buildMetricCard("活跃线索", allProspects, allProspects - thisWeekProspects + lastWeekProspects),
    replyRate: buildMetricCard("回复率", Math.round(replyRate * 100), Math.round(lastWeekReplyRate * 100), "%"),
    quoteValue: buildMetricCard("报价总额", Math.round(totalQuoteValue), Math.round(totalQuoteValue - thisWeekQuoteValue + lastWeekQuoteValue), "USD"),
    wonDeals: buildMetricCard("成交客户", wonCount, wonCount - thisWeekWon + lastWeekWon),
  };

  // ── 构建漏斗 ──────────────────────────────────────────────

  const stageMap = new Map(stageCounts.map((s) => [s.stage, s._count.id]));
  const totalForFunnel = stageCounts.reduce((s, c) => s + c._count.id, 0);

  let prevCount = totalForFunnel;
  const funnelStages: FunnelStage[] = FUNNEL_ORDER.map((fo) => {
    const count = stageMap.get(fo.stage) ?? 0;
    const rate = prevCount > 0 ? count / prevCount : null;
    prevCount = count > 0 ? count : prevCount;
    return { stage: fo.stage, label: fo.label, count, conversionRate: rate };
  });

  const funnel: TradeFunnel = {
    stages: funnelStages,
    totalProspects: totalForFunnel,
    wonCount,
    overallConversion: totalForFunnel > 0 ? wonCount / totalForFunnel : 0,
  };

  // ── ROI ────────────────────────────────────────────────────

  const roi: ROIMetrics = {
    totalQuoteValue: Math.round(totalQuoteValue),
    wonQuoteValue: Math.round(wonQuoteValue),
    outreachCount: outreachSent,
    replyCount: repliedCount,
    replyRate,
    costPerLead: null,
    costPerReply: null,
    estimatedROI: totalQuoteValue > 0 && wonQuoteValue > 0
      ? Math.round((wonQuoteValue / totalQuoteValue) * 100) / 100
      : null,
    currency: "USD",
  };

  // ── 趋势（最近 4 周） ─────────────────────────────────────

  const trends = {
    newProspects: await buildWeeklyTrend(orgId, "prospects"),
    replies: await buildWeeklyTrend(orgId, "replies"),
    quotesSent: await buildWeeklyTrend(orgId, "quotes"),
  };

  // ── 热门活动 ──────────────────────────────────────────────

  const topCampaigns = await Promise.all(
    campaigns.slice(0, 5).map(async (c) => {
      const replied = await db.tradeProspect.count({
        where: { campaignId: c.id, stage: { in: repliedStages } },
      });
      return {
        id: c.id,
        name: c.name,
        prospects: c.totalProspects,
        qualified: c.qualified,
        contacted: c.contacted,
        replyRate: c.contacted > 0 ? replied / c.contacted : 0,
      };
    }),
  );

  return {
    metrics,
    funnel,
    roi,
    trends,
    topCampaigns,
    periodLabel: `${thisWeekStart.toISOString().slice(0, 10)} ~ ${now.toISOString().slice(0, 10)}`,
    generatedAt: now.toISOString(),
  };
}

async function buildWeeklyTrend(
  orgId: string,
  type: "prospects" | "replies" | "quotes",
): Promise<TrendSeries> {
  const points: TrendPoint[] = [];
  const labels = { prospects: "新增线索", replies: "客户回复", quotes: "发出报价" };

  for (let w = 3; w >= 0; w--) {
    const from = startOfWeek(w);
    const to = w === 0 ? new Date() : startOfWeek(w - 1);
    const dateLabel = from.toISOString().slice(0, 10);

    let value = 0;
    switch (type) {
      case "prospects":
        value = await db.tradeProspect.count({
          where: { orgId, createdAt: { gte: from, lt: to } },
        });
        break;
      case "replies":
        value = await db.tradeProspect.count({
          where: {
            orgId,
            stage: { in: ["replied", "interested", "negotiating", "won"] },
            updatedAt: { gte: from, lt: to },
          },
        });
        break;
      case "quotes":
        value = await db.tradeQuote.count({
          where: { orgId, createdAt: { gte: from, lt: to } },
        });
        break;
    }

    points.push({ date: dateLabel, value });
  }

  return { label: labels[type], data: points };
}
