/**
 * Financial Performance 只读模型纯逻辑（Budget / Actual / Remaining / Over-budget / Zero budget / Forecast / Margin erosion / 溯源）
 * 运行：npx tsx src/lib/project-finance/__tests__/performance.test.ts
 */
import { computePerformance, emptyPerformance, manualForecastOf, type PerformanceInputs } from "../performance";
import { analyzeQuoteOperations } from "@/lib/quote-engine/analyze-operations";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

const base: PerformanceInputs = {
  currency: "CAD",
  budget: { hasActiveBudget: true, hasBaseline: true, baselineTotal: 100000, currentTotal: 100000, activeVersionNumber: 2, baselineVersionNumber: 1 },
  actual: { actualTotal: 90500, committedTotal: 0, unlinkedActual: 0, pendingReviewCount: 0 },
  byCategory: [
    { category: "MATERIAL", budget: 50000, baseline: 50000, actual: 40000 },
    { category: "FREIGHT", budget: 20000, baseline: 20000, actual: 24000 },
    { category: "LABOUR", budget: 25000, baseline: 25000, actual: 20000 },
    { category: "CONTINGENCY", budget: 5000, baseline: 5000, actual: 4500 },
    { category: "EQUIPMENT", budget: 0, baseline: 0, actual: 2000 },
  ],
  quote: { quoteId: "q1", version: 3, quoteNumber: "Q-1", sellingPrice: 354800, estimatedCost: 292400, grossProfit: 62400, grossMarginPct: 17.6, currency: "CAD" },
  revenue: null,
  manualForecast: null,
  completionPct: null,
  traceability: [{ budgetLineId: "bl1", category: "MATERIAL", amount: 50000, sourceReference: "quote:q1", quoteId: "q1" }],
};

const p = computePerformance(base);
ok(p.remaining === 9500 && p.usedPct === 90.5 && p.budget.originalBudget === 100000 && p.budget.currentBudget === 100000, "PERF-01: Remaining = Budget − Actual；Used % = Actual / Budget", { r: p.remaining, u: p.usedPct });
const fr = p.byCategory.find((c) => c.category === "FREIGHT")!;
ok(fr.overBudget && fr.varianceAmount === 4000 && fr.overBudgetPct === 20 && fr.remaining === -4000, "PERF-02: Freight 预算 20,000 / 实际 24,000 → OVER_BUDGET +4,000（20%）", fr);
const eq = p.byCategory.find((c) => c.category === "EQUIPMENT")!;
ok(eq.overBudget && eq.overBudgetPct === null && eq.usedPct === null, "PERF-03: 预算 0 的类别：防除零（usedPct/overBudgetPct = null）但仍标 OVER_BUDGET");
ok(p.warnings.some((w) => w.code === "OVER_BUDGET" && w.category === "FREIGHT" && w.severity === "HIGH"), "PERF-04: OVER_BUDGET FREIGHT HIGH（>10%）");
ok(p.warnings.some((w) => w.code === "CONTINGENCY_LOW" && w.severity === "MEDIUM"), "PERF-05: CONTINGENCY_LOW（剩余 10% < 20%）");
ok(!p.warnings.some((w) => w.code === "OVER_BUDGET" && w.category === null), "PERF-06: 总额未超预算 → 无总额 OVER_BUDGET");
ok(p.contract.source === "AWARDED_QUOTE" && p.contract.currentContractValue === 354800 && p.profit.originalExpectedProfit === 62400 && p.profit.originalExpectedMarginPct === 17.6, "PERF-07: 无收入台账 → 合同价值取 awarded 报价（标注来源）");
ok(p.forecast.method === "NONE" && !p.forecast.available && p.forecast.reason === "NO_PROGRESS_SIGNAL" && p.profit.costBasis === "CURRENT_BUDGET" && p.profit.currentForecastProfit === 254800, "PERF-08: 无进度信号 → 投影不可用（不伪造）；利润按当前预算口径 354,800 − 100,000", p.forecast);
ok(p.traceability[0]?.quoteId === "q1", "PERF-09: Budget Line 溯源 quote:{quoteId}");

