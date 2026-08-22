/**
 * Project Financial Performance（Quote Operations Phase 2 P0-D）—— 只读模型 / 聚合。
 *
 * 数据源只允许既有权威模型：ProjectBudget*（预算）+ ProjectCost（实际/承诺，经 getBudgetVsActual）
 * + ProjectRevenueEntry（合同价值，经 getProjectRevenueRollup）+ awarded 引擎报价（原始预期利润）。
 * 不建第二套财务事实源；Forecast 只存在 ACTIVE 预算版本的 metadata（人工）或按可信进度投影（本版本无进度信号 → 明确 not available）。
 * 规则（OVER_BUDGET / MARGIN_EROSION / CONTINGENCY_LOW / COST_AHEAD_OF_PROGRESS）确定性；AI 只解释。
 */

import { db } from "@/lib/db";
import { isLedgerSchemaReady } from "@/lib/project-ledger/flags";
import { isFinancialControlEnabled, isProfitabilitySchemaReady } from "./flags";
import { getBudgetVsActual } from "./read-model";
import { getProjectRevenueRollup } from "./revenue-service";

export const FINANCIAL_PERFORMANCE_VERSION = "financial-performance/v1" as const;

export type FinancialWarningCode = "OVER_BUDGET" | "COST_AHEAD_OF_PROGRESS" | "MARGIN_EROSION" | "CONTINGENCY_LOW" | "NO_ACTIVE_BUDGET" | "UNLINKED_ACTUALS";
export type FinancialWarning = { code: FinancialWarningCode; severity: "HIGH" | "MEDIUM" | "LOW"; category: string | null; messageZh: string; data: Record<string, number | string | null> };

export type ForecastMethod = "MANUAL" | "PROJECTION" | "NONE";
export type CostForecast = {
  method: ForecastMethod;
  available: boolean;
  expectedRemainingCost: number | null;
  forecastFinalCost: number | null;
  completionPct: number | null;
  note: string | null;
  updatedAt: string | null;
  updatedById: string | null;
  reason: string | null;
};

export type CategoryPerformance = { category: string; budget: number; baseline: number; actual: number; remaining: number; varianceAmount: number; usedPct: number | null; overBudget: boolean; overBudgetPct: number | null };

export type ProjectFinancialPerformance = {
  version: typeof FINANCIAL_PERFORMANCE_VERSION;
  currency: string | null;
  available: boolean;
  reasons: string[];
  budget: { hasActiveBudget: boolean; hasBaseline: boolean; originalBudget: number | null; currentBudget: number | null; activeVersionNumber: number | null; baselineVersionNumber: number | null };
  actual: { actualCost: number; committedCost: number; unlinkedActual: number; pendingReviewCount: number };
  remaining: number | null;
  usedPct: number | null;
  contract: { source: "REVENUE_LEDGER" | "AWARDED_QUOTE" | "NONE"; contractValue: number | null; approvedChangeOrders: number; currentContractValue: number | null; recognizedRevenue: number | null };
  quote: { quoteId: string; version: number; quoteNumber: string | null; sellingPrice: number; estimatedCost: number; grossProfit: number; grossMarginPct: number; currency: string } | null;
  forecast: CostForecast;
  profit: { basis: "REVENUE_LEDGER" | "AWARDED_QUOTE" | "NONE"; costBasis: "MANUAL_FORECAST" | "PROJECTION" | "CURRENT_BUDGET" | "NONE"; originalExpectedProfit: number | null; originalExpectedMarginPct: number | null; currentForecastProfit: number | null; currentForecastMarginPct: number | null; change: number | null };
  byCategory: CategoryPerformance[];
  warnings: FinancialWarning[];
  traceability: Array<{ budgetLineId: string; category: string; amount: number; sourceReference: string; quoteId: string | null }>;
};

