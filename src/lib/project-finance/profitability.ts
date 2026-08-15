/**
 * T2-P1.6 单个 Tender 的财务全景（server-side read model）
 *
 * 数据源只允许权威模型：
 *   成本   ProjectCost（ACTUAL / COMMITTED，VOIDED 天然排除 —— VOIDED 是 costStatus 而非软删标记）
 *   收入   ProjectRevenueEntry
 *   结算   ProjectExpensePayable / Payment
 *   结果   Project 既有 canonical 字段（isProjectAwardEligible / tenderStatus / bidPhaseStatus）
 * 禁止从聊天 / AuditLog / AI memory / ProjectQuote / Project.estimatedValue 推算权威金额。
 *
 * 冻结口径：
 * - Total Cost = Bid Cost + Delivery Cost（TENDER-COST-04）；两者互不覆盖（TENDER-COST-03）。
 * - **Forecast Profit 与 Final Profit 永不混用**：施工未完成时 finalProfitCad = null，
 *   并给出 finalProfitBlockers 说明缺什么证据（禁止无证据宣称 Final Profit）。
 * - 交付项目的投标期成本在来源投标项目上：sourceTenderProjectId 存在时跨项目归集（TENDER-COST-02）。
 * - 一切金额 CAD；缺 FX 快照的 legacy 非 CAD 费用计入 unknownCurrencyCostCount，不猜金额。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveCostPhase, resolveCostPhaseBoundary, type CostPhaseBoundary } from "./cost-phase";
import { isProfitabilitySchemaReady } from "./flags";
import { getLossReview } from "./loss-review-service";
import { BASE_CURRENCY, isBaseCurrency, marginPercentage, ZERO } from "./money";
import { getProjectRevenueRollup, type ProjectRevenueRollup } from "./revenue-service";
import { getOutstandingByType } from "./settlement-service";
import { FinanceTenantError, resolveTenderOutcome, type TenderOutcome } from "./types";

/** 项目 + 其阶段边界所需的最小字段集。 */
const PROJECT_SELECT = {
  id: true,
  name: true,
  orgId: true,
  workDomain: true,
  bidPhaseStatus: true,
  tenderStatus: true,
  awardDate: true,
  submittedAt: true,
  actualCompletionDate: true,
  sourceTenderProjectId: true,
  solicitationNumber: true,
} as const;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

interface PhaseCostTotals {
  bidCostCad: Prisma.Decimal;
  deliveryCostCad: Prisma.Decimal;
  committedCad: Prisma.Decimal;
  /** 非 CAD 且无 CAD 折算的权威成本行数（数据质量指标；不猜金额） */
  unknownCurrencyCostCount: number;
  phaseSplitAvailable: boolean;
  boundarySource: string;
}

async function loadHandoffCompletedAt(orgId: string, projectId: string): Promise<Date | null> {
  const h = await db.projectHandoff.findFirst({
    where: { orgId, sourceTenderProjectId: projectId, status: "completed" },
    select: { completedAt: true },
    orderBy: { completedAt: "asc" },
  });
  return h?.completedAt ?? null;
}

/** 单个项目的成本按阶段汇总（ACTUAL 计入 bid/delivery；COMMITTED 单独统计）。 */
async function aggregateProjectCosts(
  orgId: string,
  projectId: string,
  boundary: CostPhaseBoundary,
): Promise<PhaseCostTotals> {
  const costs = await db.projectCost.findMany({
    where: { orgId, projectId, costStatus: { in: ["ACTUAL", "COMMITTED"] } },
    select: {
      costStatus: true,
      amountActual: true,
      amountCommitted: true,
      currency: true,
      incurredAt: true,
    },
  });

  let bid = ZERO;
  let delivery = ZERO;
  let committed = ZERO;
  let unknown = 0;

  for (const c of costs) {
    // 权威成本一律 CAD（P1.6 起由 approveExpense 保证）；legacy 非 CAD 行不猜金额，只计数
    if (!isBaseCurrency(c.currency)) {
      unknown += 1;
      continue;
    }
    if (c.costStatus === "COMMITTED") {
      committed = committed.add(c.amountCommitted ?? ZERO);
      continue;
    }
    const amount = c.amountActual ?? ZERO;
    if (resolveCostPhase(boundary, c.incurredAt) === "POST_AWARD") delivery = delivery.add(amount);
    else bid = bid.add(amount);
  }

  return {
    bidCostCad: bid,
    deliveryCostCad: delivery,
    committedCad: committed,
    unknownCurrencyCostCount: unknown,
    phaseSplitAvailable: boundary.phaseSplitAvailable,
    boundarySource: boundary.source,
  };
}

