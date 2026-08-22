/**
 * Quote & Cost Engine · 纯计算（零 IO、零 AI、禁 eval）。
 *
 * 两遍求值：
 *  ① 直接成本行（FIXED / PER_* / FX 折算）→ 各基数（DIRECT_COST / PROCUREMENT / LANDED / CAPITAL / CATEGORY:x）
 *  ② 成本百分比行（PERCENT_OF_COST / PERCENT_OF_CAPITAL）只能引用第 ① 遍基数（不得互相引用 → 无循环）
 *  ③ 卖价：SellingPrice = (C + profitOnCost) / (1 − Σrev% − marginOnRevenue)
 *     其中 C = ① + ②，profitOnCost = markup × C（MARKUP_ON_COST），marginOnRevenue = rate（MARGIN_ON_REVENUE）
 *     Σrev% = PERCENT_OF_REVENUE 行（Admin/Commission/Financing/Profit-target…）之和
 *     —— 绝不写成 C × (1 + Σrev%)
 *  ④ 收入基数行金额 = rate × SellingPrice；利润 = SellingPrice − 全部成本（含收入基数行）
 */

import {
  CAPITAL_CATEGORIES,
  COST_CATEGORIES,
  DEFAULT_SCENARIOS,
  LANDED_CATEGORIES,
  PERCENT_OF_COST_TYPES,
  PROCUREMENT_CATEGORIES,
  QUOTE_ENGINE_CALC_VERSION,
  REVENUE_BASED_TYPES,
  type CostLineInput,
  type EngineConfig,
  type PricingRuleInput,
  type QuoteValidationError,
  type ScenarioParam,
} from "./contract";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
export const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type LineResult = {
  id: string;
  category: string;
  calculationType: string;
  included: boolean;
  /** 报价币种金额（未纳入时 0） */
  amount: number;
  /** 基数说明（百分比行） */
  baseAmount: number | null;
  baseLabel: string | null;
  fxApplied: boolean;
};

export type Breakdown = { category: string; amount: number; pctOfSelling: number; pctOfCost: number };

export type QuoteCalcResult = {
  ok: true;
  calcVersion: typeof QUOTE_ENGINE_CALC_VERSION;
  lines: LineResult[];
  directCost: number;
  percentOfCostTotal: number;
  /** 不含收入基数行、不含利润的成本 = ① + ② */
  baseCost: number;
  revenuePctTotal: number;
  pricing: { method: string; rate: number; profitOnCost: number; marginOnRevenue: number };
  sellingPrice: number;
  revenueBasedCost: number;
  /** 全部成本（含收入基数行，不含利润） */
  estimatedCost: number;
  grossProfit: number;
  grossMarginPct: number;
  markupPct: number;
  cashRequired: number;
  financingCost: number;
  contingency: number;
  breakdown: Breakdown[];
  scenarios: ScenarioResult[];
  tax: { subtotal: number; gst: number; hst: number; pst: number; total: number };
  warnings: QuoteValidationError[];
};

export type QuoteCalcFailure = { ok: false; errors: QuoteValidationError[] };

export type ScenarioResult = {
  key: string;
  labelZh: string;
  method: string;
  rate: number;
  sellingPrice: number;
  grossProfit: number;
  grossMarginPct: number;
  markupPct: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
};

/* ------------------------------- 校验 ------------------------------- */

