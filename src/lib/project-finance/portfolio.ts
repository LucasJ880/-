/**
 * T2-P1.6 Tender Portfolio Intelligence（org 级 server-side read model）
 *
 * 「2026 年 6–8 月一共投了多少项目？中了几个？没中几个？花了多少钱？为什么没中？」
 *
 * 冻结口径：
 * - **cohort 的 canonical 日期 = `Project.submittedAt`（我方投标提交时间）**（PORT-01）。
 *   刻意不用 createdAt（录入时间）/ closeDate（截标）/ awardDate（结果公布）——
 *   「6–8 月投的项目」问的是我们何时投出去，不是何时被录入或何时出结果。
 * - Win Rate = won / (won + lost)；分母为 0 → null（不造 0% 也不造 NaN）（PORT-06）。
 * - **Forecast Profit 与 Finalized Profit 绝不相加**：分成两个独立聚合 + 各自项目数（PORT-05）。
 * - 权威金额一律来自 ProjectCost / ProjectRevenueEntry；
 *   `Project.estimatedValue`（Float 复盘字段）只作 indicative 且显式标注，绝不进利润。
 * - 前端零遍历：本模块一次性算完返回。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveCostPhaseBoundary } from "./cost-phase";
import { isProfitabilitySchemaReady } from "./flags";
import { BASE_CURRENCY, marginPercentage, ZERO } from "./money";
import { getProjectCostSlice } from "./profitability";
import { getProjectRevenueRollup } from "./revenue-service";
import { getOutstandingByType } from "./settlement-service";
import { LOSS_REASON_GROUPS, resolveTenderOutcome, type TenderOutcome } from "./types";

const COHORT_SELECT = {
  id: true,
  name: true,
  workDomain: true,
  bidPhaseStatus: true,
  tenderStatus: true,
  awardDate: true,
  submittedAt: true,
  actualCompletionDate: true,
  estimatedValue: true,
  currency: true,
} as const;

export interface PortfolioWindow {
  /** 含（>=） */
  from: Date;
  /** 含（<=） */
  to: Date;
}

export interface TenderPortfolioSummary {
  window: { from: string; to: string };
  currency: typeof BASE_CURRENCY;
  /** 收入/结算/落标依赖 P1.6 新表；OFF 时相关字段为 null 并置 false */
  profitabilityAvailable: boolean;

  /* 计数 */
  tenderSubmittedCount: number;
  wonCount: number;
  lostCount: number;
  pendingCount: number;
  /** 0 分母 → null（PORT-06） */
  winRatePercentage: string | null;

  /* 标的额（indicative，非权威） */
  indicativeTenderValue: {
    /** 仅统计 currency=CAD 的 Project.estimatedValue；Float 字段，仅供参考 */
    totalCad: string;
    includedProjectCount: number;
    /** 无 estimatedValue 或非 CAD 计价的项目数 */
    excludedProjectCount: number;
    note: "INDICATIVE_ONLY_NON_AUTHORITATIVE_FLOAT_FIELD";
  };
  /** 权威中标额 = 中标项目的合同收入（ProjectRevenueEntry.CONTRACT_AWARD） */
  awardedValueCad: string | null;

  /* 投标成本 */
  totalBidCostCad: string;
  wonTenderBidCostCad: string;
  lostTenderBidCostCad: string;
  averageBidCostPerTenderCad: string | null;
  /** 含失败在内的真实获客成本 = 全部投标成本 / 中标数 */
  averageCostPerWinCad: string | null;
  /** 仅中标项目自身的投标投入 / 中标数 */
  awardAcquisitionCostPerWinCad: string | null;

  /* 落标烧钱 */
  lostTenderTotalSpendCad: string;

  /* 中标项目经营（forecast 与 final 严格分离） */
  wonProjects: {
    forecastRevenueCad: string | null;
    realizedRevenueCad: string | null;
    /** 尚未终结的中标项目的预测利润（不含已终结项目） */
    currentForecastProfitCad: string | null;
    currentForecastProjectCount: number;
    /** 已具备 Final Profit 资格的项目的最终利润（不含在建项目） */
    finalizedProfitCad: string | null;
    finalizedProjectCount: number;
    finalizedMarginPercentage: string | null;
  };

