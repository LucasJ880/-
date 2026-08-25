/**
 * Quote & Cost Engine · 计算单测（QC-01..20）
 * 运行：npx tsx src/lib/quote-engine/__tests__/quote-calc.test.ts
 * 含任务书回归算例 1/2/3；纯函数，零 DB。
 */
import { assertFiniteDeep, computeQuote, computeScenarios, round4, sellingPriceFromCost, validateLines } from "@/lib/quote-engine/calc";
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

// QC-14（B1 fail-closed）：外币供应商成本必须有有限且 >0 的汇率；绝不默认 1:1
{
  const base = { supplierCostPerPiece: 10, piecesPerBox: 50, boxesPerContainer: 100 };
  const codes = (so: Parameters<typeof validateStandingOffer>[0]) => validateStandingOffer(so, "CAD").map((e) => e.code);
  ok(codes({ ...base, supplierCurrency: "CNY" }).includes("SO_FX_REQUIRED"), "QC-14a: CNY→CAD 缺汇率 = FAIL");
  ok(codes({ ...base, supplierCurrency: "USD" }).includes("SO_FX_REQUIRED"), "QC-14b: USD→CAD 缺汇率 = FAIL");
  ok(codes({ ...base, supplierCurrency: "CNY", fxRate: 0 }).includes("FX_INVALID") && codes({ ...base, supplierCurrency: "CNY", fxRate: -1 }).includes("FX_INVALID") && codes({ ...base, supplierCurrency: "CNY", fxRate: Infinity }).includes("FX_INVALID"), "QC-14c: CNY→CAD 汇率 ≤0 / 非有限 = FAIL");
  ok(codes({ ...base, supplierCurrency: "CAD" }).length === 0 && codes({ ...base }).length === 0, "QC-14d: CAD→CAD 无汇率 = PASS（同币种允许省略）");
  const okCase = { ...base, supplierCurrency: "CNY", fxRate: 0.19 };
  ok(codes(okCase).length === 0 && near(computeUnitEconomics(okCase, "CAD").exact.supplierPerPiece, 1.9, 1e-9), "QC-14e: CNY→CAD 有效汇率 = PASS 且按汇率折算（10 × 0.19 = 1.9）");
  let threw = false;
  try { computeUnitEconomics({ ...base, supplierCurrency: "CNY" }, "CAD"); } catch { threw = true; }
  ok(threw, "QC-14f（反例守卫）: computeUnitEconomics 对缺汇率外币直接抛错，不可能按 1:1 算");
}
// QC-15（B6 精度）：百万件级分级用全精度到岸单件成本，4 位显示值会产生实质漂移
{
  // 到岸/柜 = 700,000 + 10,000 + 500 + 1,000 = 711,500；件/柜 = 1,358,350 → 单件 0.523797... (非 4 位可表示)
  const so = { supplierCostPerPiece: 700000 / 1358350, piecesPerBox: 50, boxesPerContainer: 27167, freightPerContainer: 10000, customsPerContainer: 500, warehousePerContainer: 1000 };
  const u = computeUnitEconomics(so, "CAD");
  const qty = 3750000;
  const exactCost = qty * u.exact.landedPerPiece;
  const roundedCost = qty * u.landedPerPiece;
  const tiers = computeTiers({ tiers: [{ id: "t", sortOrder: 1, tierName: "L", minQuantity: 1, maxQuantity: null, expectedQuantity: qty, pricingMethod: "MARKUP_ON_COST", rate: 0, active: true }], unit: u, revenuePctTotal: 0, boxesPerContainer: 27167, piecesPerBox: 50 });
  ok(Math.abs(exactCost - roundedCost) > 1, `QC-15a: 4 位显示值在 3,750,000 件上漂移 ${Math.abs(exactCost - roundedCost).toFixed(2)} CAD（证明该回归有意义）`);
  ok(near(tiers[0]!.calculatedCost, exactCost, 0.01) && !near(tiers[0]!.calculatedCost, roundedCost, 0.5), "QC-15b: 分级成本 = 数量 × 全精度单件成本（不是显示值）");
  ok(u.landedPerPiece === round4(u.exact.landedPerPiece) && u.exact.landedPerContainer === 711500, "QC-15c: 显示值只做输出舍入，内部 exact 保持全精度");
}

// ─── Sunny 定价链 v1（calc/v2 冻结口径 2026-08-24；黄金例：成本100/毛利30% → 售价142.86/提成12.85/净利30） ───