export function validateLines(lines: CostLineInput[]): QuoteValidationError[] {
  const errors: QuoteValidationError[] = [];
  for (const l of lines) {
    const e = (code: string, message: string) => errors.push({ code, message, lineId: l.id });
    if (!(COST_CATEGORIES as readonly string[]).includes(l.category)) e("INVALID_CATEGORY", `未知成本类别 ${l.category}`);
    if (l.calculationType === "CUSTOM_FORMULA") e("CUSTOM_FORMULA_UNSUPPORTED", "Phase 1 不开放自定义公式（禁 eval）");
    if (l.calculationType === "TIER_BASED") e("TIER_BASED_ON_LINE", "TIER_BASED 由 Standing Offer 分级承载，不作为成本行");
    if (!l.included) continue;
    const isPct = PERCENT_OF_COST_TYPES.includes(l.calculationType as never) || REVENUE_BASED_TYPES.includes(l.calculationType as never);
    if (isPct) {
      if (!isFiniteNum(l.rate)) e("RATE_REQUIRED", "百分比行必须有 rate");
      else if (l.rate < 0) e("RATE_NEGATIVE", "rate 不得为负");
      if (l.calculationType === "PERCENT_OF_REVENUE" && isFiniteNum(l.rate) && l.rate >= 100) e("REVENUE_PCT_TOO_HIGH", "单项收入基数 ≥ 100%");
      if (PERCENT_OF_COST_TYPES.includes(l.calculationType as never)) {
        const base = l.calculationBase ?? (l.calculationType === "PERCENT_OF_CAPITAL" ? "CAPITAL" : "DIRECT_COST");
        if (base === "REVENUE") e("INVALID_COST_BASE", "PERCENT_OF_COST 不能以 REVENUE 为基数（请用 PERCENT_OF_REVENUE）");
        if (base.startsWith("CATEGORY:") && !(COST_CATEGORIES as readonly string[]).includes(base.slice(9))) e("INVALID_COST_BASE", `未知基数 ${base}`);
        if (!base.startsWith("CATEGORY:") && !["DIRECT_COST", "PROCUREMENT", "LANDED", "CAPITAL"].includes(base)) e("INVALID_COST_BASE", `未知基数 ${base}`);
      }
      continue;
    }
    if (l.calculationType === "FIXED") {
      if (!isFiniteNum(l.unitCost)) e("UNIT_COST_REQUIRED", "FIXED 行需要金额");
      else if (l.unitCost < 0) e("UNIT_COST_NEGATIVE", "金额不得为负");
    } else {
      if (!isFiniteNum(l.unitCost)) e("UNIT_COST_REQUIRED", "需要单价/费率");
      else if (l.unitCost < 0) e("UNIT_COST_NEGATIVE", "单价不得为负");
      if (l.calculationType === "PER_UNIT") {
        if (!isFiniteNum(l.quantity) || l.quantity <= 0) e("QUANTITY_INVALID", "数量必须 > 0");
      } else {
        if (!isFiniteNum(l.duration) || l.duration <= 0) e("DURATION_INVALID", "时长/次数/箱数必须 > 0");
        if (l.quantity != null && l.quantity < 0) e("QUANTITY_INVALID", "数量不得为负");
      }
    }
    if (l.fxRate != null && !(l.fxRate > 0)) e("FX_INVALID", "汇率必须 > 0");
  }
  return errors;
}

/* ------------------------------- 求值 ------------------------------- */

function fxOf(l: CostLineInput, quoteCurrency: string): { rate: number; applied: boolean } {
  if (!l.sourceCurrency || l.sourceCurrency === quoteCurrency) return { rate: 1, applied: false };
  return { rate: l.fxRate ?? NaN, applied: true };
}

function directAmount(l: CostLineInput, quoteCurrency: string): number {
  const fx = fxOf(l, quoteCurrency);
  const unit = (l.unitCost ?? 0) * fx.rate;
  switch (l.calculationType) {
    case "FIXED":
      return unit;
    case "PER_UNIT":
      return (l.quantity ?? 0) * unit;
    case "PER_HOUR":
    case "PER_DAY":
    case "PER_MONTH":
    case "PER_TRIP":
    case "PER_CONTAINER":
      // quantity = 人数/台数/份数（缺省 1）；duration = 小时/天/月/次/箱
      return (l.quantity == null ? 1 : l.quantity) * (l.duration ?? 0) * unit;
    default:
      return 0;
  }
}

