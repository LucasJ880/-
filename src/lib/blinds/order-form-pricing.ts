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
import { skuToPricingFabric } from "./sku-catalog";
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
  line: { product: ProductName; sku: string },
  valance: string,
): string {
  const key = skuToPricingFabric(line.sku, line.product);
  if (line.product !== "Roller") return key;
  const v = valance.trim();
  if (!v) return key;
  const base = parseRollerFabric(key).base;
  return rollerEngineFabricKey(base, v) || key;
}

/** Shutters：表单材质 → 价表键 */
export function shutterPricingFabric(material: string): string {
  return material === "Wooden" ? "Wood" : material;
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