// SP-01 Lucas 黄金例：按售价倒扣 + 提成=毛利30%（从毛利扣，不进分母）
{
  const r = computeQuote({ quoteCurrency: "CAD", lines: [
    line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 100 }),
    line({ id: "comm", category: "COMMISSION", calculationType: "PCT_OF_GROSS_PROFIT", rate: 30 }),
  ], pricing: { method: "MARGIN_ON_REVENUE", rate: 30 } });
  ok(r.ok, "SP-01a: 黄金例计算成功");
  if (r.ok) {
    const comm = r.lines.find((l) => l.id === "comm")!;
    ok(r.sellingPrice === 142.86, `SP-01b: 售价 = 142.86（100 ÷ 0.7）`, r.sellingPrice);
    ok(comm.amount === 12.86 && comm.baseLabel === "GROSS_PROFIT" && comm.baseAmount === 42.86, "SP-01c: 提成 = 毛利 42.86 × 30% = 12.86", comm);
    ok(r.estimatedCost === 112.86 && r.grossProfit === 30, "SP-01d: 全成本 112.86，净利恰 = 30.00（Lucas 例）", { cost: r.estimatedCost, net: r.grossProfit });
  }
}

// SP-02 提成不进定价分母：有无提成行，售价不变
{
  const mk = (withComm: boolean) => computeQuote({ quoteCurrency: "CAD", lines: [
    line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 100 }),
    ...(withComm ? [line({ category: "COMMISSION", calculationType: "PCT_OF_GROSS_PROFIT", rate: 30 })] : []),
  ], pricing: { method: "MARGIN_ON_REVENUE", rate: 30 } });
  const a = mk(true); const b = mk(false);
  ok(a.ok && b.ok && a.sellingPrice === b.sellingPrice, "SP-02: PCT_OF_GROSS_PROFIT 不改变售价（非收入基数行）");
}

// SP-03 全瀑布：材料80+其他20 → 关税25%（PROCUREMENT 基）→ 资金使用8%年化×⌈2.5⌉→3月 → 管理费3%自含 → CA 1% → 毛利25% → 提成30%
{
  const r = computeQuote({ quoteCurrency: "CAD", lines: [
    line({ id: "mat", category: "MATERIAL", calculationType: "FIXED", unitCost: 80 }),
    line({ id: "oth", category: "OTHER", calculationType: "FIXED", unitCost: 20 }),
    line({ id: "duty", category: "DUTY", calculationType: "PERCENT_OF_COST", calculationBase: "PROCUREMENT", rate: 25 }),
    line({ id: "fin", category: "FINANCING", calculationType: "PCT_ANNUALIZED_ON_COST", rate: 8, duration: 2.5 }),
    line({ id: "adm", category: "ADMIN", calculationType: "PCT_SELF_INCLUSIVE_ON_COST", rate: 3 }),
    line({ id: "ca", category: "OTHER", calculationType: "PCT_ON_COST_SUBTOTAL", rate: 1 }),
    line({ id: "comm", category: "COMMISSION", calculationType: "PCT_OF_GROSS_PROFIT", rate: 30 }),
  ], pricing: { method: "MARGIN_ON_REVENUE", rate: 25 } });
  ok(r.ok, "SP-03a: 全瀑布计算成功");
  if (r.ok) {
    const g = (id: string) => r.lines.find((l) => l.id === id)!.amount;
    ok(g("duty") === 20, "SP-03b: 关税 = 材料 80 × 25% = 20（PROCUREMENT 基数不吃 OTHER 行）");
    ok(g("fin") === 2.4, "SP-03c: 资金使用 = 120 × 8%/12 × 3 = 2.40（2.5 月进位 3 月）");
    ok(g("adm") === 3.79, "SP-03d: 管理费自含 = 122.40/0.97 − 122.40 = 3.79（不是 ×3% 的 3.67）", g("adm"));
    ok(g("ca") === 1.2, "SP-03e: cash allowance = (D+T) × 1% = 1.20（基数不含资金使用/管理费）");
    ok(r.chainedCostTotal === 7.39 && r.baseCost === 127.39, "SP-03f: 成本侧合计 = 127.39");
    ok(r.sellingPrice === 169.85 && g("comm") === 12.74, "SP-03g: 售价 169.85，提成 = 42.46 × 30% = 12.74");
    ok(r.estimatedCost === 140.13 && r.grossProfit === 29.72, "SP-03h: 全成本 140.13，净利 29.72");
  }
}

// SP-04 月取整边界（不足一月按一月）
{
  const fin = (duration: number) => {
    const r = computeQuote({ quoteCurrency: "CAD", lines: [
      line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 120 }),
      line({ id: "f", category: "FINANCING", calculationType: "PCT_ANNUALIZED_ON_COST", rate: 8, duration }),
    ], pricing: { method: "MARGIN_ON_REVENUE", rate: 0 } });
    return r.ok ? r.lines.find((l) => l.id === "f")!.amount : NaN;
  };
  ok(fin(0.2) === 0.8 && fin(1) === 0.8, "SP-04a: 0.2 月与 1 月都按 1 个月（0.80）");
  ok(fin(1.01) === 1.6 && fin(12) === 9.6, "SP-04b: 1.01 月进位 2 个月（1.60）；12 月 = 9.60");
}

