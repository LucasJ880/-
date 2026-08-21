/**
 * Standing Offer · 单位经济 + 数量分级（纯函数）。
 * 到岸成本/箱 = 供应商货值/箱 + 运费 + 清关 + 关税(% 货值) + 仓储 + 其它；
 * 数学箱数 = 数量 / 每箱件数（2.76），采购箱数 = CEILING（3）——两者分开，不混用。
 */

import { round2, round4, isFiniteNum, sellingPriceFromCost } from "./calc";
import type { QuoteValidationError, StandingOfferInput, TierInput } from "./contract";

export type UnitEconomics = {
  /** 全精度内部值（分级计算的权威输入；禁止用 4 位显示值做百万件级乘法） */
  exact: { landedPerContainer: number; landedPerBox: number; landedPerPiece: number; supplierPerPiece: number };
  piecesPerContainer: number;
  supplierPerContainer: number;
  freightPerContainer: number;
  customsPerContainer: number;
  dutyPerContainer: number;
  warehousePerContainer: number;
  otherPerContainer: number;
  inventoryPerContainer: number;
  landedPerContainer: number;
  landedPerBox: number;
  landedPerPiece: number;
  /** 供应商成本折算到报价币 */
  supplierPerPieceQuoteCcy: number;
};

/** 外币供应商成本必须有有限且 > 0 的汇率；绝不默认 1:1（B1 fail-closed） */
export function isForeignSupplier(so: Pick<StandingOfferInput, "supplierCurrency">, quoteCurrency: string): boolean {
  const c = (so.supplierCurrency ?? "").trim().toUpperCase();
  return c.length > 0 && c !== quoteCurrency.toUpperCase();
}

export function validateStandingOffer(so: StandingOfferInput | null | undefined, quoteCurrency = "CAD"): QuoteValidationError[] {
  const errors: QuoteValidationError[] = [];
  if (!so) return [{ code: "SO_MISSING", message: "Standing Offer 单位经济输入缺失" }];
  if (!isFiniteNum(so.supplierCostPerPiece) || so.supplierCostPerPiece < 0) errors.push({ code: "SO_SUPPLIER_COST", message: "供应商单件成本无效" });
  if (!isFiniteNum(so.piecesPerBox) || so.piecesPerBox <= 0) errors.push({ code: "SO_PIECES_PER_BOX", message: "每箱件数必须 > 0" });
  if (!isFiniteNum(so.boxesPerContainer) || so.boxesPerContainer <= 0) errors.push({ code: "SO_BOXES_PER_CONTAINER", message: "每柜箱数必须 > 0" });
  if (isForeignSupplier(so, quoteCurrency)) {
    if (so.fxRate == null) errors.push({ code: "SO_FX_REQUIRED", message: `${so.supplierCurrency}→${quoteCurrency} 必须提供汇率（不默认 1:1）` });
    else if (!isFiniteNum(so.fxRate) || so.fxRate <= 0) errors.push({ code: "FX_INVALID", message: "汇率必须是 > 0 的有限数" });
  } else if (so.fxRate != null && !(so.fxRate > 0)) {
    errors.push({ code: "FX_INVALID", message: "汇率必须 > 0" });
  }
  if (so.dutyPct != null && so.dutyPct < 0) errors.push({ code: "SO_DUTY", message: "关税 % 不得为负" });
  return errors;
}

export function computeUnitEconomics(so: StandingOfferInput, quoteCurrency: string): UnitEconomics {
  let fx = 1;
  if (isForeignSupplier(so, quoteCurrency)) {
    if (so.fxRate == null || !isFiniteNum(so.fxRate) || so.fxRate <= 0) {
      throw new Error(`SO_FX_REQUIRED: ${so.supplierCurrency}→${quoteCurrency} 汇率缺失或无效，拒绝按 1:1 折算`);
    }
    fx = so.fxRate;
  }
  const supplierPerPiece = (so.supplierCostPerPiece ?? 0) * fx;
  const piecesPerContainer = (so.piecesPerBox ?? 0) * (so.boxesPerContainer ?? 0);
  const supplierPerContainer = supplierPerPiece * piecesPerContainer;
  const freight = so.freightPerContainer ?? 0;
  const customs = so.customsPerContainer ?? 0;
  const duty = (supplierPerContainer * (so.dutyPct ?? 0)) / 100;
  const warehouse = so.warehousePerContainer ?? 0;
  const other = so.otherPerContainer ?? 0;
  const preInventory = supplierPerContainer + freight + customs + duty + warehouse + other;
  const inventory = (preInventory * (so.inventoryCarryingPct ?? 0)) / 100;
  const landed = preInventory + inventory;
  const exactPerBox = (so.boxesPerContainer ?? 0) > 0 ? landed / (so.boxesPerContainer ?? 1) : 0;
  const exactPerPiece = piecesPerContainer > 0 ? landed / piecesPerContainer : 0;
  return {
    exact: { landedPerContainer: landed, landedPerBox: exactPerBox, landedPerPiece: exactPerPiece, supplierPerPiece },
    piecesPerContainer,
    supplierPerContainer: round2(supplierPerContainer),
    freightPerContainer: round2(freight),
    customsPerContainer: round2(customs),
    dutyPerContainer: round2(duty),
    warehousePerContainer: round2(warehouse),
    otherPerContainer: round2(other),
    inventoryPerContainer: round2(inventory),
    landedPerContainer: round2(landed),
    landedPerBox: (so.boxesPerContainer ?? 0) > 0 ? round4(landed / (so.boxesPerContainer ?? 1)) : 0,
    landedPerPiece: piecesPerContainer > 0 ? round4(landed / piecesPerContainer) : 0,
    supplierPerPieceQuoteCcy: round4(supplierPerPiece),
  };
}

