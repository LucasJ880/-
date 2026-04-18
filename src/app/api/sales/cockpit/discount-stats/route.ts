/**
 * 驾驶舱 — 折扣率数统
 *
 * 按时间区间（默认本月）、可选销售 rep 过滤，把已成单报价按【含税成交金额】
 * 分三档统计，返回每档平均折扣率 + 成单数 + 累计额。
 *
 * 抉择：C1（MSRP 分母不含 Part B/C）、D2（档位按含税金额）
 *
 * Query:
 *   - from=YYYY-MM-DD  (默认本月 1 号)
 *   - to=YYYY-MM-DD    (默认今天 23:59)
 *   - salesRepId=cuid  (admin 可选；非 admin 强制=自己)
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

type Tier = "under2k" | "mid" | "over5k";

interface TierStats {
  tier: Tier;
  label: string;
  count: number;
  avgDiscountPct: number;
  totalSignedValue: number;
}

function tierOf(grandTotal: number): Tier {
  if (grandTotal < 2000) return "under2k";
  if (grandTotal < 5000) return "mid";
  return "over5k";
}

const TIER_LABELS: Record<Tier, string> = {
  under2k: "< $2,000",
  mid: "$2,000 – $5,000",
  over5k: "> $5,000",
};

export const GET = withAuth(async (request, _ctx, user) => {
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const { searchParams } = new URL(request.url);

  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr + "T23:59:59") : defaultTo;

  const salesRepIdParam = searchParams.get("salesRepId");
  const salesRepId = isAdmin ? salesRepIdParam || undefined : user.id;

  // 环比口径：与当前区间等时长、紧邻其前的窗口
  //   e.g. 当前 4/1 ~ 4/16 (16 天) → 上一区间 3/16 ~ 3/31
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);

  // 只统计「已成单」的报价（有 signedAt 或 status=signed）
  // 使用 signedAt 做时间筛选 —— 更贴合"这段时间成交多少"的语义
  const baseWhere = {
    ...(salesRepId ? { createdById: salesRepId } : {}),
    finalDiscountPct: { not: null },
  } as const;

  const [quotes, prevQuotes] = await Promise.all([
    db.salesQuote.findMany({
      where: { ...baseWhere, signedAt: { gte: from, lte: to, not: null } },
      select: {
        id: true,
        grandTotal: true,
        finalDiscountPct: true,
        signedAt: true,
        specialPromotion: true,
        createdBy: { select: { id: true, name: true } },
      },
    }),
    db.salesQuote.findMany({
      where: { ...baseWhere, signedAt: { gte: prevFrom, lte: prevTo, not: null } },
      select: { grandTotal: true, finalDiscountPct: true },
    }),
  ]);

  // 初始化三档
  const bucket: Record<Tier, { sumPct: number; count: number; sumValue: number }> = {
    under2k: { sumPct: 0, count: 0, sumValue: 0 },
    mid: { sumPct: 0, count: 0, sumValue: 0 },
    over5k: { sumPct: 0, count: 0, sumValue: 0 },
  };

  let totalCount = 0;
  let totalValue = 0;
  let totalSumPct = 0;

  for (const q of quotes) {
    if (q.finalDiscountPct == null) continue;
    const tier = tierOf(q.grandTotal);
    bucket[tier].count += 1;
    bucket[tier].sumPct += q.finalDiscountPct;
    bucket[tier].sumValue += q.grandTotal;
    totalCount += 1;
    totalValue += q.grandTotal;
    totalSumPct += q.finalDiscountPct;
  }

  const tiers: TierStats[] = (["under2k", "mid", "over5k"] as Tier[]).map((t) => ({
    tier: t,
    label: TIER_LABELS[t],
    count: bucket[t].count,
    avgDiscountPct: bucket[t].count > 0 ? bucket[t].sumPct / bucket[t].count : 0,
    totalSignedValue: bucket[t].sumValue,
  }));

  // 可选：按销售 rep 汇总（admin 才返回）
  const salesReps = isAdmin
    ? Array.from(
        quotes.reduce((map, q) => {
          if (q.finalDiscountPct == null) return map;
          const key = q.createdBy?.id ?? "unknown";
          const prev = map.get(key) ?? {
            id: key,
            name: q.createdBy?.name ?? "未分配",
            count: 0,
            sumPct: 0,
            sumValue: 0,
          };
          prev.count += 1;
          prev.sumPct += q.finalDiscountPct;
          prev.sumValue += q.grandTotal;
          map.set(key, prev);
          return map;
        }, new Map<string, { id: string; name: string; count: number; sumPct: number; sumValue: number }>()).values(),
      ).map((r) => ({
        id: r.id,
        name: r.name,
        count: r.count,
        avgDiscountPct: r.count > 0 ? r.sumPct / r.count : 0,
        totalSignedValue: r.sumValue,
      }))
      .sort((a, b) => b.totalSignedValue - a.totalSignedValue)
    : [];

  // 提供可选 rep 下拉（admin）
  const repOptions = isAdmin
    ? await db.user.findMany({
        where: { role: { notIn: ["customer"] } },
        select: { id: true, name: true, salesRepInitials: true },
        orderBy: { name: "asc" },
      })
    : [];

  // 上一区间聚合（仅总览）
  let prevCount = 0;
  let prevValue = 0;
  let prevSumPct = 0;
  for (const q of prevQuotes) {
    if (q.finalDiscountPct == null) continue;
    prevCount += 1;
    prevValue += q.grandTotal;
    prevSumPct += q.finalDiscountPct;
  }

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    salesRepId: salesRepId || null,
    isAdmin,
    total: {
      count: totalCount,
      avgDiscountPct: totalCount > 0 ? totalSumPct / totalCount : 0,
      totalSignedValue: totalValue,
    },
    prev: {
      from: prevFrom.toISOString(),
      to: prevTo.toISOString(),
      count: prevCount,
      avgDiscountPct: prevCount > 0 ? prevSumPct / prevCount : 0,
      totalSignedValue: prevValue,
    },
    tiers,
    salesReps,
    repOptions,
  });
});
