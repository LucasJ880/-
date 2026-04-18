/**
 * 报价折扣率设置 —— 服务端读取辅助
 *
 * 职责：统一从 DB 的 QuoteDiscountSettings（单行 id="singleton"）读取全局折扣率
 * 并按产品映射成 priceFor 需要的形态。Order Form / AI 工具 / 驾驶舱共用这一份。
 *
 * 客户端（iframe / Order Form 页面）通过 /api/sales/quote-settings/discounts 拉取。
 */

import { db } from "@/lib/db";
import type { ProductName } from "./pricing-types";
import { DEFAULT_DISCOUNTS } from "./pricing-data";

export type DiscountsByProduct = Record<ProductName, number>;

/**
 * 固定的字段映射：DB 字段名 → priceFor 使用的 ProductName
 * 保持和 DEFAULT_DISCOUNTS 完全同形，未来新增产品时两边同时加
 */
const FIELD_TO_PRODUCT: Record<string, ProductName> = {
  zebra: "Zebra",
  shangrila: "SHANGRILA",
  cellular: "Cordless Cellular",
  roller: "Roller",
  drapery: "Drapery",
  sheer: "Sheer",
  shutters: "Shutters",
  honeycomb: "SkylightHoneycomb",
};

/** 反向映射，供 PUT 校验用 */
export const PRODUCT_TO_FIELD: Record<ProductName, string> = Object.fromEntries(
  Object.entries(FIELD_TO_PRODUCT).map(([f, p]) => [p, f]),
) as Record<ProductName, string>;

/** 从 DB 读取并映射成 ProductName 折扣表；DB 无记录时 fallback 到内置默认 */
export async function loadDiscounts(): Promise<DiscountsByProduct> {
  const row = await db.quoteDiscountSettings.findUnique({
    where: { id: "singleton" },
  });
  if (!row) return { ...DEFAULT_DISCOUNTS };

  const out = { ...DEFAULT_DISCOUNTS };
  for (const [field, product] of Object.entries(FIELD_TO_PRODUCT)) {
    const v = (row as unknown as Record<string, unknown>)[field];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) {
      out[product] = v;
    }
  }
  return out;
}

/** DB 字段 → 序列化成 API/前端的扁平对象（字段名=DB 字段） */
export interface DiscountsDto {
  zebra: number;
  shangrila: number;
  cellular: number;
  roller: number;
  drapery: number;
  sheer: number;
  shutters: number;
  honeycomb: number;
  updatedAt: string;
  updatedBy: string | null;
}

export async function loadDiscountsDto(): Promise<DiscountsDto> {
  const row = await db.quoteDiscountSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  return {
    zebra: row.zebra,
    shangrila: row.shangrila,
    cellular: row.cellular,
    roller: row.roller,
    drapery: row.drapery,
    sheer: row.sheer,
    shutters: row.shutters,
    honeycomb: row.honeycomb,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/** 校验入参合法性：所有字段必须在 [0, 1] 之间 */
export function validateDiscountsInput(
  input: Record<string, unknown>,
): { ok: true; value: Partial<Omit<DiscountsDto, "updatedAt" | "updatedBy">> } | { ok: false; error: string } {
  const keys = ["zebra", "shangrila", "cellular", "roller", "drapery", "sheer", "shutters", "honeycomb"] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    if (input[k] === undefined) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return { ok: false, error: `字段 ${k} 必须为 0~1 之间的数字（0.45 表示 45%）` };
    }
    out[k] = Math.round(n * 10000) / 10000;
  }
  return { ok: true, value: out };
}