export function computeQuote(input: {
  quoteCurrency: string;
  lines: CostLineInput[];
  pricing: PricingRuleInput;
  engine?: EngineConfig | null;
}): QuoteCalcResult | QuoteCalcFailure {
  const errors = validateLines(input.lines);
  const pricingRate = input.pricing.rate ?? 0;
  if (!isFiniteNum(pricingRate) || pricingRate < 0) errors.push({ code: "PRICING_RATE_INVALID", message: "定价比例无效" });
  if (input.pricing.method === "MARGIN_ON_REVENUE" && pricingRate >= 100) errors.push({ code: "MARGIN_TOO_HIGH", message: "Margin ≥ 100%" });
  for (const l of input.lines) {
    if (l.included && l.sourceCurrency !== input.quoteCurrency && !(l.fxRate && l.fxRate > 0)) errors.push({ code: "FX_REQUIRED", message: `${l.sourceCurrency}→${input.quoteCurrency} 需要汇率`, lineId: l.id });
  }
  if (errors.length > 0) return { ok: false, errors };

  const included = input.lines.filter((l) => l.included);
  const results = new Map<string, LineResult>();
  // ① 直接成本
  const byCategory = new Map<string, number>();
  let directCost = 0;
  for (const l of included) {
    const isPct = PERCENT_OF_COST_TYPES.includes(l.calculationType as never) || REVENUE_BASED_TYPES.includes(l.calculationType as never);
    if (isPct) continue;
    const amt = round2(directAmount(l, input.quoteCurrency));
    directCost += amt;
    byCategory.set(l.category, (byCategory.get(l.category) ?? 0) + amt);
    results.set(l.id, { id: l.id, category: l.category, calculationType: l.calculationType, included: true, amount: amt, baseAmount: null, baseLabel: null, fxApplied: fxOf(l, input.quoteCurrency).applied });
  }
  const sumCats = (cats: readonly string[]) => cats.reduce((s, c) => s + (byCategory.get(c) ?? 0), 0);
  const bases: Record<string, number> = {
    DIRECT_COST: directCost,
    PROCUREMENT: sumCats(PROCUREMENT_CATEGORIES),
    LANDED: sumCats(LANDED_CATEGORIES),
    CAPITAL: sumCats(CAPITAL_CATEGORIES),
  };
  const baseOf = (l: CostLineInput): { amount: number; label: string } => {
    const key = l.calculationBase ?? (l.calculationType === "PERCENT_OF_CAPITAL" ? "CAPITAL" : "DIRECT_COST");
    if (key.startsWith("CATEGORY:")) return { amount: byCategory.get(key.slice(9)) ?? 0, label: key };
    return { amount: bases[key] ?? 0, label: key };
  };
  // ② 成本百分比行（仅引用 ① 基数）
  let percentOfCostTotal = 0;
  const pctCatAdds = new Map<string, number>();
  for (const l of included) {
    if (!PERCENT_OF_COST_TYPES.includes(l.calculationType as never)) continue;
    const b = baseOf(l);
    const amt = round2((b.amount * (l.rate ?? 0)) / 100);
    percentOfCostTotal += amt;
    pctCatAdds.set(l.category, (pctCatAdds.get(l.category) ?? 0) + amt);
    results.set(l.id, { id: l.id, category: l.category, calculationType: l.calculationType, included: true, amount: amt, baseAmount: round2(b.amount), baseLabel: b.label, fxApplied: false });
  }
  const baseCost = round2(directCost + percentOfCostTotal);
  // ③ 卖价
  const revLines = included.filter((l) => REVENUE_BASED_TYPES.includes(l.calculationType as never));
  const revenuePctTotal = revLines.reduce((s, l) => s + (l.rate ?? 0), 0);
  const marginOnRevenue = input.pricing.method === "MARGIN_ON_REVENUE" ? pricingRate : 0;
  const markup = input.pricing.method === "MARKUP_ON_COST" ? pricingRate : 0;
  const denomPct = revenuePctTotal + marginOnRevenue;
  if (denomPct >= 100) {
    return { ok: false, errors: [{ code: "REVENUE_PCT_TOTAL_TOO_HIGH", message: `收入基数百分比合计 ${denomPct}% ≥ 100%，无法定价（循环/除零）` }] };
  }
  const profitOnCost = round2((baseCost * markup) / 100);
  const sellingPrice = round2((baseCost + profitOnCost) / (1 - denomPct / 100));
  if (!Number.isFinite(sellingPrice)) return { ok: false, errors: [{ code: "DIVISION_BY_ZERO", message: "卖价计算出现除零/无穷" }] };
  // ④ 收入基数行
  let revenueBasedCost = 0;
  for (const l of revLines) {
    const amt = round2((sellingPrice * (l.rate ?? 0)) / 100);
    revenueBasedCost += amt;
    pctCatAdds.set(l.category, (pctCatAdds.get(l.category) ?? 0) + amt);
    results.set(l.id, { id: l.id, category: l.category, calculationType: l.calculationType, included: true, amount: amt, baseAmount: sellingPrice, baseLabel: "REVENUE", fxApplied: false });
  }
  for (const l of input.lines) {
    if (!results.has(l.id)) results.set(l.id, { id: l.id, category: l.category, calculationType: l.calculationType, included: false, amount: 0, baseAmount: null, baseLabel: null, fxApplied: false });
  }
  // 利润：PROFIT 类别的收入基数行视作利润目标（不计入成本）
  const profitLinesAmt = revLines.filter((l) => l.category === "PROFIT").reduce((s, l) => s + (results.get(l.id)?.amount ?? 0), 0);
  const estimatedCost = round2(baseCost + revenueBasedCost - profitLinesAmt);
  const grossProfit = round2(sellingPrice - estimatedCost);
  const grossMarginPct = sellingPrice > 0 ? round4((grossProfit / sellingPrice) * 100) : 0;
  const markupPct = estimatedCost > 0 ? round4((grossProfit / estimatedCost) * 100) : 0;
  // 分解
  const totals = new Map<string, number>();
  for (const [c, v] of byCategory) totals.set(c, (totals.get(c) ?? 0) + v);
  for (const [c, v] of pctCatAdds) totals.set(c, (totals.get(c) ?? 0) + v);
  // 利润（定价规则产生的）单列，不当采购成本
  totals.set("PROFIT", (totals.get("PROFIT") ?? 0) + (grossProfit - profitLinesAmt > 0 ? round2(grossProfit - profitLinesAmt) : 0));
  const breakdown: Breakdown[] = [...totals.entries()]
    .filter(([, v]) => Math.abs(v) > 0.004)
    .map(([category, amount]) => ({ category, amount: round2(amount), pctOfSelling: sellingPrice > 0 ? round4((amount / sellingPrice) * 100) : 0, pctOfCost: estimatedCost > 0 ? round4((amount / estimatedCost) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const financingCost = round2((totals.get("FINANCING") ?? 0));
  const contingency = round2((totals.get("CONTINGENCY") ?? 0));
  const cashRequired = round2(bases.CAPITAL + (pctCatAdds.get("DUTY") ?? 0) + (pctCatAdds.get("CUSTOMS") ?? 0));
  const scenarios = computeScenarios({ baseCost, revenuePctTotal, revenueBasedProfitPct: revLines.filter((l) => l.category === "PROFIT").reduce((s, l) => s + (l.rate ?? 0), 0), params: input.engine?.scenarios ?? DEFAULT_SCENARIOS, risk: input.engine?.marginRiskPct });
  const tax = computeTax(sellingPrice, input.engine?.tax);
  const warnings: QuoteValidationError[] = [];
  if (!included.some((l) => l.category === "CONTINGENCY")) warnings.push({ code: "NO_CONTINGENCY", message: "当前报价没有显式 contingency" });
  if (grossMarginPct < 0) warnings.push({ code: "NEGATIVE_MARGIN", message: "毛利为负" });
  return {
    ok: true,
    calcVersion: QUOTE_ENGINE_CALC_VERSION,
    lines: input.lines.map((l) => results.get(l.id)!),
    directCost: round2(directCost),
    percentOfCostTotal: round2(percentOfCostTotal),
    baseCost,
    revenuePctTotal: round4(revenuePctTotal),
    pricing: { method: input.pricing.method, rate: pricingRate, profitOnCost, marginOnRevenue },
    sellingPrice,
    revenueBasedCost: round2(revenueBasedCost),
    estimatedCost,
    grossProfit,
    grossMarginPct,
    markupPct,
    cashRequired,
    financingCost,
    contingency,
    breakdown,
    scenarios,
    tax,
    warnings,
  };
}

export function computeScenarios(input: { baseCost: number; revenuePctTotal: number; revenueBasedProfitPct: number; params: ScenarioParam[]; risk?: { high: number; medium: number } }): ScenarioResult[] {
  const risk = input.risk ?? { high: 8, medium: 12 };
  // 情景用「利润目标」替换定价规则与 PROFIT 收入基数行；其它收入基数行保留
  const otherRev = input.revenuePctTotal - input.revenueBasedProfitPct;
  return input.params.map((p) => {
    const margin = p.method === "MARGIN_ON_REVENUE" ? p.rate : 0;
    const markup = p.method === "MARKUP_ON_COST" ? p.rate : 0;
    const denom = 1 - (otherRev + margin) / 100;
    const sellingPrice = denom > 0 ? round2((input.baseCost * (1 + markup / 100)) / denom) : NaN;
    const cost = Number.isFinite(sellingPrice) ? round2(input.baseCost + (sellingPrice * otherRev) / 100) : NaN;
    const gp = Number.isFinite(sellingPrice) ? round2(sellingPrice - cost) : NaN;
    const gm = Number.isFinite(sellingPrice) && sellingPrice > 0 ? round4((gp / sellingPrice) * 100) : NaN;
    const mk = Number.isFinite(cost) && cost > 0 ? round4((gp / cost) * 100) : NaN;
    const r: ScenarioResult["risk"] = !Number.isFinite(gm) || gm < risk.high ? "HIGH" : gm < risk.medium ? "MEDIUM" : "LOW";
    return { key: p.key, labelZh: p.labelZh, method: p.method, rate: p.rate, sellingPrice: Number.isFinite(sellingPrice) ? sellingPrice : 0, grossProfit: Number.isFinite(gp) ? gp : 0, grossMarginPct: Number.isFinite(gm) ? gm : 0, markupPct: Number.isFinite(mk) ? mk : 0, risk: r };
  });
}

export function computeTax(subtotal: number, tax?: { gstPct?: number | null; hstPct?: number | null; pstPct?: number | null } | null) {
  const gst = round2((subtotal * (tax?.gstPct ?? 0)) / 100);
  const hst = round2((subtotal * (tax?.hstPct ?? 0)) / 100);
  const pst = round2((subtotal * (tax?.pstPct ?? 0)) / 100);
  return { subtotal: round2(subtotal), gst, hst, pst, total: round2(subtotal + gst + hst + pst) };
}

/** 定价规则换算（UI 显示两种口径） */
export function sellingPriceFromCost(cost: number, method: string, ratePct: number): number {
  if (method === "MARGIN_ON_REVENUE") return ratePct >= 100 ? NaN : round2(cost / (1 - ratePct / 100));
  return round2(cost * (1 + ratePct / 100));
}

/** 禁 NaN/Infinity 流入数据库 */
export function assertFiniteDeep(obj: unknown, path = "$"): void {
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) throw new Error(`NON_FINITE_VALUE at ${path}`);
    return;
  }
  if (Array.isArray(obj)) obj.forEach((v, i) => assertFiniteDeep(v, `${path}[${i}]`));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) assertFiniteDeep(v, `${path}.${k}`);
}
