/**
 * TI-2 情景计算：逐行成本 → 运费分摊 → 预备金 → 定价 → 合计（纯函数，定点）
 *
 * - 定价两种口径：按售价毛利率（单位报价 = 单位成本 ÷（1 − 毛利率 − 按售价预备金率））、
 *   成本加成（单位报价 = 单位成本 ×（1 + 加成率））。两种口径都同时输出毛利率与加成率。
 * - 预备金两种口径：按售价留、计入成本；同一笔只属于一种。
 * - 单位报价先舍入到分；合计各项 = 各行舍入后的数字之和（不由合计倒推）。
 */
import { Prisma } from "@prisma/client";
import { dec, roundMoney, ZERO } from "@/lib/project-finance/money";
import { toDecimalOrNull } from "@/lib/tender-price-schedule/contract";
import {
  ALLOCATION_LABELS_ZH, FREIGHT_MODE_LABELS_ZH, QUOTE_EVIDENCE_LABELS_ZH,
  type AssumptionEntry, type CostScenarioInput, type LineCost, type PricedLine, type Rejection, type ReserveMode,
  type ScenarioResult, type ScenarioTotals,
} from "./contract";
import { allocateFreight, validateFreightSelection, type AllocationLine } from "./freight";
import { finalizeLine, prepareLine, type LineBase } from "./line-cost";

type D = Prisma.Decimal;
const HUNDRED = new Prisma.Decimal(100);
const ONE = new Prisma.Decimal(1);
const pct = (num: D, den: D): D | null => (den.gt(ZERO) ? num.div(den).times(HUNDRED) : null);
const sum = (values: Array<D | null>): D => values.reduce<D>((acc, v) => (v ? acc.plus(v) : acc), ZERO);

function reject(code: Rejection["code"], messageZh: string, lineNo: number | null = null): Rejection {
  return { ok: false, code, lineNo, messageZh };
}

