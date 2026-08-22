/**
 * analyzeQuoteOperations（advisory only）：从确定性 Financial Performance 生成解释与建议。
 * 绝不改 Budget / Actual / Approved Quote / Contract Value；纯函数，可单测。
 */

import type { ProjectFinancialPerformance } from "@/lib/project-finance/performance";

export const QUOTE_OPERATIONS_ANALYSIS_VERSION = "quote-ops-analysis/v1" as const;

export type QuoteOperationsAnalysis = {
  version: typeof QUOTE_OPERATIONS_ANALYSIS_VERSION;
  summaryZh: string[];
  topOverruns: Array<{ category: string; overAmount: number; overPct: number | null }>;
  missingCosts: string[];
  marginErosion: { detected: boolean; originalPct: number | null; forecastPct: number | null; dropPp: number | null };
  financingRisk: { detected: boolean; reasonZh: string | null };
  supplierConcentration: { detected: boolean; topSupplier: string | null; sharePct: number | null };
  recommendationsZh: string[];
};

const money = (n: number, ccy: string | null) => n.toLocaleString("en-CA", { style: "currency", currency: ccy ?? "CAD", maximumFractionDigits: 0 });

export function analyzeQuoteOperations(perf: ProjectFinancialPerformance, extra?: { supplierShares?: Array<{ supplierName: string; sharePct: number }> }): QuoteOperationsAnalysis {
  const ccy = perf.currency;
  const summaryZh: string[] = [];
  const recommendationsZh: string[] = [];
  if (!perf.available) {
    return { version: QUOTE_OPERATIONS_ANALYSIS_VERSION, summaryZh: [`财务表现不可用：${perf.reasons.join("、") || "未知原因"}`], topOverruns: [], missingCosts: [], marginErosion: { detected: false, originalPct: null, forecastPct: null, dropPp: null }, financingRisk: { detected: false, reasonZh: null }, supplierConcentration: { detected: false, topSupplier: null, sharePct: null }, recommendationsZh: [] };
  }
  if (perf.budget.currentBudget != null) {
    summaryZh.push(`当前预算 ${money(perf.budget.currentBudget, ccy)}，实际成本 ${money(perf.actual.actualCost, ccy)}（已用 ${perf.usedPct ?? "—"}%），剩余 ${perf.remaining != null ? money(perf.remaining, ccy) : "—"}。`);
  } else summaryZh.push("尚无生效预算，无法做预算对比。");
  const overs = perf.byCategory.filter((c) => c.overBudget).map((c) => ({ category: c.category, overAmount: c.varianceAmount, overPct: c.overBudgetPct })).sort((a, b) => b.overAmount - a.overAmount);
  if (overs.length > 0) {
    const top = overs[0]!;
    summaryZh.push(`超预算类别 ${overs.length} 个，最大为 ${top.category}：超 ${money(top.overAmount, ccy)}${top.overPct != null ? `（${top.overPct}%）` : ""}。`);
    recommendationsZh.push(`复核 ${top.category} 的实际成本来源（费用审批 / 供应商发票），确认是否需要变更单或预算修订版本。`);
  }
  const missing = perf.byCategory.filter((c) => c.budget > 0 && c.actual === 0).map((c) => c.category);
  if (missing.length > 0) summaryZh.push(`尚无实际成本记录的预算类别：${missing.join("、")}（若已发生成本请及时录入）。`);
  let marginErosion: QuoteOperationsAnalysis["marginErosion"] = { detected: false, originalPct: perf.profit.originalExpectedMarginPct, forecastPct: perf.profit.currentForecastMarginPct, dropPp: null };
  if (perf.profit.originalExpectedMarginPct != null && perf.profit.currentForecastMarginPct != null) {
    const drop = Math.round((perf.profit.originalExpectedMarginPct - perf.profit.currentForecastMarginPct) * 100) / 100;
    marginErosion = { detected: drop >= 2, originalPct: perf.profit.originalExpectedMarginPct, forecastPct: perf.profit.currentForecastMarginPct, dropPp: drop };
    if (drop >= 2) {
      summaryZh.push(`预测毛利率 ${perf.profit.currentForecastMarginPct}% 低于批准报价 ${perf.profit.originalExpectedMarginPct}%，下降 ${drop} 个百分点${perf.profit.change != null ? `（利润变化 ${money(perf.profit.change, ccy)}）` : ""}。`);
      recommendationsZh.push("核对报价假设与实际采购/安装成本的差异，必要时用变更单（Change Order）覆盖范围外工作。");
    }
  }
  const fin = perf.byCategory.find((c) => c.category === "FINANCING" || c.category === "OVERHEAD");
  const financingRisk = perf.actual.committedCost > 0 && perf.remaining != null && perf.actual.committedCost > perf.remaining
    ? { detected: true, reasonZh: `已承诺成本 ${money(perf.actual.committedCost, ccy)} 超过剩余预算 ${money(perf.remaining, ccy)}，存在资金缺口风险。` }
    : fin && fin.overBudget
      ? { detected: true, reasonZh: `${fin.category} 已超预算，融资/管理费用承压。` }
      : { detected: false, reasonZh: null };
  if (financingRisk.detected && financingRisk.reasonZh) { summaryZh.push(financingRisk.reasonZh); recommendationsZh.push("提前安排付款节奏与现金流（Payment ≠ Cost：未结报销不阻塞利润，但影响现金）。"); }
  const shares = [...(extra?.supplierShares ?? [])].sort((a, b) => b.sharePct - a.sharePct);
  const supplierConcentration = shares[0] && shares[0].sharePct >= 60 ? { detected: true, topSupplier: shares[0].supplierName, sharePct: shares[0].sharePct } : { detected: false, topSupplier: shares[0]?.supplierName ?? null, sharePct: shares[0]?.sharePct ?? null };
  if (supplierConcentration.detected) { summaryZh.push(`供应商集中度高：${supplierConcentration.topSupplier} 占直接成本 ${supplierConcentration.sharePct}%。`); recommendationsZh.push("为核心供应商准备备选来源或锁价协议，降低单一供应商风险。"); }
  if (!perf.forecast.available) recommendationsZh.push("录入「预计剩余成本」（人工预测）以获得完工预测与利润预测；系统不会凭空推算进度。");
  if (perf.warnings.some((w) => w.code === "CONTINGENCY_LOW")) recommendationsZh.push("不可预见费接近用尽：评估剩余风险并决定是否动用利润缓冲。");
  if (recommendationsZh.length === 0) recommendationsZh.push("当前未发现需要处理的财务异常；保持费用及时审批与预算行关联。");
  return { version: QUOTE_OPERATIONS_ANALYSIS_VERSION, summaryZh, topOverruns: overs.slice(0, 5), missingCosts: missing, marginErosion, financingRisk, supplierConcentration, recommendationsZh };
}