export interface TenderFinancialSummary {
  project: {
    id: string;
    name: string;
    solicitationNumber: string | null;
    workDomain: string | null;
    submittedAt: string | null;
    actualCompletionDate: string | null;
  };
  outcome: TenderOutcome;
  currency: typeof BASE_CURRENCY;

  /* 成本 */
  bidCostCad: string;
  deliveryCostCad: string;
  totalCostCad: string;
  committedCostCad: string;
  /** 交付项目时归集自来源投标项目的投标成本 */
  bidCostFromSourceTenderProjectId: string | null;
  phaseSplitAvailable: boolean;
  phaseBoundarySource: string;
  unknownCurrencyCostCount: number;

  /* 收入（唯一权威 = ProjectRevenueEntry） */
  revenueAvailable: boolean;
  contractRevenueCad: string;
  approvedChangeOrdersCad: string;
  forecastRevenueCad: string;
  realizedRevenueCad: string;

  /* 结算（现金面，不计入成本） */
  settlementAvailable: boolean;
  employeeReimbursementOutstandingCad: string;
  vendorPayableOutstandingCad: string;
  affiliatePayableOutstandingCad: string;

  /* 利润 —— forecast 与 final 严格分离 */
  forecastProfitCad: string | null;
  forecastMarginPercentage: string | null;
  finalProfitCad: string | null;
  finalMarginPercentage: string | null;
  finalProfitEligible: boolean;
  /** 不具备 Final Profit 资格的具体原因（如实列出，禁止无证据宣称） */
  finalProfitBlockers: string[];

  /* 落标 */
  lostTenderSpendCad: string | null;
  lossReviewStatus: string | null;
  primaryLossReason: string | null;
}

/**
 * 单个 Tender/Project 的完整财务摘要。
 * `TENDER_PROFITABILITY_SCHEMA_READY=OFF` 时：成本/阶段仍可算（只依赖 P1 ledger），
 * 收入/结算/落标标记为 unavailable，利润返回 null —— fail-closed 且不撒谎。
 */