export function computeCostScenario(input: CostScenarioInput): ScenarioResult | Rejection {
  // —— 行号唯一 ——
  const seen = new Set<number>();
  for (const l of input.lines) {
    if (seen.has(l.line.lineNo)) return reject("DUPLICATE_LINE", `行号 ${l.line.lineNo} 重复`, l.line.lineNo);
    seen.add(l.line.lineNo);
  }

  // —— 预备金：同一笔只属于一种口径 ——
  const reserves = input.reserves ?? [];
  const reserveKeys = new Set<string>();
  for (const r of reserves) {
    if (reserveKeys.has(r.key)) return reject("RESERVE_DUPLICATED", `预备金「${r.label}」重复：同一笔只能按售价留或计入成本其一`);
    reserveKeys.add(r.key);
  }
  let onSalePct = ZERO;
  let inCostPct = ZERO;
  for (const r of reserves) {
    const v = toDecimalOrNull(r.mode === "ON_SALE" ? r.ratePct : r.pctOfDirectCost);
    if (!v || v.lt(ZERO) || v.gte(HUNDRED)) return reject("INVALID_RATE", `预备金「${r.label}」的比率无效`);
    if (r.mode === "ON_SALE") onSalePct = onSalePct.plus(v); else inCostPct = inCostPct.plus(v);
  }

  // —— 定价参数 ——
  const rateRaw = toDecimalOrNull(input.pricing.method === "MARGIN_ON_PRICE" ? input.pricing.targetMarginPct : input.pricing.markupPct);
  if (!rateRaw || rateRaw.lt(ZERO)) return reject("INVALID_RATE", "定价比率无效");
  const onSale = onSalePct.div(HUNDRED);
  const denominator = input.pricing.method === "MARGIN_ON_PRICE" ? ONE.minus(rateRaw.div(HUNDRED)).minus(onSale) : ONE.minus(onSale);
  if (denominator.lte(ZERO)) return reject("PRICING_DENOMINATOR_NOT_POSITIVE", "目标毛利率与按售价预备金率之和不小于 100%，无法定价");
  const gstRate = toDecimalOrNull(input.importGst.ratePct);
  if (!gstRate || gstRate.lt(ZERO) || gstRate.gte(HUNDRED)) return reject("INVALID_RATE", "进口 GST 税率无效");

  // —— 运费方案 ——
  const freight = validateFreightSelection(input.freight);
  if (!freight.ok) return freight;

  // —— 第一步：各行货值 ——
  const bases: LineBase[] = [];
  for (const l of input.lines) {
    const p = prepareLine(l);
    if (!p.ok) return p;
    bases.push(p.base);
  }

  // —— 第二步：整票费用分摊（成本为空的行不参与，补齐后分摊额会变）——
  const notices: string[] = [];
  const allocatable: AllocationLine[] = bases
    .filter((b) => b.blockers.length === 0 && b.goodsCad)
    .map((b) => ({
      lineNo: b.input.line.lineNo,
      sourcing: b.input.sourcing,
      pieces: b.purchasePieces ?? b.quantity,
      goodsCad: b.goodsCad,
      volumeCbm: toDecimalOrNull(b.input.volumeCbm),
      weightKg: toDecimalOrNull(b.input.weightKg),
    }));
  const allocation = allocateFreight(freight.plans, allocatable);
  if (!allocation.ok) return allocation;
  const hasCharges = freight.plans.some((p) => p.charges.length > 0);
  if (hasCharges && allocatable.length < bases.length) {
    notices.push("运费分摊未包含成本为空的行；补齐后各行的分摊额会变化。");
  }

  // —— 第三步：逐行成本与定价 ——
  const lines: PricedLine[] = bases.map((b) => {
    const cost: LineCost = finalizeLine(b, {
      importGst: { ratePct: gstRate, itcEligible: input.importGst.itcEligible },
      allocatedFreightCad: allocation.byLine.get(b.input.line.lineNo) ?? ZERO,
      reserveInCostPct: inCostPct,
    });
    if (!cost.complete || !cost.directCostCad || !cost.unitCostCad || !cost.quantity) {
      return { ...cost, unitBidCad: null, extendedBidCad: null, profitCad: null, grossMarginPct: null, markupPct: null };
    }
    const unitBidCad = input.pricing.method === "MARGIN_ON_PRICE"
      ? roundMoney(cost.unitCostCad.div(denominator))
      : roundMoney(cost.unitCostCad.times(ONE.plus(rateRaw.div(HUNDRED))));
    const extendedBidCad = roundMoney(unitBidCad.times(cost.quantity));
    const profitCad = roundMoney(extendedBidCad.times(ONE.minus(onSale)).minus(cost.directCostCad));
    const gross = extendedBidCad.minus(cost.directCostCad);
    return { ...cost, unitBidCad, extendedBidCad, profitCad, grossMarginPct: pct(gross, extendedBidCad), markupPct: pct(gross, cost.directCostCad) };
  });

  // —— 合计：各行舍入值之和 ——
  const done = lines.filter((l) => l.complete);
  const bid = sum(done.map((l) => l.extendedBidCad));
  const direct = sum(done.map((l) => l.directCostCad));
  const profit = sum(done.map((l) => l.profitCad));
  const totals: ScenarioTotals = {
    goodsCad: sum(done.map((l) => l.goodsCad)),
    dutyCad: sum(done.map((l) => l.dutyCad)),
    freightCad: sum(done.map((l) => l.freightCad)),
    localDeliveryCad: sum(done.map((l) => l.localDeliveryCad)),
    otherCad: sum(done.map((l) => l.otherCad)),
    nonRecoverableTaxCad: sum(done.map((l) => l.nonRecoverableTaxCad)),
    reserveInCostCad: sum(done.map((l) => l.reserveInCostCad)),
    directCostCad: direct,
    bidExclHstCad: bid,
    reserveOnSaleCad: sum(done.map((l) => (l.extendedBidCad ? roundMoney(l.extendedBidCad.times(onSale)) : null))),
    profitCad: profit,
    importGstCashCad: sum(done.map((l) => l.importGstCashCad)),
    grossMarginPct: pct(bid.minus(direct), bid),
    markupPct: pct(bid.minus(direct), direct),
    netMarginPct: pct(profit, bid),
  };

  const flags = {
    incomplete: lines.some((l) => !l.complete),
    hasSensitivityDuty: lines.some((l) => l.sourcing === "IMPORT" && l.dutyBasis === "SENSITIVITY"),
    hasIndicativePrice: lines.some((l) => l.evidenceKind !== null && l.evidenceKind !== "SIGNED_QUOTE"),
  };

  return {
    ok: true,
    key: input.key,
    label: input.label,
    lines,
    totals,
    flags,
    meta: {
      pricingMethod: input.pricing.method,
      pricingRatePct: rateRaw,
      reserveOnSaleRatePct: onSalePct,
      reserveModes: reserves.map((r) => ({ key: r.key, label: r.label, mode: r.mode as ReserveMode })),
      freightModes: freight.plans.map((p) => p.mode),
      freightBlendNote: freight.blendNote,
    },
    assumptions: buildAssumptions(input, { onSalePct, inCostPct, gstRate, blendNote: freight.blendNote }),
    notices,
  };
}