// SP-05 校验语义：填了但非法 = 硬错误；空值 = 未定价警告（按 0 计，不炸全局）
{
  const bad = validateLines([
    line({ category: "FINANCING", calculationType: "PCT_ANNUALIZED_ON_COST", rate: 8, duration: -1 }),
    line({ category: "ADMIN", calculationType: "PCT_SELF_INCLUSIVE_ON_COST", rate: 100 }),
    line({ category: "COMMISSION", calculationType: "PCT_OF_GROSS_PROFIT", rate: 101 }),
    line({ category: "OTHER", calculationType: "PCT_ON_COST_SUBTOTAL", rate: -1 }),
  ]);
  const codes = bad.map((e) => e.code);
  ok(codes.includes("DURATION_INVALID") && codes.includes("SELF_INCLUSIVE_TOO_HIGH") && codes.includes("PROFIT_PCT_TOO_HIGH") && codes.includes("RATE_NEGATIVE"), "SP-05a: 四类非法输入全部硬拦截", codes);
  const r = computeQuote({ quoteCurrency: "CAD", lines: [
    line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 100 }),
    line({ id: "f0", category: "FINANCING", calculationType: "PCT_ANNUALIZED_ON_COST", rate: 8 }),
    line({ id: "empty", category: "MATERIAL", calculationType: "FIXED" }),
    line({ id: "cny", category: "MATERIAL", calculationType: "FIXED", sourceCurrency: "CNY" }),
  ], pricing: { method: "MARGIN_ON_REVENUE", rate: 30 } });
  ok(r.ok, "SP-05b: 空值行不阻塞计算（未定价按 0，含缺汇率但未填金额的外币行）");
  if (r.ok) {
    const unpriced = r.warnings.filter((w) => w.code === "LINE_UNPRICED");
    ok(unpriced.length === 3 && r.lines.find((l) => l.id === "f0")!.amount === 0, "SP-05c: 3 行未定价警告（缺周期/缺金额/外币未填），金额按 0", unpriced.map((w) => w.lineId));
    ok(r.sellingPrice === 142.86, "SP-05d: 已填行照常定价（100 ÷ 0.7）");
  }
  const fxHard = computeQuote({ quoteCurrency: "CAD", lines: [line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 50, sourceCurrency: "CNY" })], pricing: { method: "MARGIN_ON_REVENUE", rate: 0 } });
  ok(!fxHard.ok && fxHard.errors.some((e) => e.code === "FX_REQUIRED"), "SP-05e: 外币行一旦填了金额、缺汇率立刻硬错误（不许 1:1 混过）");
}

// SP-06 SUBCAT 基数：多品类不同关税率（钢材 25% / 铝材 10%），只乘各自标记行
{
  const r = computeQuote({ quoteCurrency: "CAD", lines: [
    line({ id: "steel", category: "MATERIAL", calculationType: "FIXED", unitCost: 60, subcategory: "钢材" }),
    line({ id: "alu", category: "MATERIAL", calculationType: "FIXED", unitCost: 40, subcategory: "铝材" }),
    line({ id: "d1", category: "DUTY", calculationType: "PERCENT_OF_COST", calculationBase: "SUBCAT:钢材", rate: 25 }),
    line({ id: "d2", category: "DUTY", calculationType: "PERCENT_OF_COST", calculationBase: "SUBCAT:铝材", rate: 10 }),
  ], pricing: { method: "MARGIN_ON_REVENUE", rate: 0 } });
  ok(r.ok, "SP-06a: SUBCAT 基数计算成功");
  if (r.ok) {
    const g = (id: string) => r.lines.find((l) => l.id === id)!.amount;
    ok(g("d1") === 15 && g("d2") === 4, "SP-06b: 钢材关税 60×25%=15，铝材 40×10%=4（互不串）");
  }
  const bad = validateLines([line({ category: "DUTY", calculationType: "PERCENT_OF_COST", calculationBase: "SUBCAT:", rate: 5 })]);
  ok(bad.some((e) => e.code === "INVALID_COST_BASE"), "SP-06c: 空 SUBCAT 标签被拒");
}

// SP-07 链式行 + 既有收入基数行共存：分母只吃 PERCENT_OF_REVENUE
{
  const r = computeQuote({ quoteCurrency: "CAD", lines: [
    line({ category: "MATERIAL", calculationType: "FIXED", unitCost: 100 }),
    line({ id: "rev", category: "ADMIN", calculationType: "PERCENT_OF_REVENUE", rate: 5 }),
    line({ id: "comm", category: "COMMISSION", calculationType: "PCT_OF_GROSS_PROFIT", rate: 30 }),
  ], pricing: { method: "MARGIN_ON_REVENUE", rate: 25 } });
  ok(r.ok, "SP-07a: 混合模式计算成功");
  if (r.ok) {
    ok(r.sellingPrice === 142.86, "SP-07b: S = 100 ÷ (1−0.25−0.05) = 142.86（提成不在分母）");
    const comm = r.lines.find((l) => l.id === "comm")!;
    ok(comm.baseAmount === 42.86 && comm.amount === 12.86, "SP-07c: 提成基数 = S − 成本侧 = 42.86");
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
