/**
 * 详细订单（Order Form）表单行 → 定价键（QUOTE-1a，openspec change quote-order-form-pricing-parity）
 *
 * 页面预览、报价 PDF、保存时的行构造三处只经这里取定价面料，不各写一份：
 *  - Roller：基础面料（由 SKU 推出）+ 生效罩型 → "… (Open Roll)" / "… w Cassette" / "… w Fascia"
 *  - Shutters：表单材质 "Wooden" → 价表键 "Wood"（表单 / PDF / 工艺单上的字样仍是 Wooden）
 *  - 其余产品：与 skuToPricingFabric 相同
 *
 * 生效罩型 = 行上 Valance → 表底部 Valance Type → 无；工艺单（sunny-process/quote-mapping）调同一个函数。
 * 纯函数，无 I/O。
 */

import type { ProductName } from "./pricing-types";
import { getAvailableFabrics } from "./pricing-data";
import { canonicalSku, skuToPricingFabric, type SkuEntry } from "./sku-catalog";
import { parseRollerFabric, rollerEngineFabricKey } from "./valance-options";

/** 本口径的表单数据标记（formDataJson.orderPricingRev）；没有该字段的旧表单视为 1 */
export const ORDER_PRICING_REV = 2;

/** 生效罩型：行上非空取行上（含明确的 "None"），否则取表单级 Valance Type，否则空串 */
export function effectiveShadeValance(rowValance: unknown, formValance: unknown): string {
  const row = typeof rowValance === "string" ? rowValance.trim() : "";
  if (row) return row;
  return typeof formValance === "string" ? formValance.trim() : "";
}

/**
 * Shades 行的定价面料。valance 传 effectiveShadeValance 的结果。
 * Roller 且没有生效罩型时原键照旧——SKU 本身是完整定价面料（如 "Blackout w Cassette"）的行不改价。
 */
export function shadeLinePricingFabric(
  line: { product: ProductName; sku: string; pricingFabric?: string },
  valance: string,
): string {
  // 行上带定价面料（QUOTE-1b：导入时以文件的面料档为准）且它是该产品的面料档 → 以它为取键起点；否则按 SKU 推断
  const own = typeof line.pricingFabric === "string" ? line.pricingFabric.trim() : "";
  const key = own && getAvailableFabrics(line.product).includes(own)
    ? own
    : skuToPricingFabric(line.sku, line.product);
  if (line.product !== "Roller") return key;
  const v = valance.trim();
  if (!v) return key;
  const base = parseRollerFabric(key).base;
  return rollerEngineFabricKey(base, v) || key;
}

/** 行级折扣（0–1 的有限数）→ 数字；缺失或非法 → null（按企业默认折扣） */
export function lineDiscountOverride(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
}

/** 行级折扣在表单上的显示文字，如 "15% off · 导入" */
export function lineDiscountLabel(pct: number): string {
  return `${Math.round(pct * 1000) / 10}% off · 导入`;
}

/** 销售手动换 SKU：行上定价面料随之清除，回到按 SKU 推断 */
export function applyShadeSkuChange<T extends { sku: string; pricingFabric?: string }>(line: T, sku: string): T {
  return { ...line, sku, pricingFabric: undefined };
}

/** 销售手动换产品：SKU 与行上定价面料清空；无绳只对 Zebra / Roller 保留 */
export function applyShadeProductChange<
  T extends { product: ProductName; sku: string; pricingFabric?: string; cordless?: boolean },
>(line: T, product: ProductName): T {
  return {
    ...line,
    product,
    sku: "",
    pricingFabric: undefined,
    cordless: product === "Zebra" || product === "Roller" ? line.cordless : false,
  };
}

export interface SkuSelectOption {
  value: string;
  label: string;
  /** 当前值不在该产品的 SKU 目录里 */
  outOfCatalog?: boolean;
}

/**
 * SKU 下拉的选项：目录条目照旧；当前值非空且不在目录里时，在最前面加一项「目录外」，
 * 否则浏览器会把它显示成未选择。
 */
export function skuSelectOptions(entries: readonly SkuEntry[], value: string): SkuSelectOption[] {
  const options: SkuSelectOption[] = entries.map((e) => ({
    value: e.sku,
    label: e.isCategoryFallback ? `${e.readable} (type only)` : `${e.sku} · ${e.readable}`,
  }));
  const current = value.trim();
  if (current && !entries.some((e) => e.sku === current || e.sku === canonicalSku(current))) {
    options.unshift({ value, label: `${current} · 目录外`, outOfCatalog: true });
  }
  return options;
}

/** Shutters：表单材质 → 价表键 */
export function shutterPricingFabric(material: string): string {
  return material === "Wooden" ? "Wood" : material;
}

/** 提醒文案（amountLabel 为本单百叶窗商品金额，如 "$1,172.22"） */
export function woodRepriceNoticeText(amountLabel: string): string {
  return (
    `实木百叶窗现已按价表自动计价（本单百叶窗 ${amountLabel}）。` +
    "这份报价内容保存于本次调整之前，此前实木百叶窗的价格需在 Part B 手填——" +
    "请检查 Part B，删除手填的百叶窗价格，避免重复计价。"
  );
}

/** 表单数据 / 草稿里的口径标记 → 数字；缺失或非法视为 1（改动前保存的） */
export function readOrderPricingRev(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? raw : 1;
}

/**
 * 是否提醒「实木百叶窗现已自动计价，请检查 Part B」：
 * 载入的表单是改动前保存的、材质 Wooden、且百叶窗现在能算出价。
 */
export function needsWoodRepriceNotice(input: {
  loadedRev: number;
  shutterMaterial: string;
  shutterMerch: number;
}): boolean {
  return (
    input.loadedRev < ORDER_PRICING_REV &&
    input.shutterMaterial === "Wooden" &&
    Number.isFinite(input.shutterMerch) &&
    input.shutterMerch > 0
  );
}