export function containersFor(quantity: number, piecesPerContainer: number): { math: number; procurement: number } {
  if (!(piecesPerContainer > 0) || !(quantity >= 0)) return { math: 0, procurement: 0 };
  const math = quantity / piecesPerContainer;
  return { math: round4(math), procurement: Math.ceil(math - 1e-9) };
}

export type TierResult = {
  id: string;
  tierName: string;
  minQuantity: number;
  maxQuantity: number | null;
  expectedQuantity: number;
  pricingMethod: string;
  rate: number;
  containersMath: number;
  containersProcurement: number;
  /** 按期望数量 × 到岸单件成本（数学口径）+ 收入基数行 */
  calculatedCost: number;
  unitPrice: number;
  boxPrice: number;
  containerPrice: number;
  calculatedRevenue: number;
  grossProfit: number;
  calculatedMargin: number;
};

export function validateTiers(tiers: TierInput[]): QuoteValidationError[] {
  const errors: QuoteValidationError[] = [];
  const active = tiers.filter((t) => t.active).sort((a, b) => a.minQuantity - b.minQuantity);
  for (const t of active) {
    const e = (code: string, message: string) => errors.push({ code, message, tierId: t.id });
    if (!(t.minQuantity >= 0)) e("TIER_MIN_INVALID", "分级下限无效");
    if (t.maxQuantity != null && t.maxQuantity < t.minQuantity) e("TIER_RANGE_INVALID", "分级上限小于下限");
    if (!(t.expectedQuantity > 0)) e("TIER_EXPECTED_INVALID", "期望数量必须 > 0");
    if (t.expectedQuantity < t.minQuantity || (t.maxQuantity != null && t.expectedQuantity > t.maxQuantity)) e("TIER_EXPECTED_OUT_OF_RANGE", "期望数量不在分级区间内");
    if (t.pricingMethod === "MARGIN_ON_REVENUE" && (t.rate ?? 0) >= 100) e("MARGIN_TOO_HIGH", "Margin ≥ 100%");
    if ((t.rate ?? 0) < 0) e("RATE_NEGATIVE", "rate 不得为负");
  }
  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1]!;
    const cur = active[i]!;
    if (prev.maxQuantity == null || cur.minQuantity <= prev.maxQuantity) errors.push({ code: "TIER_OVERLAP", message: `分级「${prev.tierName}」与「${cur.tierName}」区间重叠或前者无上限`, tierId: cur.id });
    else if (cur.minQuantity - prev.maxQuantity > 1) errors.push({ code: "TIER_GAP", message: `分级「${prev.tierName}」与「${cur.tierName}」之间有缺口（警告）`, tierId: cur.id });
  }
  const names = new Map<string, number>();
  for (const t of active) names.set(t.tierName, (names.get(t.tierName) ?? 0) + 1);
  for (const [n, c] of names) if (c > 1) errors.push({ code: "TIER_DUPLICATE", message: `重复的有效分级「${n}」` });
  return errors;
}

export function computeTiers(input: { tiers: TierInput[]; unit: UnitEconomics; revenuePctTotal: number; revenueBasedProfitPct?: number; boxesPerContainer: number; piecesPerBox: number }): TierResult[] {
  const otherRev = input.revenuePctTotal - (input.revenueBasedProfitPct ?? 0);
  return input.tiers
    .filter((t) => t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.minQuantity - b.minQuantity)
    .map((t) => {
      const c = containersFor(t.expectedQuantity, input.unit.piecesPerContainer);
      // B6：用全精度到岸单件成本（显示值 4 位会在百万件级产生实质漂移）
      const baseCost = t.expectedQuantity * input.unit.exact.landedPerPiece;
      const rate = t.rate ?? 0;
      // 与主引擎同口径：Selling = (C + markup×C) / (1 − otherRev − margin)
      const margin = t.pricingMethod === "MARGIN_ON_REVENUE" ? rate : 0;
      const markup = t.pricingMethod === "MARKUP_ON_COST" ? rate : 0;
      const denom = 1 - (otherRev + margin) / 100;
      const revenue = denom > 0 ? (baseCost * (1 + markup / 100)) / denom : NaN;
      const cost = Number.isFinite(revenue) ? baseCost + (revenue * otherRev) / 100 : NaN;
      const unitPrice = Number.isFinite(revenue) && t.expectedQuantity > 0 ? revenue / t.expectedQuantity : NaN;
      const gp = Number.isFinite(revenue) ? revenue - cost : NaN;
      const fin = (v: number, d = 2) => (Number.isFinite(v) ? (d === 2 ? round2(v) : round4(v)) : 0);
      return {
        id: t.id,
        tierName: t.tierName,
        minQuantity: t.minQuantity,
        maxQuantity: t.maxQuantity,
        expectedQuantity: t.expectedQuantity,
        pricingMethod: t.pricingMethod,
        rate,
        containersMath: c.math,
        containersProcurement: c.procurement,
        calculatedCost: fin(cost),
        unitPrice: fin(unitPrice, 4),
        boxPrice: fin(unitPrice * input.piecesPerBox, 4),
        containerPrice: fin(unitPrice * input.unit.piecesPerContainer),
        calculatedRevenue: fin(revenue),
        grossProfit: fin(gp),
        calculatedMargin: Number.isFinite(revenue) && revenue > 0 ? round4((gp / revenue) * 100) : 0,
      };
    });
}

export { sellingPriceFromCost };