// 人工预测
const pm = computePerformance({ ...base, manualForecast: { expectedRemainingCost: 40000, note: "剩余安装", updatedAt: "2026-08-21T00:00:00Z", updatedById: "u1" } });
ok(pm.forecast.method === "MANUAL" && pm.forecast.forecastFinalCost === 130500 && pm.profit.currentForecastProfit === 224300 && pm.profit.costBasis === "MANUAL_FORECAST" && pm.profit.change === 161900, "PERF-10: 人工预测：完工成本 = 实际 + 预计剩余；预测利润 = 合同 − 完工成本", pm.profit);
// 毛利侵蚀
const pe = computePerformance({ ...base, manualForecast: { expectedRemainingCost: 240000, note: null, updatedAt: null, updatedById: null } });
ok(pe.warnings.some((w) => w.code === "MARGIN_EROSION" && w.severity === "HIGH") && pe.profit.currentForecastMarginPct !== null && pe.profit.currentForecastMarginPct < 17.6, "PERF-11: 预测毛利率低于批准报价 → MARGIN_EROSION HIGH", pe.profit);
// 投影法（仅有可信进度）
const pp = computePerformance({ ...base, completionPct: 50 });
ok(pp.forecast.method === "PROJECTION" && pp.forecast.forecastFinalCost === 181000 && pp.warnings.some((w) => w.code === "COST_AHEAD_OF_PROGRESS"), "PERF-12: 完工 50% → 投影完工成本 181,000；成本 90.5% 明显领先进度 → COST_AHEAD_OF_PROGRESS", pp.forecast);
// 收入台账优先
const pr = computePerformance({ ...base, revenue: { available: true, contractRevenue: 354800, approvedChangeOrders: 20000, forecastRevenue: 374800, recognizedRevenue: 0 } });
ok(pr.contract.source === "REVENUE_LEDGER" && pr.contract.currentContractValue === 374800 && pr.contract.approvedChangeOrders === 20000, "PERF-13: 收入台账可用 → Current Contract = Original + 已批 CO（变更单只走收入台账）");
// 总额超预算 + 无预算
const po = computePerformance({ ...base, actual: { ...base.actual, actualTotal: 115000 } });
ok(po.warnings.some((w) => w.code === "OVER_BUDGET" && w.category === null && w.severity === "HIGH") && po.remaining === -15000, "PERF-14: 总额超预算 15% → HIGH；Remaining 为负");
const pn = computePerformance({ ...base, budget: { hasActiveBudget: false, hasBaseline: false, baselineTotal: 0, currentTotal: 0, activeVersionNumber: null, baselineVersionNumber: null }, byCategory: [] });
ok(pn.remaining === null && pn.usedPct === null && pn.warnings.some((w) => w.code === "NO_ACTIVE_BUDGET"), "PERF-15: 无生效预算 → remaining/usedPct = null + NO_ACTIVE_BUDGET");
ok(!emptyPerformance(["FINANCIAL_CONTROL_DISABLED"]).available, "PERF-16: 财务未启用 → available=false 带原因");
ok(manualForecastOf({ costForecast: { method: "MANUAL", expectedRemainingCostCad: 10, note: "n" } })?.expectedRemainingCost === 10 && manualForecastOf({ costForecast: { method: "PROJECTION" } }) === null && manualForecastOf(null) === null, "PERF-17: metadata.costForecast 解析（只认 MANUAL + 有限数）");

// advisory 分析
const an = analyzeQuoteOperations(pe, { supplierShares: [{ supplierName: "Guangzhou Window Co", sharePct: 72 }, { supplierName: "Other", sharePct: 28 }] });
ok(an.topOverruns[0]?.category === "FREIGHT" && an.marginErosion.detected && an.supplierConcentration.detected && an.supplierConcentration.topSupplier === "Guangzhou Window Co" && an.recommendationsZh.length > 0, "ANL-01: 最大超支类别 / 毛利侵蚀 / 供应商集中度 / 建议", an);
ok(an.summaryZh.some((s) => s.includes("FREIGHT")) && an.missingCosts.length === 0, "ANL-02: 摘要提及 FREIGHT；无缺失成本类别");
const an2 = analyzeQuoteOperations(emptyPerformance(["FINANCIAL_CONTROL_DISABLED"]));
ok(an2.summaryZh[0]?.includes("不可用") && an2.recommendationsZh.length === 0, "ANL-03: 不可用时只说明原因，不编造");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