export type PerformanceInputs = {
  currency: string | null;
  budget: { hasActiveBudget: boolean; hasBaseline: boolean; baselineTotal: number; currentTotal: number; activeVersionNumber: number | null; baselineVersionNumber: number | null };
  actual: { actualTotal: number; committedTotal: number; unlinkedActual: number; pendingReviewCount: number };
  byCategory: Array<{ category: string; budget: number; baseline: number; actual: number }>;
  quote: ProjectFinancialPerformance["quote"];
  revenue: { available: boolean; contractRevenue: number; approvedChangeOrders: number; forecastRevenue: number; recognizedRevenue: number } | null;
  manualForecast: { expectedRemainingCost: number; note: string | null; updatedAt: string | null; updatedById: string | null } | null;
  completionPct: number | null;
  traceability?: ProjectFinancialPerformance["traceability"];
  reasons?: string[];
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
};

export const DEFAULT_THRESHOLDS = { overBudgetHighPct: 10, contingencyLowPct: 20, marginErosionMediumPp: 2, marginErosionHighPp: 5, costAheadPp: 15 } as const;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (num: number, den: number): number | null => (den > 0 ? r2((num / den) * 100) : null);

/** 纯函数：全部口径在此（可单测）。除零一律 null，绝不伪造。 */
export function computePerformance(i: PerformanceInputs): ProjectFinancialPerformance {
  const th = { ...DEFAULT_THRESHOLDS, ...(i.thresholds ?? {}) };
  const hasBudget = i.budget.hasActiveBudget;
  const currentBudget = hasBudget ? r2(i.budget.currentTotal) : null;
  const originalBudget = i.budget.hasBaseline ? r2(i.budget.baselineTotal) : currentBudget;
  const actual = r2(i.actual.actualTotal);
  const remaining = currentBudget != null ? r2(currentBudget - actual) : null;
  const usedPct = currentBudget != null ? pct(actual, currentBudget) : null;

  const byCategory: CategoryPerformance[] = i.byCategory.map((c) => {
    const over = c.actual > c.budget;
    return { category: c.category, budget: r2(c.budget), baseline: r2(c.baseline), actual: r2(c.actual), remaining: r2(c.budget - c.actual), varianceAmount: r2(c.actual - c.budget), usedPct: pct(c.actual, c.budget), overBudget: over, overBudgetPct: over && c.budget > 0 ? r2(((c.actual - c.budget) / c.budget) * 100) : null };
  });

  const contract: ProjectFinancialPerformance["contract"] = i.revenue?.available
    ? { source: "REVENUE_LEDGER", contractValue: r2(i.revenue.contractRevenue), approvedChangeOrders: r2(i.revenue.approvedChangeOrders), currentContractValue: r2(i.revenue.forecastRevenue), recognizedRevenue: r2(i.revenue.recognizedRevenue) }
    : i.quote
      ? { source: "AWARDED_QUOTE", contractValue: r2(i.quote.sellingPrice), approvedChangeOrders: 0, currentContractValue: r2(i.quote.sellingPrice), recognizedRevenue: null }
      : { source: "NONE", contractValue: null, approvedChangeOrders: 0, currentContractValue: null, recognizedRevenue: null };

  // Forecast：人工 > 投影（仅有可信进度）> 无
  let forecast: CostForecast;
  if (i.manualForecast) {
    forecast = { method: "MANUAL", available: true, expectedRemainingCost: r2(i.manualForecast.expectedRemainingCost), forecastFinalCost: r2(actual + i.manualForecast.expectedRemainingCost), completionPct: i.completionPct, note: i.manualForecast.note, updatedAt: i.manualForecast.updatedAt, updatedById: i.manualForecast.updatedById, reason: null };
  } else if (i.completionPct != null && i.completionPct > 0 && i.completionPct <= 100) {
    const final = r2(actual / (i.completionPct / 100));
    forecast = { method: "PROJECTION", available: true, expectedRemainingCost: r2(final - actual), forecastFinalCost: final, completionPct: i.completionPct, note: null, updatedAt: null, updatedById: null, reason: null };
  } else {
    forecast = { method: "NONE", available: false, expectedRemainingCost: null, forecastFinalCost: null, completionPct: i.completionPct, note: null, updatedAt: null, updatedById: null, reason: i.completionPct == null ? "NO_PROGRESS_SIGNAL" : "INVALID_PROGRESS" };
  }

  const revenueForProfit = contract.currentContractValue;
  const originalExpectedProfit = i.quote ? r2(i.quote.grossProfit) : contract.contractValue != null && originalBudget != null ? r2(contract.contractValue - originalBudget) : null;
  const originalExpectedMarginPct = i.quote ? r2(i.quote.grossMarginPct) : originalExpectedProfit != null && contract.contractValue ? pct(originalExpectedProfit, contract.contractValue) : null;
  let costBasis: ProjectFinancialPerformance["profit"]["costBasis"] = "NONE";
  let finalCost: number | null = null;
  if (forecast.available && forecast.forecastFinalCost != null) { finalCost = forecast.forecastFinalCost; costBasis = forecast.method === "MANUAL" ? "MANUAL_FORECAST" : "PROJECTION"; }
  else if (currentBudget != null) { finalCost = Math.max(currentBudget, actual); costBasis = "CURRENT_BUDGET"; }
  const currentForecastProfit = revenueForProfit != null && finalCost != null ? r2(revenueForProfit - finalCost) : null;
  const currentForecastMarginPct = currentForecastProfit != null && revenueForProfit ? pct(currentForecastProfit, revenueForProfit) : null;
  const profit: ProjectFinancialPerformance["profit"] = { basis: contract.source, costBasis, originalExpectedProfit, originalExpectedMarginPct, currentForecastProfit, currentForecastMarginPct, change: originalExpectedProfit != null && currentForecastProfit != null ? r2(currentForecastProfit - originalExpectedProfit) : null };

  const warnings: FinancialWarning[] = [];
  if (!hasBudget) warnings.push({ code: "NO_ACTIVE_BUDGET", severity: "LOW", category: null, messageZh: "尚无生效预算：Award 后请激活预算版本", data: {} });
  if (currentBudget != null && actual > currentBudget) {
    const overPct = pct(actual - currentBudget, currentBudget);
    warnings.push({ code: "OVER_BUDGET", severity: overPct != null && overPct > th.overBudgetHighPct ? "HIGH" : "MEDIUM", category: null, messageZh: `项目总实际成本已超预算 ${r2(actual - currentBudget).toLocaleString("en-CA")}（${overPct ?? "—"}%）`, data: { budget: currentBudget, actual, overPct } });
  }
  for (const c of byCategory) {
    if (!c.overBudget) continue;
    warnings.push({ code: "OVER_BUDGET", severity: c.overBudgetPct != null && c.overBudgetPct > th.overBudgetHighPct ? "HIGH" : "MEDIUM", category: c.category, messageZh: `${c.category} 超预算 ${c.varianceAmount.toLocaleString("en-CA")}${c.overBudgetPct != null ? `（${c.overBudgetPct}%）` : "（预算为 0）"}`, data: { budget: c.budget, actual: c.actual, overBudgetPct: c.overBudgetPct } });
  }
  const cont = byCategory.find((c) => c.category === "CONTINGENCY");
  if (cont && cont.budget > 0) {
    const remainPct = pct(cont.remaining, cont.budget);
    if (remainPct != null && remainPct < th.contingencyLowPct) warnings.push({ code: "CONTINGENCY_LOW", severity: remainPct < 0 ? "HIGH" : "MEDIUM", category: "CONTINGENCY", messageZh: `不可预见费剩余 ${remainPct}%（低于 ${th.contingencyLowPct}% 阈值）`, data: { remaining: cont.remaining, budget: cont.budget, remainPct } });
  }
  if (originalExpectedMarginPct != null && currentForecastMarginPct != null && forecast.available) {
    const drop = r2(originalExpectedMarginPct - currentForecastMarginPct);
    if (drop >= th.marginErosionMediumPp) warnings.push({ code: "MARGIN_EROSION", severity: drop >= th.marginErosionHighPp ? "HIGH" : "MEDIUM", category: null, messageZh: `预测毛利率 ${currentForecastMarginPct}% 低于批准报价毛利率 ${originalExpectedMarginPct}%（下降 ${drop} 个百分点）`, data: { original: originalExpectedMarginPct, forecast: currentForecastMarginPct, drop } });
  }
  if (i.completionPct != null && usedPct != null && usedPct - i.completionPct > th.costAheadPp) {
    warnings.push({ code: "COST_AHEAD_OF_PROGRESS", severity: "MEDIUM", category: null, messageZh: `成本已用 ${usedPct}% 明显高于完工进度 ${i.completionPct}%`, data: { usedPct, completionPct: i.completionPct } });
  }
  if (i.actual.unlinkedActual > 0) warnings.push({ code: "UNLINKED_ACTUALS", severity: "LOW", category: null, messageZh: `有 ${r2(i.actual.unlinkedActual).toLocaleString("en-CA")} 实际成本未关联到预算行（类别视图不含）`, data: { unlinkedActual: r2(i.actual.unlinkedActual) } });

  return {
    version: FINANCIAL_PERFORMANCE_VERSION,
    currency: i.currency,
    available: true,
    reasons: i.reasons ?? [],
    budget: { hasActiveBudget: hasBudget, hasBaseline: i.budget.hasBaseline, originalBudget, currentBudget, activeVersionNumber: i.budget.activeVersionNumber, baselineVersionNumber: i.budget.baselineVersionNumber },
    actual: { actualCost: actual, committedCost: r2(i.actual.committedTotal), unlinkedActual: r2(i.actual.unlinkedActual), pendingReviewCount: i.actual.pendingReviewCount },
    remaining,
    usedPct,
    contract,
    quote: i.quote,
    forecast,
    profit,
    byCategory,
    warnings,
    traceability: i.traceability ?? [],
  };
}

