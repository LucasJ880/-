/**
 * analyzeQuote() · Phase 1 确定性分析（advisory，不改报价）。
 * 接口边界固定（summary/costConcentration/marginRisk/financingRisk/labourRisk/missingCostItems/warnings/recommendations），
 * 未来可换 AI 实现或叠加历史中标/市场数据——本轮禁止伪造市场数据。
 */

import type { QuoteCalcResult } from "./calc";
import type { TierResult, UnitEconomics } from "./standing-offer";

export type QuoteAnalysis = {
  version: "quote-analyze/v1-deterministic";
  summary: string[];
  costConcentration: Array<{ category: string; pctOfSelling: number; pctOfCost: number }>;
  marginRisk: { level: "LOW" | "MEDIUM" | "HIGH"; grossMarginPct: number; note: string };
  financingRisk: { cashRequired: number; financingCost: number; pctOfSelling: number; note: string };
  labourRisk: { pctOfSelling: number; note: string } | null;
  missingCostItems: string[];
  warnings: string[];
  recommendations: string[];
  /** 未来情报钩子（本轮恒 null；禁伪造） */
  intelligence: { recommendedBidRange: null; basis: [] };
};

export function analyzeQuote(input: { quoteType: string; calc: QuoteCalcResult; standingOffer?: { unit: UnitEconomics | null; tiers: TierResult[] } | null; thresholds?: { high: number; medium: number } }): QuoteAnalysis {
  const c = input.calc;
  const th = input.thresholds ?? { high: 8, medium: 12 };
  const pct = (cat: string) => c.breakdown.find((b) => b.category === cat)?.pctOfSelling ?? 0;
  const sum = (cats: string[]) => cats.reduce((s, x) => s + pct(x), 0);
  const summary: string[] = [];
  const material = sum(["MATERIAL", "PROCUREMENT"]);
  const labourSite = sum(["LABOUR", "EQUIPMENT", "SITE_GENERAL"]);
  if (material > 0) summary.push(`Material represents ${material.toFixed(1)}% of final bid.`);
  if (labourSite > 0) summary.push(`Labour/site operations represent ${labourSite.toFixed(1)}%.`);
  summary.push(`Gross margin ${c.grossMarginPct.toFixed(1)}% (markup ${c.markupPct.toFixed(1)}%) on a bid of ${c.sellingPrice.toLocaleString("en-CA", { style: "currency", currency: "CAD" })}.`);
  const marginLevel: QuoteAnalysis["marginRisk"]["level"] = c.grossMarginPct < th.high ? "HIGH" : c.grossMarginPct < th.medium ? "MEDIUM" : "LOW";
  const missing: string[] = [];
  const has = (cat: string) => c.breakdown.some((b) => b.category === cat && b.amount > 0);
  if (!has("CONTINGENCY")) missing.push("Current quote has no explicit contingency.");
  if (input.quoteType === "PROJECT_SUPPLY_INSTALL") {
    for (const [cat, label] of [["PERMIT", "permit"], ["INSURANCE", "insurance"], ["PROJECT_MANAGEMENT", "project management"], ["FREIGHT", "freight"]] as const) if (!has(cat)) missing.push(`No ${label} cost line.`);
  }
  const warnings = c.warnings.map((w) => w.message);
  const recommendations: string[] = [];
  if (pct("COMMISSION") > 0) recommendations.push("Commission is revenue-based and materially reduces effective project margin — confirm it is contractual.");
  if (c.financingCost > 0 && c.cashRequired > 0) recommendations.push(`Financing cost ${c.financingCost.toLocaleString()} on ${c.cashRequired.toLocaleString()} cash required — check payment terms / deposit to reduce capital deployed.`);
  if (marginLevel === "HIGH") recommendations.push(`Gross margin below ${th.high}% — review scenarios before submission.`);
  if (input.quoteType === "STANDING_OFFER" && input.standingOffer?.tiers?.length) {
    const t = input.standingOffer.tiers;
    const frac = t.filter((x) => x.containersMath - Math.floor(x.containersMath) > 0.05 && x.containersProcurement > x.containersMath);
    if (frac.length) recommendations.push(`Procurement containers are rounded up (${frac.map((x) => `${x.tierName}: ${x.containersMath}→${x.containersProcurement}`).join("; ")}) — carrying cost of the partial container is not in landed cost per piece.`);
  }
  return {
    version: "quote-analyze/v1-deterministic",
    summary,
    costConcentration: c.breakdown.filter((b) => b.category !== "PROFIT").slice(0, 6).map((b) => ({ category: b.category, pctOfSelling: b.pctOfSelling, pctOfCost: b.pctOfCost })),
    marginRisk: { level: marginLevel, grossMarginPct: c.grossMarginPct, note: marginLevel === "LOW" ? "margin above configured threshold" : "margin below configured threshold" },
    financingRisk: { cashRequired: c.cashRequired, financingCost: c.financingCost, pctOfSelling: c.sellingPrice > 0 ? Math.round((c.cashRequired / c.sellingPrice) * 10000) / 100 : 0, note: "cash required = procurement + logistics + customs/duty before revenue" },
    labourRisk: labourSite > 0 ? { pctOfSelling: Math.round(labourSite * 100) / 100, note: labourSite > 35 ? "labour-heavy: schedule overruns hit margin directly" : "labour share moderate" } : null,
    missingCostItems: missing,
    warnings,
    recommendations,
    intelligence: { recommendedBidRange: null, basis: [] },
  };
}
