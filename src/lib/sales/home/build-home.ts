import { db } from "@/lib/db";
import { scanSalesDomain } from "@/lib/secretary/domains/sales";
import { HOME_FUNNEL_STAGES } from "./formatters";
import {
  buildPriorityCustomer,
  scorePriorityCustomer,
  type PriorityScoreInput,
} from "./priority-score";
import type {
  PriorityLevel,
  SalesHomeResponse,
  SalesPriorityItem,
} from "./types";

const DAY_MS = 86_400_000;
const ACTIVE_STAGES = [
  "new_lead",
  "needs_confirmed",
  "measure_booked",
  "quoted",
  "negotiation",
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function mapSeverity(severity: string): PriorityLevel {
  if (severity === "urgent") return "urgent";
  if (severity === "warning") return "important";
  return "normal";
}

function levelLabel(level: PriorityLevel): string {
  if (level === "urgent") return "高优先";
  if (level === "important") return "重要";
  return "普通";
}

export async function buildSalesHome(params: {
  userId: string;
  userName: string;
  orgId: string;
  ownOnly: boolean;
  targetAmount: number | null;
}): Promise<SalesHomeResponse> {
  const { userId, userName, orgId, ownOnly, targetAmount } = params;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const oppOwn = ownOnly
    ? { OR: [{ createdById: userId }, { assignedToId: userId }] }
    : {};
  const quoteOwn = ownOnly ? { createdById: userId } : {};
  const apptOwn = ownOnly
    ? {
        OR: [
          { assignedToId: userId },
          { createdById: userId },
          { customer: { createdById: userId } },
        ],
      }
    : {};
  const activeCustomer = { customer: { archivedAt: null } } as const;
  const activeCustomerOrg = {
    customer: { orgId, archivedAt: null },
  } as const;

  const [
    scan,
    monthSignedAgg,
    weekSignedAgg,
    activeCount,
    followupsDue,
    todayApptCount,
    funnelGroup,
    opportunities,
    todayAppointments,
    quoteGroups,
    pendingDepositQuotes,
    collectedDepositAgg,
    pendingBalanceAgg,
    trendOpps,
  ] = await Promise.all([
    scanSalesDomain(userId, orgId, { ownOnly }),
    db.salesOpportunity.aggregate({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ["signed", "completed"] },
        wonAt: { gte: monthStart },
      },
      _count: true,
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.aggregate({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ["signed", "completed"] },
        wonAt: { gte: weekAgo },
      },
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.count({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ACTIVE_STAGES },
      },
    }),
    db.salesOpportunity.count({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ACTIVE_STAGES },
        nextFollowupAt: { lte: todayEnd },
      },
    }),
    db.appointment.count({
      where: {
        ...activeCustomerOrg,
        startAt: { gte: todayStart, lte: todayEnd },
        status: { not: "cancelled" },
        ...apptOwn,
      },
    }),
    db.salesOpportunity.groupBy({
      by: ["stage"],
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: HOME_FUNNEL_STAGES.map((s) => s.stage) },
      },
      _count: true,
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.findMany({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ACTIVE_STAGES },
      },
      select: {
        id: true,
        stage: true,
        estimatedValue: true,
        nextFollowupAt: true,
        updatedAt: true,
        customer: { select: { id: true, name: true } },
        interactions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
        quotes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            status: true,
            viewedAt: true,
            grandTotal: true,
          },
        },
      },
      take: 80,
    }),
    db.appointment.findMany({
      where: {
        ...activeCustomerOrg,
        startAt: { gte: now, lte: todayEnd },
        status: { not: "cancelled" },
        ...apptOwn,
      },
      orderBy: { startAt: "asc" },
      take: 4,
      select: {
        id: true,
        startAt: true,
        type: true,
        title: true,
        address: true,
        customerId: true,
        customer: { select: { id: true, name: true, address: true } },
      },
    }),
    db.salesQuote.groupBy({
      by: ["status"],
      where: { orgId, ...activeCustomer, ...quoteOwn },
      _count: true,
      _sum: { grandTotal: true },
    }),
    db.salesQuote.findMany({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: { in: ["signed", "accepted"] },
        depositCollectedAt: null,
      },
      orderBy: [{ signedAt: "desc" }, { updatedAt: "desc" }],
      take: 3,
      select: {
        id: true,
        grandTotal: true,
        agreedDepositAmount: true,
        agreedBalanceAmount: true,
        signedAt: true,
        updatedAt: true,
        customerId: true,
        customer: { select: { name: true } },
      },
    }),
    db.salesQuote.aggregate({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: { in: ["signed", "accepted"] },
        depositCollectedAt: { not: null },
        signedAt: { gte: monthStart },
      },
      _sum: { depositAmount: true, agreedDepositAmount: true },
    }),
    db.salesQuote.aggregate({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: { in: ["signed", "accepted"] },
        signedAt: { gte: monthStart },
      },
      _sum: { agreedBalanceAmount: true, grandTotal: true, depositAmount: true },
    }),
    db.salesOpportunity.findMany({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ["signed", "completed"] },
        wonAt: { gte: new Date(now.getTime() - 30 * DAY_MS) },
      },
      select: { wonAt: true, estimatedValue: true },
    }),
  ]);

  const signedAmount = monthSignedAgg._sum.estimatedValue ?? 0;
  const signedCount = monthSignedAgg._count ?? 0;
  const weeklySignedAmount = weekSignedAgg._sum.estimatedValue ?? 0;
  const averageOrderValue =
    signedCount > 0 ? Math.round((signedAmount / signedCount) * 100) / 100 : 0;

  const remainingAmount =
    targetAmount != null ? Math.max(0, targetAmount - signedAmount) : null;
  const completionRate =
    targetAmount != null && targetAmount > 0
      ? Math.min(100, Math.round((signedAmount / targetAmount) * 100))
      : null;

  // 报价摘要
  const quoteByStatus = new Map(
    quoteGroups.map((g) => [
      g.status,
      { count: g._count ?? 0, amount: g._sum.grandTotal ?? 0 },
    ]),
  );

  const sentBefore = new Date(now.getTime() - 14 * DAY_MS);
  const [viewedNotSigned, sentNotViewed, expiring] = await Promise.all([
    db.salesQuote.aggregate({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: { in: ["sent", "viewed"] },
        viewedAt: { not: null },
        signedAt: null,
      },
      _count: true,
      _sum: { grandTotal: true },
    }),
    db.salesQuote.aggregate({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: "sent",
        viewedAt: null,
      },
      _count: true,
      _sum: { grandTotal: true },
    }),
    // 无 validUntil 字段：以「已发送超 14 天未签约」近似即将过期
    db.salesQuote.aggregate({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: { in: ["sent", "viewed"] },
        signedAt: null,
        sentAt: { lte: sentBefore },
      },
      _count: true,
      _sum: { grandTotal: true },
    }),
  ]);

  const pendingDepositAmount = pendingDepositQuotes.reduce(
    (sum, q) => sum + (q.agreedDepositAmount ?? q.grandTotal * 0.3),
    0,
  );
  const pendingDepositCount = pendingDepositQuotes.length;
  // 用 count 全量：上面 take 3，另查 count
  const pendingDepositTotalCount = await db.salesQuote.count({
    where: {
      orgId,
      ...activeCustomer,
      ...quoteOwn,
      status: { in: ["signed", "accepted"] },
      depositCollectedAt: null,
    },
  });

  const customerOwn = ownOnly ? { createdById: userId } : {};
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const [
    quotesSentCount,
    quotesSignedCount,
    cycleOpps,
    sourceGroups,
    compareSigned,
  ] = await Promise.all([
    db.salesQuote.count({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: { in: ["sent", "viewed", "signed", "accepted"] },
        createdAt: { gte: monthStart },
      },
    }),
    db.salesQuote.count({
      where: {
        orgId,
        ...activeCustomer,
        ...quoteOwn,
        status: { in: ["signed", "accepted"] },
        signedAt: { gte: monthStart },
      },
    }),
    db.salesOpportunity.findMany({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ["signed", "completed"] },
        wonAt: { gte: monthStart },
      },
      select: { createdAt: true, wonAt: true },
      take: 100,
    }),
    db.salesCustomer.groupBy({
      by: ["source"],
      where: { orgId, archivedAt: null, ...customerOwn },
      _count: true,
    }),
    db.salesOpportunity.findMany({
      where: {
        orgId,
        ...activeCustomer,
        ...oppOwn,
        stage: { in: ["signed", "completed"] },
        wonAt: { gte: threeMonthsAgo },
      },
      select: { wonAt: true, estimatedValue: true },
    }),
  ]);

  const cycleDays = cycleOpps
    .map((o) => {
      if (!o.wonAt) return null;
      return (o.wonAt.getTime() - o.createdAt.getTime()) / DAY_MS;
    })
    .filter((d): d is number => d != null && d >= 0);
  const avgCycleDays =
    cycleDays.length > 0
      ? Math.round(
          (cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) * 10,
        ) / 10
      : null;

  const quoteToSignRate =
    quotesSentCount > 0
      ? Math.round((quotesSignedCount / quotesSentCount) * 100)
      : null;

  const sourceDistribution = sourceGroups
    .map((g) => ({
      source: g.source?.trim() || "未填写",
      count: g._count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const monthBuckets: Array<{
    yearMonth: string;
    label: string;
    signedAmount: number;
    signedCount: number;
  }> = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthBuckets.push({
      yearMonth: key,
      label: `${d.getMonth() + 1}月`,
      signedAmount: 0,
      signedCount: 0,
    });
  }
  for (const opp of compareSigned) {
    if (!opp.wonAt) continue;
    const key = `${opp.wonAt.getFullYear()}-${String(opp.wonAt.getMonth() + 1).padStart(2, "0")}`;
    const bucket = monthBuckets.find((b) => b.yearMonth === key);
    if (!bucket) continue;
    bucket.signedCount += 1;
    bucket.signedAmount += opp.estimatedValue ?? 0;
  }

  const funnelMap = new Map(
    funnelGroup.map((g) => [
      g.stage,
      { count: g._count ?? 0, amount: g._sum.estimatedValue ?? 0 },
    ]),
  );

  const funnel = HOME_FUNNEL_STAGES.map((s, idx) => {
    const agg = funnelMap.get(s.stage) ?? { count: 0, amount: 0 };
    const prev =
      idx > 0
        ? (funnelMap.get(HOME_FUNNEL_STAGES[idx - 1].stage)?.count ?? 0)
        : null;
    const conversionRate =
      prev != null && prev > 0
        ? Math.round((agg.count / prev) * 100)
        : null;
    return {
      stage: s.stage,
      label: s.label,
      count: agg.count,
      amount: agg.amount,
      conversionRate,
    };
  });

  // 趋势：近 30 天按日聚合
  const trendMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    trendMap.set(key, 0);
  }
  for (const opp of trendOpps) {
    if (!opp.wonAt) continue;
    const key = opp.wonAt.toISOString().slice(0, 10);
    if (trendMap.has(key)) {
      trendMap.set(key, (trendMap.get(key) ?? 0) + (opp.estimatedValue ?? 0));
    }
  }
  const trend = [...trendMap.entries()].map(([date, signedAmount]) => ({
    date,
    signedAmount,
  }));

  // 今日重点
  const priorities: SalesPriorityItem[] = scan.items
    .slice()
    .sort((a, b) => {
      const rank = { urgent: 0, warning: 1, info: 2 } as Record<string, number>;
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    })
    .map((item) => {
      const level = mapSeverity(item.severity);
      const customerId =
        (item.action?.payload?.customerId as string | undefined) ??
        (item.entityType === "sales_customer" ? item.entityId ?? null : null);
      const customerName =
        item.title.includes("：")
          ? item.title.split("：").slice(-1)[0]!
          : item.title;
      return {
        id: item.id,
        level,
        customerId,
        customerName,
        title: item.title,
        reason: item.description || levelLabel(level),
        category: item.category,
        updatedAt: null,
        amount: null,
        primaryAction: {
          type: item.action?.type ?? "view_customer",
          label: item.action?.label ?? "查看客户",
          href: customerId ? `/sales/customers/${customerId}` : "/sales",
          payload: item.action?.payload,
        },
        secondaryAction: customerId
          ? {
              type: "view_customer",
              label: "查看客户",
              href: `/sales/customers/${customerId}`,
            }
          : undefined,
      };
    });

  // 重点客户
  const scored = opportunities
    .map((opp) => {
      const input: PriorityScoreInput = {
        customerId: opp.customer.id,
        customerName: opp.customer.name,
        stage: opp.stage,
        estimatedValue: opp.estimatedValue ?? opp.quotes[0]?.grandTotal ?? null,
        nextFollowupAt: opp.nextFollowupAt,
        updatedAt: opp.updatedAt,
        lastInteractionAt: opp.interactions[0]?.createdAt ?? null,
        quoteViewedAt: opp.quotes[0]?.viewedAt ?? null,
        quoteStatus: opp.quotes[0]?.status ?? null,
      };
      const score = scorePriorityCustomer(input);
      const built = buildPriorityCustomer(input, score);
      return built ? { built, score } : null;
    })
    .filter((x): x is { built: NonNullable<typeof x>["built"]; score: number } =>
      Boolean(x),
    )
    .sort((a, b) => b.score - a.score);

  const seenCustomers = new Set<string>();
  const priorityCustomers = [];
  for (const row of scored) {
    if (seenCustomers.has(row.built.customerId)) continue;
    seenCustomers.add(row.built.customerId);
    priorityCustomers.push(row.built);
    if (priorityCustomers.length >= 5) break;
  }

  const draft = quoteByStatus.get("draft") ?? { count: 0, amount: 0 };

  const collectedDepositAmount =
    collectedDepositAgg._sum.depositAmount ??
    collectedDepositAgg._sum.agreedDepositAmount ??
    0;

  const pendingBalanceAmount =
    pendingBalanceAgg._sum.agreedBalanceAmount ??
    Math.max(
      0,
      (pendingBalanceAgg._sum.grandTotal ?? 0) -
        (pendingBalanceAgg._sum.depositAmount ?? 0),
    );

  return {
    period: {
      start: monthStart.toISOString(),
      end: monthEnd.toISOString(),
      currency: "CAD",
    },
    userName,
    performance: {
      targetAmount,
      signedAmount,
      signedCount,
      remainingAmount,
      completionRate,
      weeklySignedAmount,
      averageOrderValue,
    },
    activity: {
      activeOpportunities: activeCount,
      followupsDue,
      todayAppointments: todayApptCount,
      pendingDeposits: pendingDepositTotalCount || pendingDepositCount,
    },
    trend,
    priorities,
    priorityTotal: priorities.length,
    priorityCustomers,
    appointments: todayAppointments.map((a) => {
      const typeLabel =
        a.type === "measure"
          ? "现场量房"
          : a.type === "revisit"
            ? "客户回访"
            : a.type === "install"
              ? "安装"
              : a.type === "consultation"
                ? "咨询"
                : a.title || "预约";
      const loc = a.address || a.customer?.address || null;
      const isPhone =
        /电话|phone|call/i.test(typeLabel) || /电话|phone/i.test(loc ?? "");
      return {
        id: a.id,
        startAt: a.startAt.toISOString(),
        type: typeLabel,
        title: a.title,
        customerId: a.customerId ?? a.customer?.id ?? null,
        customerName: a.customer?.name ?? "客户",
        location: isPhone ? "电话" : loc,
        isPhone,
      };
    }),
    funnel,
    quoteSummary: {
      draft,
      sentNotViewed: {
        count: sentNotViewed._count ?? 0,
        amount: sentNotViewed._sum.grandTotal ?? 0,
      },
      viewedNotSigned: {
        count: viewedNotSigned._count ?? 0,
        amount: viewedNotSigned._sum.grandTotal ?? 0,
      },
      signedPendingDeposit: {
        count: pendingDepositTotalCount,
        amount: pendingDepositAmount,
      },
      expiring: {
        count: expiring._count ?? 0,
        amount: expiring._sum.grandTotal ?? 0,
      },
    },
    paymentSummary: {
      signedAmount,
      pendingDepositAmount,
      collectedDepositAmount,
      pendingBalanceAmount,
      pendingDeposits: pendingDepositQuotes.map((q) => ({
        id: q.id,
        customerId: q.customerId,
        customerName: q.customer?.name ?? "—",
        grandTotal: q.grandTotal,
        agreedDepositAmount: q.agreedDepositAmount,
        signedAt: (q.signedAt ?? q.updatedAt).toISOString(),
      })),
    },
    conversion: {
      quotesSent: quotesSentCount,
      quotesSigned: quotesSignedCount,
      quoteToSignRate,
      avgCycleDays,
    },
    sourceDistribution,
    monthlyCompare: monthBuckets,
  };
}