export function emptyPerformance(reasons: string[]): ProjectFinancialPerformance {
  return { ...computePerformance({ currency: null, budget: { hasActiveBudget: false, hasBaseline: false, baselineTotal: 0, currentTotal: 0, activeVersionNumber: null, baselineVersionNumber: null }, actual: { actualTotal: 0, committedTotal: 0, unlinkedActual: 0, pendingReviewCount: 0 }, byCategory: [], quote: null, revenue: null, manualForecast: null, completionPct: null }), available: false, reasons, warnings: [] };
}

/** 读取 ACTIVE 版本 metadata.costForecast（forecast-service 写入） */
export function manualForecastOf(metadata: unknown): PerformanceInputs["manualForecast"] {
  const m = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
  const f = m?.costForecast && typeof m.costForecast === "object" ? (m.costForecast as Record<string, unknown>) : null;
  if (!f || f.method !== "MANUAL" || typeof f.expectedRemainingCostCad !== "number" || !Number.isFinite(f.expectedRemainingCostCad)) return null;
  return { expectedRemainingCost: f.expectedRemainingCostCad, note: typeof f.note === "string" ? f.note : null, updatedAt: typeof f.updatedAt === "string" ? f.updatedAt : null, updatedById: typeof f.updatedById === "string" ? f.updatedById : null };
}

