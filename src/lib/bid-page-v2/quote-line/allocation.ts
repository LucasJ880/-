/**
 * BIDPAGE-3 逐行报价 — 把报价引擎的结果分摊到各行（纯函数，定点；只用于显示与导出，design D4）
 *
 * 只有一套算法：每行的数都来自 `computeQuote` 的结果——
 *   - 份额 s_i = 该行货值（引擎该成本行的金额）÷ 全部已定价货品行的货值；
 *   - 到手成本（直接成本 + 成本百分比，即关税等）、成本合计按 s_i 分摊，舍入到分、余数归最后一行（`allocateCharge` 按货值）；
 *   - 我方单价 = 报价合计 × s_i ÷ 数量，四舍五入到分（`priceLine`，与导出同一个函数）；行合计 = 单价 × 数量；
 *   - 行毛利率 =（行合计 − 该行分到的成本）÷ 行合计。
 * 逐行合计与报价合计之差来自每行单价取到分，不超过 Σ(数量 × 0.005)（数量带小数的行再各加 0.005）。
 */
import { Prisma } from "@prisma/client";
import { roundMoney, ZERO } from "@/lib/project-finance/money";
import { allocateCharge, type AllocationLine } from "@/lib/tender-bid-cost/freight";
import { priceLine, priceSchedule } from "@/lib/tender-price-schedule/unit-conversion";
import type { QuoteCalcResult } from "@/lib/quote-engine/calc";
import type { LineAllocationView } from "./contract";

export type AllocationGoodsLine = {
  /** 货品成本行 id（与引擎结果 lines[].id 对应） */
  costLineId: string;
  lineNo: number;
  quantity: number;
  /** 这一行填了供应商报价 */
  priced: boolean;
};

type CalcPart = Pick<QuoteCalcResult, "lines" | "directCost" | "percentOfCostTotal" | "sellingPrice" | "estimatedCost">;

const toNum2 = (d: Prisma.Decimal) => Number(roundMoney(d));

export function diffBoundOf(goods: readonly AllocationGoodsLine[]): number {
  let b = new Prisma.Decimal(0);
  for (const g of goods) {
    if (!g.priced) continue;
    b = b.plus(new Prisma.Decimal(g.quantity).times("0.005"));
    if (!Number.isInteger(g.quantity)) b = b.plus("0.005");
  }
  return Number(b.toDecimalPlaces(4));
}

export function allocateFromEngine(goods: readonly AllocationGoodsLine[], calc: CalcPart): LineAllocationView {
  const amountOf = new Map(calc.lines.map((l) => [l.id, l.amount]));
  const g = goods.map((x) => ({ ...x, goodsCad: x.priced ? new Prisma.Decimal(amountOf.get(x.costLineId) ?? 0) : ZERO }));
  const sharing = g.filter((x) => x.priced && x.goodsCad.gt(ZERO));
  const totalGoods = sharing.reduce((a, x) => a.plus(x.goodsCad), ZERO);
  const diffBound = diffBoundOf(goods);
  const empty = (x: (typeof g)[number]) => ({ lineNo: x.lineNo, goodsCad: x.priced ? toNum2(x.goodsCad) : null, landedCostCad: null, landedUnitCostCad: null, unitPrice: null, extended: null, marginPct: null });
  if (sharing.length === 0 || totalGoods.lte(ZERO)) return { lines: g.map(empty), linesTotal: null, diff: null, diffBound };

  const allocLines: AllocationLine[] = sharing.map((x) => ({ lineNo: x.lineNo, sourcing: "IMPORT", pieces: null, goodsCad: x.goodsCad, volumeCbm: null, weightKg: null }));
  const landedTotal = new Prisma.Decimal(calc.directCost).plus(calc.percentOfCostTotal);
  const landed = allocateCharge(landedTotal, "BY_VALUE", allocLines);
  const cost = allocateCharge(calc.estimatedCost, "BY_VALUE", allocLines);
  if (!landed.ok || !cost.ok) return { lines: g.map(empty), linesTotal: null, diff: null, diffBound };

  const selling = new Prisma.Decimal(calc.sellingPrice);
  const priced = priceSchedule(
    sharing.map((x) => ({ lineNo: x.lineNo, quantity: x.quantity, unitPrice: selling.times(x.goodsCad).div(totalGoods).div(x.quantity) })),
  );
  const pricedBy = new Map(priced.lines.map((p) => [p.lineNo, p]));

  const lines = g.map((x) => {
    const p = pricedBy.get(x.lineNo);
    if (!p) return empty(x);
    const landedCost = landed.shares.get(x.lineNo) ?? ZERO;
    const costShare = cost.shares.get(x.lineNo) ?? ZERO;
    const marginPct = p.extended.gt(ZERO) ? Number(p.extended.minus(costShare).div(p.extended).times(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)) : null;
    return {
      lineNo: x.lineNo,
      goodsCad: toNum2(x.goodsCad),
      landedCostCad: toNum2(landedCost),
      landedUnitCostCad: toNum2(landedCost.div(x.quantity)),
      unitPrice: Number(p.unitPrice),
      extended: Number(p.extended),
      marginPct,
    };
  });
  return { lines, linesTotal: Number(priced.total), diff: Number(priced.total.minus(roundMoney(selling))), diffBound };
}

/** 导出用：行号 → 我方单价（没填报价的行没有单价，导出时按缺单价拒绝） */
export function exportUnitPrices(view: LineAllocationView): Record<number, string | null> {
  return Object.fromEntries(view.lines.map((l) => [l.lineNo, l.unitPrice == null ? null : priceLine({ lineNo: l.lineNo, quantity: 1, unitPrice: l.unitPrice }).unitPrice.toFixed(2)]));
}