export async function getTenderFinancialSummary(
  orgId: string,
  projectId: string,
): Promise<TenderFinancialSummary> {
  const project = (await db.project.findFirst({
    where: { id: projectId, orgId },
    select: PROJECT_SELECT,
  })) as ProjectRow | null;
  if (!project) throw new FinanceTenantError();

  const handoffAt = await loadHandoffCompletedAt(orgId, projectId);
  const boundary = resolveCostPhaseBoundary(project, handoffAt);
  const own = await aggregateProjectCosts(orgId, projectId, boundary);

  // TENDER-COST-02：交付项目上没有投标期成本 —— 从来源投标项目归集（不复制、不重算）
  let bidCost = own.bidCostCad;
  let unknownCount = own.unknownCurrencyCostCount;
  let bidFrom: string | null = null;
  if (project.workDomain === "delivery" && project.sourceTenderProjectId) {
    const src = (await db.project.findFirst({
      where: { id: project.sourceTenderProjectId, orgId },
      select: PROJECT_SELECT,
    })) as ProjectRow | null;
    if (src) {
      const srcHandoff = await loadHandoffCompletedAt(orgId, src.id);
      const srcBoundary = resolveCostPhaseBoundary(src, srcHandoff);
      const srcTotals = await aggregateProjectCosts(orgId, src.id, srcBoundary);
      bidCost = bidCost.add(srcTotals.bidCostCad);
      unknownCount += srcTotals.unknownCurrencyCostCount;
      bidFrom = src.id;
    }
  }

  const deliveryCost = own.deliveryCostCad;
  const totalCost = bidCost.add(deliveryCost);
  const outcome = resolveTenderOutcome(project);

  const revenue: ProjectRevenueRollup = await getProjectRevenueRollup(orgId, projectId);
  const outstanding = await getOutstandingByType(orgId, projectId);
  const loss = outcome === "LOST" ? await getLossReview(orgId, projectId) : null;

  /* ── 利润 ── */
  const forecastProfit = revenue.available ? revenue.forecastRevenueCad.sub(totalCost) : null;

  // Final Profit 资格（证据式判定，全部条件必须成立）
  const blockers: string[] = [];
  if (!revenue.available) blockers.push("REVENUE_LEDGER_UNAVAILABLE");
  if (outcome !== "WON") blockers.push(`OUTCOME_NOT_WON(${outcome})`);
  if (!project.actualCompletionDate) blockers.push("PROJECT_NOT_COMPLETED");
  if (revenue.available && revenue.unrealizedEntryCount > 0) {
    blockers.push(`REVENUE_NOT_FULLY_REALIZED(${revenue.unrealizedEntryCount})`);
  }
  if (revenue.available && revenue.realizedRevenueCad.lte(0)) blockers.push("NO_REALIZED_REVENUE");
  if (outstanding.available && outstanding.totalCad.gt(0)) {
    blockers.push(`OPEN_PAYABLES(${outstanding.totalCad.toString()})`);
  }
  if (own.committedCad.gt(0)) blockers.push(`OPEN_COMMITTED_COST(${own.committedCad.toString()})`);
  if (unknownCount > 0) blockers.push(`UNKNOWN_CURRENCY_COST_ROWS(${unknownCount})`);

  const finalEligible = blockers.length === 0;
  const finalProfit = finalEligible ? revenue.realizedRevenueCad.sub(totalCost) : null;

  return {
    project: {
      id: project.id,
      name: project.name,
      solicitationNumber: project.solicitationNumber,
      workDomain: project.workDomain,
      submittedAt: project.submittedAt?.toISOString() ?? null,
      actualCompletionDate: project.actualCompletionDate?.toISOString() ?? null,
    },
    outcome,
    currency: BASE_CURRENCY,

    bidCostCad: bidCost.toString(),
    deliveryCostCad: deliveryCost.toString(),
    totalCostCad: totalCost.toString(),
    committedCostCad: own.committedCad.toString(),
    bidCostFromSourceTenderProjectId: bidFrom,
    phaseSplitAvailable: own.phaseSplitAvailable,
    phaseBoundarySource: own.boundarySource,
    unknownCurrencyCostCount: unknownCount,

    revenueAvailable: revenue.available,
    contractRevenueCad: revenue.contractRevenueCad.toString(),
    approvedChangeOrdersCad: revenue.approvedChangeOrdersCad.toString(),
    forecastRevenueCad: revenue.forecastRevenueCad.toString(),
    realizedRevenueCad: revenue.realizedRevenueCad.toString(),

    settlementAvailable: outstanding.available,
    employeeReimbursementOutstandingCad: outstanding.employeeReimbursementCad.toString(),
    vendorPayableOutstandingCad: outstanding.vendorPayableCad.toString(),
    affiliatePayableOutstandingCad: outstanding.affiliatePayableCad.toString(),

    forecastProfitCad: forecastProfit?.toString() ?? null,
    forecastMarginPercentage:
      forecastProfit && revenue.available
        ? marginPercentage(forecastProfit, revenue.forecastRevenueCad)
        : null,
    finalProfitCad: finalProfit?.toString() ?? null,
    finalMarginPercentage:
      finalProfit != null ? marginPercentage(finalProfit, revenue.realizedRevenueCad) : null,
    finalProfitEligible: finalEligible,
    finalProfitBlockers: blockers,

    // 落标：费用全部保留，「烧了多少钱」= 该项目全部权威 ACTUAL 成本
    lostTenderSpendCad: outcome === "LOST" ? totalCost.toString() : null,
    lossReviewStatus: loss?.review?.status ?? null,
    primaryLossReason: loss?.review?.primaryLossReason ?? null,
  };
}

/** 供 portfolio 复用的精简成本口径（避免 N 次全量 summary 查询）。 */
export interface ProjectCostSlice {
  projectId: string;
  bidCostCad: Prisma.Decimal;
  deliveryCostCad: Prisma.Decimal;
  totalCostCad: Prisma.Decimal;
  unknownCurrencyCostCount: number;
  phaseSplitAvailable: boolean;
}

export async function getProjectCostSlice(
  orgId: string,
  project: PhaseInputProjectRow,
  handoffCompletedAt: Date | null,
): Promise<ProjectCostSlice> {
  const boundary = resolveCostPhaseBoundary(project, handoffCompletedAt);
  const totals = await aggregateProjectCosts(orgId, project.id, boundary);
  return {
    projectId: project.id,
    bidCostCad: totals.bidCostCad,
    deliveryCostCad: totals.deliveryCostCad,
    totalCostCad: totals.bidCostCad.add(totals.deliveryCostCad),
    unknownCurrencyCostCount: totals.unknownCurrencyCostCount,
    phaseSplitAvailable: totals.phaseSplitAvailable,
  };
}

export interface PhaseInputProjectRow {
  id: string;
  workDomain: string | null;
  bidPhaseStatus: string | null;
  tenderStatus: string | null;
  awardDate: Date | null;
}

export { isProfitabilitySchemaReady };