/** 假设与出处：每条写明取值、依据类别、来源引用、日期。缺来源的如实写「未提供」。 */
function buildAssumptions(
  input: CostScenarioInput,
  ctx: { onSalePct: D; inCostPct: D; gstRate: D; blendNote: string | null },
): AssumptionEntry[] {
  const out: AssumptionEntry[] = [];
  const fxSeen = new Set<string>();
  for (const l of input.lines) {
    const cur = l.quote?.currency.trim().toUpperCase();
    if (!cur || cur === "CAD" || fxSeen.has(cur)) continue;
    fxSeen.add(cur);
    const rate = toDecimalOrNull(l.fx?.rateCadPerUnit);
    out.push({ item: `汇率 ${cur} → CAD`, value: rate ? `1 ${cur} = ${rate.toString()} CAD` : "未提供", basisKind: l.fx?.source?.trim() || "未提供", sourceRef: null, asOf: l.fx?.asOf?.trim() || null });
  }
  for (const l of input.lines) {
    if (l.sourcing !== "IMPORT" || !l.duty) continue;
    const verified = !!(l.duty.hsCode?.trim() && l.duty.origin?.trim() && l.duty.sourceRef?.trim() && l.duty.asOf?.trim());
    out.push({
      item: `第 ${l.line.lineNo} 行关税率`,
      value: `${dec(l.duty.ratePct).toString()}%${l.duty.hsCode?.trim() ? `（HS ${l.duty.hsCode.trim()}${l.duty.origin?.trim() ? `，原产地 ${l.duty.origin.trim()}` : ""}）` : ""}`,
      basisKind: verified ? "已核实（HS 编码、原产地、来源、日期齐全）" : "敏感性假设（未核实）",
      sourceRef: l.duty.sourceRef?.trim() || null,
      asOf: l.duty.asOf?.trim() || null,
    });
  }
  for (const l of input.lines) {
    if (!l.quote) continue;
    out.push({
      item: `第 ${l.line.lineNo} 行供应商报价`,
      value: `${toDecimalOrNull(l.quote.unitPrice)?.toString() ?? "未提供"} ${l.quote.currency.trim().toUpperCase()}（${l.quote.basis === "PER_PIECE" ? "按件" : "按招标单位"}）`,
      basisKind: QUOTE_EVIDENCE_LABELS_ZH[l.quote.evidenceKind],
      sourceRef: l.quote.sourceRef?.trim() || null,
      asOf: l.quote.asOf?.trim() || null,
    });
  }
  for (const p of input.freight?.plans ?? []) {
    for (const c of p.charges) {
      out.push({ item: `运费方案 ${FREIGHT_MODE_LABELS_ZH[p.mode]}：${c.label}`, value: `${roundMoney(dec(c.amountCad)).toFixed(2)} CAD，${ALLOCATION_LABELS_ZH[c.allocation]}分摊`, basisKind: "整票费用", sourceRef: p.sourceRef?.trim() || null, asOf: p.asOf?.trim() || null });
    }
  }
  if (ctx.blendNote) out.push({ item: "运费方案混合", value: ctx.blendNote, basisKind: "人工声明", sourceRef: null, asOf: null });
  out.push({ item: "进口 GST", value: `${ctx.gstRate.toString()}%，${input.importGst.itcEligible ? "可抵扣：只进现金流，不进成本" : "不可抵扣：计入成本"}`, basisKind: "情景设置", sourceRef: null, asOf: null });
  for (const r of input.reserves ?? []) {
    out.push({ item: `预备金：${r.label}`, value: r.mode === "ON_SALE" ? `${dec(r.ratePct).toString()}%，按售价留` : `${dec(r.pctOfDirectCost).toString()}%，计入成本`, basisKind: "情景设置", sourceRef: null, asOf: null });
  }
  out.push(input.pricing.method === "MARGIN_ON_PRICE"
    ? { item: "定价口径", value: `按售价毛利率，目标 ${dec(input.pricing.targetMarginPct).toString()}%`, basisKind: "情景设置", sourceRef: null, asOf: null }
    : { item: "定价口径", value: `成本加成，加成率 ${dec(input.pricing.markupPct).toString()}%`, basisKind: "情景设置", sourceRef: null, asOf: null });
  return out;
}