/** 加载器：从权威模型组装 inputs（不写任何数据） */
export async function getProjectFinancialPerformance(orgId: string, projectId: string): Promise<ProjectFinancialPerformance> {
  if (!isFinancialControlEnabled()) return emptyPerformance(["FINANCIAL_CONTROL_DISABLED"]);
  const reasons: string[] = [];
  let bva: Awaited<ReturnType<typeof getBudgetVsActual>>;
  try {
    bva = await getBudgetVsActual(orgId, projectId);
  } catch (e) {
    return emptyPerformance([e instanceof Error && e.message === "FINANCE_TENANT_MISMATCH" ? "FINANCE_TENANT_MISMATCH" : "BUDGET_READ_FAILED"]);
  }
  if (!isLedgerSchemaReady()) reasons.push("LEDGER_SCHEMA_NOT_READY");

  // awarded / 选中报价（原始预期利润）
  const project = await db.project.findFirst({ where: { id: projectId, orgId }, select: { bidQuoteId: true } });
  let quote: ProjectFinancialPerformance["quote"] = null;
  const candidate = await db.projectQuote.findFirst({ where: { projectId, orgId, status: "awarded" }, orderBy: { awardedAt: "desc" }, select: { id: true } }) ?? (project?.bidQuoteId ? await db.projectQuote.findFirst({ where: { id: project.bidQuoteId, projectId, status: { in: ["approved", "awarded"] } }, select: { id: true } }) : null);
  if (candidate) {
    const { computeForQuote, getQuote } = await import("@/lib/quote-engine/service");
    const q = await getQuote(candidate.id, projectId);
    const computed = computeForQuote(q);
    if (computed.calc.ok) quote = { quoteId: q.id, version: q.version, quoteNumber: q.quoteNumber, sellingPrice: computed.calc.sellingPrice, estimatedCost: computed.calc.estimatedCost, grossProfit: computed.calc.grossProfit, grossMarginPct: computed.calc.grossMarginPct, currency: q.currency };
    else reasons.push("QUOTE_CALC_INVALID");
  }

  // 合同价值：唯一权威 = ProjectRevenueEntry（P1.6 表未就绪 → 不可用，退回报价口径并标注）
  let revenue: PerformanceInputs["revenue"] = null;
  if (isProfitabilitySchemaReady()) {
    try {
      const roll = await getProjectRevenueRollup(orgId, projectId);
      revenue = roll.available && roll.entryCount > 0 ? { available: true, contractRevenue: Number(roll.contractRevenueCad), approvedChangeOrders: Number(roll.approvedChangeOrdersCad), forecastRevenue: Number(roll.forecastRevenueCad), recognizedRevenue: Number(roll.recognizedRevenueCad) } : null;
    } catch {
      reasons.push("REVENUE_READ_FAILED");
    }
  } else reasons.push("REVENUE_LEDGER_NOT_READY");

  // forecast + traceability（ACTIVE 版本）
  const budget = await db.projectBudget.findUnique({ where: { orgId_projectId: { orgId, projectId } }, select: { id: true } });
  const active = budget ? await db.projectBudgetVersion.findFirst({ where: { budgetId: budget.id, status: "ACTIVE" }, select: { id: true, metadata: true } }) : null;
  const lines = active ? await db.projectBudgetLine.findMany({ where: { budgetVersionId: active.id }, select: { id: true, category: true, amount: true, sourceReference: true }, orderBy: { sortOrder: "asc" } }) : [];
  const traceability = lines.filter((l) => !!l.sourceReference).map((l) => ({ budgetLineId: l.id, category: l.category, amount: Number(l.amount), sourceReference: l.sourceReference!, quoteId: l.sourceReference!.startsWith("quote:") ? l.sourceReference!.slice(6) : null }));

  return computePerformance({
    currency: bva.currency,
    budget: { hasActiveBudget: bva.hasActiveBudget, hasBaseline: bva.hasBaseline, baselineTotal: Number(bva.total.baselineAmount), currentTotal: Number(bva.total.currentBudgetAmount), activeVersionNumber: bva.activeVersionNumber, baselineVersionNumber: bva.baselineVersionNumber },
    actual: { actualTotal: Number(bva.total.actualAmount), committedTotal: Number(bva.total.committedAmount), unlinkedActual: Number(bva.unlinkedActualAmount), pendingReviewCount: bva.pendingReviewCount },
    byCategory: bva.byCategory.map((c) => ({ category: c.category, budget: Number(c.currentBudgetAmount), baseline: Number(c.baselineAmount), actual: Number(c.actualAmount) })),
    quote,
    revenue,
    manualForecast: manualForecastOf(active?.metadata),
    // 本版本无可信完工进度信号（无 percentComplete / 里程碑权重）→ 投影法明确不可用，绝不伪造
    completionPct: null,
    traceability,
    reasons,
  });
}
