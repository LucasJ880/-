/**
 * Quote & Cost Engine · 计算单测（QC-01..20）
 * 运行：npx tsx src/lib/quote-engine/__tests__/quote-calc.test.ts
 * 含任务书回归算例 1/2/3；纯函数，零 DB。
 */
import { assertFiniteDeep, computeQuote, computeScenarios, sellingPriceFromCost, validateLines } from "@/lib/quote-engine/calc";
import { computeTiers, computeUnitEconomics, containersFor, validateStandingOffer, validateTiers } from "@/lib/quote-engine/standing-offer";
import type { CostLineInput } from "@/lib/quote-engine/contract";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;
let seq = 0;
const line = (p: Partial<CostLineInput> & { category: string; calculationType: string }): CostLineInput => ({
  id: p.id ?? `L${++seq}`,
  sortOrder: seq,
  description: p.description ?? p.category,
  quantity: null,
  unit: null,
  unitCost: null,
  sourceCurrency: "CAD",
  fxRate: null,
  calculationBase: null,
  rate: null,
  duration: null,
  included: true,
  ...p,
});

console.log("Quote & Cost Engine 计算单测");

// QC-01 各计算类型
{
  const r = computeQuote({
    quoteCurrency: "CAD",
    pricing: { method: "MARKUP_ON_COST", rate: 0 },
    lines: [
      line({ category: "PERMIT", calculationType: "FIXED", unitCost: 5000 }),
      line({ category: "MATERIAL", calculationType: "PER_UNIT", quantity: 250, unitCost: 14.67 }),
      line({ category: "LABOUR", calculationType: "PER_HOUR", quantity: 1, duration: 320, unitCost: 55 }),
      line({ category: "EQUIPMENT", calculationType: "PER_DAY", duration: 18, unitCost: 350 }),
      line({ category: "PROJECT_MANAGEMENT", calculationType: "PER_MONTH", duration: 5, unitCost: 5000 }),
      line({ category: "SITE_GENERAL", calculationType: "PER_TRIP", duration: 3, unitCost: 3000 }),
      line({ category: "FREIGHT", calculationType: "PER_CONTAINER", duration: 3, unitCost: 10000 }),
    ],
  });
  ok(r.ok && r.lines.map((l) => l.amount).join(",") === "5000,3667.5,17600,6300,25000,9000,30000", "QC-01: FIXED/PER_UNIT/PER_HOUR/PER_DAY/PER_MONTH/PER_TRIP/PER_CONTAINER 逐行金额", r.ok ? r.lines.map((l) => l.amount) : r.errors);
  ok(r.ok && near(r.lines[1]!.amount, 3667.5), "QC-02（回归算例 3）: 250 × $14.67 = $3,667.50");
}
// QC-03 PERCENT_OF_COST 基数选择 + PERCENT_OF_CAPITAL 基数
{
  const r = computeQuote({
    quoteCurrency: "CAD",
    pricing: { method: "MARKUP_ON_COST", rate: 0 },
    lines: [
      line({ id: "proc", category: "PROCUREMENT", calculationType: "FIXED", unitCost: 100000 }),
      line({ id: "lab", category: "LABOUR", calculationType: "FIXED", unitCost: 20000 }),
      line({ id: "duty", category: "DUTY", calculationType: "PERCENT_OF_COST", calculationBase: "PROCUREMENT", rate: 18 }),
      line({ id: "fin", category: "FINANCING", calculationType: "PERCENT_OF_CAPITAL", rate: 8 }),
      line({ id: "cont", category: "CONTINGENCY", calculationType: "PERCENT_OF_COST", calculationBase: "DIRECT_COST", rate: 5 }),
    ],
  });
  const by = r.ok ? Object.fromEntries(r.lines.map((l) => [l.id, l])) : {};
  ok(r.ok && by.duty!.amount === 18000 && by.duty!.baseLabel === "PROCUREMENT", "QC-03a: Duty 18% × PROCUREMENT 基数 = 18,000（基数显式）");
  ok(r.ok && by.fin!.amount === 8000 && by.fin!.baseLabel === "CAPITAL", "QC-03b: Financing 8% × CAPITAL（采购+物流+关税类直接成本）= 8,000，基数可追溯");
  ok(r.ok && by.cont!.amount === 6000 && r.baseCost === 152000, "QC-03c: Contingency 5% × DIRECT_COST(120,000) = 6,000；baseCost = 152,000（百分比行不互相引用 → 无循环）");
}
// QC-04 回归算例 1：收入基数 3%+8%+5% → 51,900/(1−16%) = 61,785.71，≠ 60,204
{
  const r = computeQuote({
    quoteCurrency: "CAD",
    pricing: { method: "MARKUP_ON_COST", rate: 0 },
    lines: [
      line({ category: "PROCUREMENT", calculationType: "FIXED", unitCost: 51900 }),
      line({ category: "FINANCING", calculationType: "PERCENT_OF_REVENUE", rate: 3 }),
      line({ category: "ADMIN", calculationType: "PERCENT_OF_REVENUE", rate: 8 }),
      line({ category: "PROFIT", calculationType: "PERCENT_OF_REVENUE", rate: 5 }),
    ],
  });
  ok(r.ok && near(r.sellingPrice, 61785.71) && !near(r.sellingPrice, 60204, 1), `QC-04（回归算例 1）: 卖价 ${r.ok ? r.sellingPrice : "?"} = 61,785.71（不是 51,900×1.16=60,204）`);
  ok(r.ok && near(r.estimatedCost, 51900 + 61785.71 * 0.11, 0.05) && near(r.grossProfit, 61785.71 * 0.05, 0.05), "QC-04b: 估算成本含收入基数 Admin/Financing，PROFIT 行不计成本；毛利 = 5% 售价");
}
// QC-05 Markup vs Margin 区分
{
  ok(sellingPriceFromCost(100, "MARKUP_ON_COST", 20) === 120 && sellingPriceFromCost(100, "MARGIN_ON_REVENUE", 20) === 125, "QC-05: Cost 100 → Markup 20% = 120；Margin 20% = 125");
  const mk = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARKUP_ON_COST", rate: 20 }, lines: [line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 100 })] });
  const mg = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 20 }, lines: [line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 100 })] });
  ok(mk.ok && mg.ok && mk.sellingPrice === 120 && mg.sellingPrice === 125 && mk.grossMarginPct === 16.6667 && mg.grossMarginPct === 20 && mg.markupPct === 25, "QC-05b: 引擎口径——Markup 20% → 售价 120/毛利率 16.67%；Margin 20% → 售价 125/加成 25%");
}
// QC-06 收入基数 + 定价规则叠加：(C + markup×C)/(1 − Σrev − margin)
{
  const r = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 10 }, lines: [line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 1000 }), line({ category: "COMMISSION", calculationType: "PERCENT_OF_REVENUE", rate: 6 })] });
  ok(r.ok && near(r.sellingPrice, 1000 / 0.84) && near(r.grossProfit, (1000 / 0.84) * 0.1, 0.02), "QC-06: Margin 10% + Commission 6%(revenue) → 售价 1000/0.84；毛利恰 10% 售价");
}
// QC-07 校验：Σrev ≥ 100 / margin ≥ 100 / 数量 ≤ 0 / 单价 < 0 / FX ≤ 0 / 无效基数 / CUSTOM_FORMULA
{
  const bad = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARKUP_ON_COST", rate: 0 }, lines: [line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 100 }), line({ category: "ADMIN", calculationType: "PERCENT_OF_REVENUE", rate: 60 }), line({ category: "COMMISSION", calculationType: "PERCENT_OF_REVENUE", rate: 40 })] });
  ok(!bad.ok && bad.errors.some((e) => e.code === "REVENUE_PCT_TOTAL_TOO_HIGH"), "QC-07a: 收入基数合计 ≥ 100% → 明确报错（不产出 Infinity）");
  const errs = validateLines([
    line({ id: "q", category: "MATERIAL", calculationType: "PER_UNIT", quantity: 0, unitCost: 5 }),
    line({ id: "u", category: "MATERIAL", calculationType: "FIXED", unitCost: -1 }),
    line({ id: "f", category: "MATERIAL", calculationType: "FIXED", unitCost: 1, sourceCurrency: "USD", fxRate: 0 }),
    line({ id: "b", category: "DUTY", calculationType: "PERCENT_OF_COST", calculationBase: "REVENUE", rate: 5 }),
    line({ id: "c", category: "OTHER", calculationType: "CUSTOM_FORMULA", unitCost: 1 }),
    line({ id: "x", category: "NOT_A_CATEGORY", calculationType: "FIXED", unitCost: 1 }),
  ]);
  const codes = new Set(errs.map((e) => e.code));
  ok(["QUANTITY_INVALID", "UNIT_COST_NEGATIVE", "FX_INVALID", "INVALID_COST_BASE", "CUSTOM_FORMULA_UNSUPPORTED", "INVALID_CATEGORY"].every((c) => codes.has(c)), "QC-07b: 数量≤0 / 单价<0 / FX≤0 / 无效基数 / 自定义公式 / 未知类别 全部明确报错", [...codes]);
  const mg = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 100 }, lines: [line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 1 })] });
  ok(!mg.ok && mg.errors.some((e) => e.code === "MARGIN_TOO_HIGH"), "QC-07c: Margin ≥ 100% 报错");
}
// QC-08 FX 折算
{
  const r = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARKUP_ON_COST", rate: 0 }, lines: [line({ category: "PROCUREMENT", calculationType: "PER_UNIT", quantity: 100, unitCost: 50, sourceCurrency: "CNY", fxRate: 0.19 })] });
  ok(r.ok && r.lines[0]!.amount === 950 && r.lines[0]!.fxApplied, "QC-08: CNY 行 100 × 50 × 0.19 = 950 CAD（fxApplied 标记）");
  const miss = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARKUP_ON_COST", rate: 0 }, lines: [line({ category: "PROCUREMENT", calculationType: "FIXED", unitCost: 50, sourceCurrency: "USD", fxRate: null })] });
  ok(!miss.ok && miss.errors.some((e) => e.code === "FX_REQUIRED"), "QC-08b: 外币行缺汇率 → FX_REQUIRED");
}
// QC-09 情景（参数可配置，不硬编码）
{
  const s = computeScenarios({ baseCost: 1000, revenuePctTotal: 6, revenueBasedProfitPct: 0, params: [{ key: "a", labelZh: "A", method: "MARGIN_ON_REVENUE", rate: 5 }, { key: "b", labelZh: "B", method: "MARKUP_ON_COST", rate: 20 }], risk: { high: 8, medium: 12 } });
  ok(s.length === 2 && near(s[0]!.sellingPrice, 1000 / 0.89) && s[0]!.risk === "HIGH" && near(s[1]!.sellingPrice, 1200 / 0.94) && s[1]!.grossMarginPct > 12 && s[1]!.risk === "LOW", "QC-09: 情景参数驱动（Margin 5% → HIGH 风险；Markup 20% → LOW）", s);
}
// QC-10 分解：利润单列不当成本；%售价/%成本
{
  const r = computeQuote({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 20 }, lines: [line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 800 }), line({ category: "LABOUR", calculationType: "FIXED", unitCost: 200 })] });
  const profit = r.ok ? r.breakdown.find((b) => b.category === "PROFIT") : null;
  const material = r.ok ? r.breakdown.find((b) => b.category === "MATERIAL") : null;
  ok(r.ok && profit?.amount === 250 && profit.pctOfSelling === 20 && material?.pctOfSelling === 64 && material.pctOfCost === 80, "QC-10: 售价 1250；利润 250 单列（20% 售价）；材料 64% 售价 / 80% 成本");
}
// QC-11 Standing Offer 单位经济 + 回归算例 2（箱数）
{
  const so = { supplierCostPerPiece: 0.5, piecesPerBox: 50, boxesPerContainer: 27167, freightPerContainer: 10000, customsPerContainer: 500, dutyPct: 0, warehousePerContainer: 1000 };
  const u = computeUnitEconomics(so, "CAD");
  ok(u.piecesPerContainer === 1358350 && u.supplierPerContainer === 679175 && u.landedPerContainer === 690675 && near(u.landedPerPiece, 0.5085, 0.0001), "QC-11a: 27,167 箱 × 50 件 = 1,358,350 件/柜；到岸 = 货值 + 运费 + 清关 + 仓储", u);
  const c = containersFor(3750000, 1358350);
  ok(near(c.math, 2.7607, 0.0001) && c.procurement === 3, `QC-11b（回归算例 2）: 3,750,000 / 1,358,350 = ${c.math}（数学）→ 采购 CEILING = 3`);
  ok(containersFor(1358350, 1358350).procurement === 1 && containersFor(0, 1358350).procurement === 0, "QC-11c: 整数柜不多进一；零数量零柜");
  ok(validateStandingOffer({ supplierCostPerPiece: 1, piecesPerBox: 0, boxesPerContainer: 10 }).some((e) => e.code === "SO_PIECES_PER_BOX"), "QC-11d: 容量 ≤ 0 报错");
}
// QC-12 分级：重叠/缺口/重复/期望数量出界；计算与主引擎同口径
{
  const tiers = [
    { id: "t1", sortOrder: 1, tierName: "Level 1", minQuantity: 1, maxQuantity: 325000, expectedQuantity: 325000, pricingMethod: "MARGIN_ON_REVENUE", rate: 20, active: true },
    { id: "t2", sortOrder: 2, tierName: "Level 2", minQuantity: 325001, maxQuantity: 3750000, expectedQuantity: 3750000, pricingMethod: "MARGIN_ON_REVENUE", rate: 15, active: true },
  ];
  ok(validateTiers(tiers).length === 0, "QC-12a: 连续分级无错");
  const overlap = validateTiers([{ ...tiers[0]!, maxQuantity: 400000 }, tiers[1]!]);
  const gap = validateTiers([{ ...tiers[0]!, maxQuantity: 300000 }, tiers[1]!]);
  const dup = validateTiers([tiers[0]!, { ...tiers[1]!, tierName: "Level 1" }]);
  const out = validateTiers([{ ...tiers[0]!, expectedQuantity: 400000 }, tiers[1]!]);
  ok(overlap.some((e) => e.code === "TIER_OVERLAP") && gap.some((e) => e.code === "TIER_GAP") && dup.some((e) => e.code === "TIER_DUPLICATE") && out.some((e) => e.code === "TIER_EXPECTED_OUT_OF_RANGE"), "QC-12b: 重叠 / 缺口(警告) / 重复有效分级 / 期望数量出界 全部识别");
  const u = computeUnitEconomics({ supplierCostPerPiece: 0.5, piecesPerBox: 50, boxesPerContainer: 27167, freightPerContainer: 10000 }, "CAD");
  const res = computeTiers({ tiers, unit: u, revenuePctTotal: 0, boxesPerContainer: 27167, piecesPerBox: 50 });
  ok(res.length === 2 && res[1]!.containersMath === 2.7607 && res[1]!.containersProcurement === 3 && near(res[1]!.unitPrice, u.landedPerPiece / 0.85, 0.0001) && res[1]!.calculatedMargin === 15 && near(res[1]!.boxPrice, res[1]!.unitPrice * 50, 0.01), "QC-12c: Level 2 = 2.7607/3 柜；单件价 = 到岸/(1−15%)；箱价 = 单件 × 50；毛利率 15%", res[1]);
}
// QC-13 NaN/Infinity 守卫
{
  let threw = false;
  try { assertFiniteDeep({ a: 1, b: [2, { c: Infinity }] }); } catch { threw = true; }
  ok(threw, "QC-13: assertFiniteDeep 拦截 Infinity（禁 NaN/Infinity 入库）");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