  /* 未结现金 */
  outstanding: {
    employeeReimbursementCad: string | null;
    vendorPayableCad: string | null;
    affiliatePayableCad: string | null;
  };

  /* 落标原因 */
  lossReasons: {
    /** 已人工确认的复盘数 */
    confirmedReviewCount: number;
    /** 落标但尚未确认原因的项目数（如实暴露覆盖率） */
    unreviewedLostCount: number;
    topReasons: Array<{ reason: string; count: number }>;
    byGroup: Array<{ group: string; count: number }>;
  };

  /* 数据质量 */
  dataQuality: {
    projectsWithoutPhaseSplit: number;
    unknownCurrencyCostRows: number;
  };
}

/**
 * org 级 tender 组合分析。
 *
 * cohort = `submittedAt ∈ [from, to]` 的项目。刻意**不**按 workDomain 过滤：
 * 中标后被 handoff 成 delivery 的项目其 submittedAt 仍在原投标项目上，
 * 而 delivery 项目本身 submittedAt 为空，因此天然不会重复计数。
 */
export async function getTenderPortfolioSummary(
  orgId: string,
  window: PortfolioWindow,
): Promise<TenderPortfolioSummary> {
  const projects = await db.project.findMany({
    where: { orgId, submittedAt: { gte: window.from, lte: window.to } },
    select: COHORT_SELECT,
    orderBy: { submittedAt: "asc" },
  });

  const available = isProfitabilitySchemaReady();

  // 一次性取回 cohort 内所有已完成交接，避免逐项目查询
  const handoffs = await db.projectHandoff.findMany({
    where: {
      orgId,
      status: "completed",
      sourceTenderProjectId: { in: projects.map((p) => p.id) },
    },
    select: { sourceTenderProjectId: true, completedAt: true, targetDeliveryProjectId: true },
  });
  const handoffBySource = new Map<string, Date | null>();
  const deliveryBySource = new Map<string, string>();
  for (const h of handoffs) {
    handoffBySource.set(h.sourceTenderProjectId, h.completedAt);
    if (h.targetDeliveryProjectId) {
      deliveryBySource.set(h.sourceTenderProjectId, h.targetDeliveryProjectId);
    }
  }

  let won = 0;
  let lost = 0;
  let pending = 0;
  let totalBidCost = ZERO;
  let wonBidCost = ZERO;
  let lostBidCost = ZERO;
  let lostTotalSpend = ZERO;
  let indicativeValue = ZERO;
  let indicativeIncluded = 0;
  let indicativeExcluded = 0;
  let noPhaseSplit = 0;
  let unknownCurrencyRows = 0;

  let awardedValue = ZERO;
  let wonForecastRevenue = ZERO;
  let wonRealizedRevenue = ZERO;
  let currentForecastProfit = ZERO;
  let currentForecastCount = 0;
  let finalizedProfit = ZERO;
  let finalizedRevenue = ZERO;
  let finalizedCount = 0;
  let employeeOutstanding = ZERO;
  let vendorOutstanding = ZERO;
  let affiliateOutstanding = ZERO;
  let unreviewedLost = 0;

  for (const p of projects) {
    const outcome: TenderOutcome = resolveTenderOutcome(p);
    if (outcome === "WON") won += 1;
    else if (outcome === "LOST") lost += 1;
    else pending += 1;

    // indicative 标的额（Float 字段；仅 CAD 计价才纳入，其余如实排除）
    if (p.estimatedValue != null && (p.currency ?? BASE_CURRENCY) === BASE_CURRENCY) {
      indicativeValue = indicativeValue.add(new Prisma.Decimal(String(p.estimatedValue)));
      indicativeIncluded += 1;
    } else {
      indicativeExcluded += 1;
    }

    // ── 成本：投标项目自身 + （中标时）其交付项目 ──
    const slice = await getProjectCostSlice(orgId, p, handoffBySource.get(p.id) ?? null);
    if (!slice.phaseSplitAvailable) noPhaseSplit += 1;
    unknownCurrencyRows += slice.unknownCurrencyCostCount;

    totalBidCost = totalBidCost.add(slice.bidCostCad);
    let projectTotalCost = slice.totalCostCad;

    const deliveryId = deliveryBySource.get(p.id);
    if (deliveryId) {
      const deliveryProject = await db.project.findFirst({
        where: { id: deliveryId, orgId },
        select: COHORT_SELECT,
      });
      if (deliveryProject) {
        const dSlice = await getProjectCostSlice(orgId, deliveryProject, null);
        unknownCurrencyRows += dSlice.unknownCurrencyCostCount;
        projectTotalCost = projectTotalCost.add(dSlice.totalCostCad);
      }
    }

    if (outcome === "WON") {
      wonBidCost = wonBidCost.add(slice.bidCostCad);
    } else if (outcome === "LOST") {
      lostBidCost = lostBidCost.add(slice.bidCostCad);
      // 落标项目的全部投入（TENDER-COST-01：费用一律保留）
      lostTotalSpend = lostTotalSpend.add(projectTotalCost);
    }

    if (!available) continue;

    // ── 收入 / 利润（仅中标项目）──
    if (outcome === "WON") {
      // 收入账挂在投标项目上；若已 handoff，交付项目上的收入也一并计入
      const revenueIds = deliveryId ? [p.id, deliveryId] : [p.id];
      let forecastRevenue = ZERO;
      let realizedRevenue = ZERO;
      let contractRevenue = ZERO;
      let unrealizedEntries = 0;
      for (const rid of revenueIds) {
        const r = await getProjectRevenueRollup(orgId, rid);
        forecastRevenue = forecastRevenue.add(r.forecastRevenueCad);
        realizedRevenue = realizedRevenue.add(r.realizedRevenueCad);
        contractRevenue = contractRevenue.add(r.contractRevenueCad);
        unrealizedEntries += r.unrealizedEntryCount;
      }
      awardedValue = awardedValue.add(contractRevenue);
      wonForecastRevenue = wonForecastRevenue.add(forecastRevenue);
      wonRealizedRevenue = wonRealizedRevenue.add(realizedRevenue);

      const outstandingIds = deliveryId ? [p.id, deliveryId] : [p.id];
      let projectOutstanding = ZERO;
      for (const oid of outstandingIds) {
        const o = await getOutstandingByType(orgId, oid);
        employeeOutstanding = employeeOutstanding.add(o.employeeReimbursementCad);
        vendorOutstanding = vendorOutstanding.add(o.vendorPayableCad);
        affiliateOutstanding = affiliateOutstanding.add(o.affiliatePayableCad);
        projectOutstanding = projectOutstanding.add(o.totalCad);
      }

      // Final 资格：项目已完工 + 收入全部实现 + 无未结应付（与 profitability.ts 同口径）
      const completed = Boolean(
        p.actualCompletionDate ??
          (deliveryId
            ? (
                await db.project.findFirst({
                  where: { id: deliveryId, orgId },
                  select: { actualCompletionDate: true },
                })
              )?.actualCompletionDate
            : null),
      );
      const finalEligible =
        completed &&
        unrealizedEntries === 0 &&
        realizedRevenue.gt(0) &&
        projectOutstanding.lte(0) &&
        slice.unknownCurrencyCostCount === 0;

      if (finalEligible) {
        finalizedProfit = finalizedProfit.add(realizedRevenue.sub(projectTotalCost));
        finalizedRevenue = finalizedRevenue.add(realizedRevenue);
        finalizedCount += 1;
      } else {
        currentForecastProfit = currentForecastProfit.add(forecastRevenue.sub(projectTotalCost));
        currentForecastCount += 1;
      }
    }
  }

  /* ── 落标原因 ── */
  const lostProjectIds = projects
    .filter((p) => resolveTenderOutcome(p) === "LOST")
    .map((p) => p.id);
  const reasonCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  let confirmedReviewCount = 0;

  if (available && lostProjectIds.length > 0) {
    const reviews = await db.projectTenderLossReview.findMany({
      where: { orgId, projectId: { in: lostProjectIds }, status: "CONFIRMED" },
      select: { projectId: true, primaryLossReason: true },
    });
    for (const r of reviews) {
      if (!r.primaryLossReason) continue;
      confirmedReviewCount += 1;
      reasonCounts.set(r.primaryLossReason, (reasonCounts.get(r.primaryLossReason) ?? 0) + 1);
      for (const [group, members] of Object.entries(LOSS_REASON_GROUPS)) {
        if ((members as readonly string[]).includes(r.primaryLossReason)) {
          groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
        }
      }
    }
    unreviewedLost = lostProjectIds.length - confirmedReviewCount;
  } else {
    unreviewedLost = lostProjectIds.length;
  }

  const decided = won + lost;
  const winRate =
    decided > 0
      ? new Prisma.Decimal(won)
          .div(decided)
          .mul(100)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toString()
      : null;

  const tenderCount = projects.length;
  const avgBidPerTender =
    tenderCount > 0
      ? totalBidCost.div(tenderCount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString()
      : null;
  const avgCostPerWin =
    won > 0
      ? totalBidCost.div(won).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString()
      : null;
  const awardAcquisitionPerWin =
    won > 0
      ? wonBidCost.div(won).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString()
      : null;

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    currency: BASE_CURRENCY,
    profitabilityAvailable: available,

    tenderSubmittedCount: tenderCount,
    wonCount: won,
    lostCount: lost,
    pendingCount: pending,
    winRatePercentage: winRate,

    indicativeTenderValue: {
      totalCad: indicativeValue.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString(),
      includedProjectCount: indicativeIncluded,
      excludedProjectCount: indicativeExcluded,
      note: "INDICATIVE_ONLY_NON_AUTHORITATIVE_FLOAT_FIELD",
    },
    awardedValueCad: available ? awardedValue.toString() : null,

    totalBidCostCad: totalBidCost.toString(),
    wonTenderBidCostCad: wonBidCost.toString(),
    lostTenderBidCostCad: lostBidCost.toString(),
    averageBidCostPerTenderCad: avgBidPerTender,
    averageCostPerWinCad: avgCostPerWin,
    awardAcquisitionCostPerWinCad: awardAcquisitionPerWin,

    lostTenderTotalSpendCad: lostTotalSpend.toString(),

    wonProjects: {
      forecastRevenueCad: available ? wonForecastRevenue.toString() : null,
      realizedRevenueCad: available ? wonRealizedRevenue.toString() : null,
      currentForecastProfitCad: available ? currentForecastProfit.toString() : null,
      currentForecastProjectCount: currentForecastCount,
      finalizedProfitCad: available ? finalizedProfit.toString() : null,
      finalizedProjectCount: finalizedCount,
      finalizedMarginPercentage:
        available && finalizedCount > 0 ? marginPercentage(finalizedProfit, finalizedRevenue) : null,
    },

    outstanding: {
      employeeReimbursementCad: available ? employeeOutstanding.toString() : null,
      vendorPayableCad: available ? vendorOutstanding.toString() : null,
      affiliatePayableCad: available ? affiliateOutstanding.toString() : null,
    },

    lossReasons: {
      confirmedReviewCount,
      unreviewedLostCount: unreviewedLost,
      topReasons: [...reasonCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      byGroup: [...groupCounts.entries()]
        .map(([group, count]) => ({ group, count }))
        .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group)),
    },

    dataQuality: {
      projectsWithoutPhaseSplit: noPhaseSplit,
      unknownCurrencyCostRows: unknownCurrencyRows,
    },
  };
}

export { resolveCostPhaseBoundary };
