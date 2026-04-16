/**
 * 销售驾驶舱 — 一次请求返回全部看板数据
 *
 * 包含：漏斗分析、团队业绩排行、工单状态、库存预警、周趋势
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

const DAY_MS = 86_400_000;

const FUNNEL_STAGES = [
  "new_lead",
  "needs_confirmed",
  "measure_booked",
  "quoted",
  "negotiation",
  "signed",
  "completed",
] as const;

const STAGE_LABELS: Record<string, string> = {
  new_lead: "新线索",
  needs_confirmed: "待确认",
  measure_booked: "已约量房",
  quoted: "已报价",
  negotiation: "谈判中",
  signed: "已签约",
  completed: "已完工",
};

export const GET = withAuth(async (_request, _ctx, user) => {
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  // ── 1. 漏斗分析 ──
  // 原实现：FUNNEL_STAGES.length × 2 次独立查询（14 次 DB 往返）
  // 优化：单次 groupBy 一次拿齐所有 stage 的 count + sum
  const funnelGroup = await db.salesOpportunity.groupBy({
    by: ["stage"],
    where: {
      stage: { in: [...FUNNEL_STAGES] },
      ...(isAdmin ? {} : { assignedToId: user.id }),
    },
    _count: true,
    _sum: { estimatedValue: true },
  });

  const funnelMap = new Map(
    funnelGroup.map((g) => [
      g.stage,
      { count: g._count ?? 0, value: g._sum.estimatedValue ?? 0 },
    ]),
  );

  const funnelData = FUNNEL_STAGES.map((stage) => {
    const agg = funnelMap.get(stage) ?? { count: 0, value: 0 };
    return {
      stage,
      label: STAGE_LABELS[stage] || stage,
      count: agg.count,
      value: agg.value,
    };
  });

  // ── 2. 团队业绩排行（本月签约额）──
  const teamPerformance = isAdmin
    ? await db.$queryRaw<{ userId: string; userName: string; signedCount: number; signedValue: number }[]>`
        SELECT
          u.id as "userId",
          u.name as "userName",
          COUNT(o.id)::int as "signedCount",
          COALESCE(SUM(o."estimatedValue"), 0)::float as "signedValue"
        FROM "SalesOpportunity" o
        JOIN "User" u ON o."assignedToId" = u.id
        WHERE o.stage IN ('signed', 'completed')
          AND o."wonAt" >= ${monthStart}
        GROUP BY u.id, u.name
        ORDER BY "signedValue" DESC
        LIMIT 10
      `
    : [];

  // ── 3. 本月 KPI ──
  const myFilter: Record<string, unknown> = isAdmin ? {} : { assignedToId: user.id };

  const [monthSigned, monthNewLeads, monthQuotes, monthAppointments] = await Promise.all([
    db.salesOpportunity.aggregate({
      where: { ...myFilter, stage: { in: ["signed", "completed"] }, wonAt: { gte: monthStart } },
      _count: true,
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.count({
      where: { ...myFilter, createdAt: { gte: monthStart } },
    }),
    db.salesQuote.count({
      where: isAdmin ? { createdAt: { gte: monthStart } } : { createdById: user.id, createdAt: { gte: monthStart } },
    }),
    db.appointment.count({
      where: {
        ...(isAdmin ? {} : { assignedToId: user.id }),
        startAt: { gte: monthStart },
        status: { not: "cancelled" },
      },
    }),
  ]);

  // ── 4. 工单状态分布 ──
  const ordersByStatus = await db.blindsOrder.groupBy({
    by: ["status"],
    _count: true,
    where: isAdmin ? {} : { creatorId: user.id },
  });

  // ── 5. 库存预警 ──
  const inventoryAlerts = isAdmin
    ? await db.fabricInventory.findMany({
        where: { status: { in: ["low", "out_of_stock"] } },
        select: { id: true, sku: true, fabricName: true, productType: true, status: true, totalYards: true, reservedYards: true },
        orderBy: { status: "asc" },
        take: 10,
      })
    : [];

  // ── 6. 周同比趋势（本周 vs 上周）──
  const [thisWeekSigned, lastWeekSigned] = await Promise.all([
    db.salesOpportunity.aggregate({
      where: { ...myFilter, stage: { in: ["signed", "completed"] }, wonAt: { gte: weekAgo } },
      _count: true,
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.aggregate({
      where: { ...myFilter, stage: { in: ["signed", "completed"] }, wonAt: { gte: twoWeeksAgo, lt: weekAgo } },
      _count: true,
      _sum: { estimatedValue: true },
    }),
  ]);

  const thisWeekVal = thisWeekSigned._sum.estimatedValue || 0;
  const lastWeekVal = lastWeekSigned._sum.estimatedValue || 0;
  const weekGrowth = lastWeekVal > 0 ? ((thisWeekVal - lastWeekVal) / lastWeekVal) * 100 : 0;

  return NextResponse.json({
    funnel: funnelData,
    teamPerformance,
    kpi: {
      signedCount: monthSigned._count || 0,
      signedValue: monthSigned._sum.estimatedValue || 0,
      newLeads: monthNewLeads,
      quotes: monthQuotes,
      appointments: monthAppointments,
    },
    orders: ordersByStatus.map((o) => ({ status: o.status, count: o._count })),
    inventoryAlerts,
    weekTrend: {
      thisWeek: { count: thisWeekSigned._count || 0, value: thisWeekVal },
      lastWeek: { count: lastWeekSigned._count || 0, value: lastWeekVal },
      growthPct: Math.round(weekGrowth),
    },
  });
});
