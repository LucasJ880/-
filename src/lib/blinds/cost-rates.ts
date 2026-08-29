/**
 * 品类成本率 → 行级成本快照
 *
 * 口径：成本 ≈ 成交行价（price，折后）× 品类成本率。
 * 报价创建/重算时按当时的企业配置写入 SalesQuoteItem.costPrice 快照
 * （历史单不回填、配置未含该品类写 null），真实毛利 = price − costPrice。
 */

import type { ProductName } from "./pricing-types";
import { PRODUCT_TO_FIELD } from "./discount-settings";

/** 取产品对应的成本率；未配置该品类 → null */
export function costRateForProduct(
  rates: Record<string, number>,
  product: ProductName | string,
): number | null {
  const field = PRODUCT_TO_FIELD[product as ProductName];
  if (!field) return null;
  const rate = rates[field];
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1
    ? rate
    : null;
}

/** 行级成本快照：rate 为 null（未配置）→ null；否则 round 到分 */
export function snapshotCostPrice(
  price: number,
  rate: number | null,
): number | null {
  if (rate == null) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  return Math.round(price * rate * 100) / 100;
}
