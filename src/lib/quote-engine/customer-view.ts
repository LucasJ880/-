/**
 * Customer Quote View · 客户侧投影（只含批准公开字段）。
 * 内部字段（供应商成本/采购价/佣金/利润/内部备注/毛利/供应商名）绝不进入本投影——
 * 探针用白名单键集做反例守卫。
 */

import type { QuoteCalcResult } from "./calc";
import type { TierResult } from "./standing-offer";

export type CustomerLine = { item: string; description: string | null; quantity: number | null; unit: string | null; unitPrice: number | null; amount: number; optional: boolean; allowance: boolean };
export type CustomerQuoteView = {
  quoteNumber: string | null;
  title: string;
  currency: string;
  version: number;
  status: string;
  validUntil: string | null;
  lines: CustomerLine[];
  subtotal: number;
  tax: { gst: number; hst: number; pst: number };
  total: number;
};

export const CUSTOMER_VIEW_ALLOWED_KEYS = new Set(["quoteNumber", "title", "currency", "version", "status", "validUntil", "lines", "subtotal", "tax", "total"]);
export const CUSTOMER_LINE_ALLOWED_KEYS = new Set(["item", "description", "quantity", "unit", "unitPrice", "amount", "optional", "allowance"]);

export function buildCustomerView(input: {
  quote: { quoteNumber: string | null; title: string | null; name: string | null; currency: string; version: number; status: string; validUntil: Date | null; quoteType: string; lineItems: Array<{ itemName: string; specification: string | null; unit: string | null; quantity: unknown; unitPrice: unknown; totalPrice: unknown; isInternal: boolean; category: string }> };
  calc: QuoteCalcResult | null;
  tiers?: TierResult[] | null;
}): CustomerQuoteView {
  const q = input.quote;
  const num = (v: unknown) => (v == null ? null : Number(v));
  let lines: CustomerLine[] = q.lineItems
    .filter((i) => !i.isInternal)
    .map((i) => ({ item: i.itemName, description: i.specification ?? null, quantity: num(i.quantity), unit: i.unit ?? null, unitPrice: num(i.unitPrice), amount: num(i.totalPrice) ?? 0, optional: i.category === "optional", allowance: i.category === "allowance" }));
  // 引擎报价且无人工卖价行：用定价结果生成汇总行（Supply+Install 单行；Standing Offer 按分级单价）
  if (lines.length === 0 && input.calc) {
    if (q.quoteType === "STANDING_OFFER" && input.tiers && input.tiers.length > 0) {
      lines = input.tiers.map((t) => ({ item: `${t.tierName}（${t.minQuantity.toLocaleString()}–${t.maxQuantity == null ? "∞" : t.maxQuantity.toLocaleString()} pcs）`, description: "Unit price per piece", quantity: t.expectedQuantity, unit: "pc", unitPrice: t.unitPrice, amount: t.calculatedRevenue, optional: false, allowance: false }));
    } else {
      lines = [{ item: q.name ?? q.title ?? "Supply & Install", description: null, quantity: 1, unit: "lot", unitPrice: input.calc.sellingPrice, amount: input.calc.sellingPrice, optional: false, allowance: false }];
    }
  }
  const subtotal = Math.round(lines.filter((l) => !l.optional).reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const tax = input.calc ? { gst: input.calc.tax.gst, hst: input.calc.tax.hst, pst: input.calc.tax.pst } : { gst: 0, hst: 0, pst: 0 };
  const total = Math.round((subtotal + tax.gst + tax.hst + tax.pst) * 100) / 100;
  return { quoteNumber: q.quoteNumber, title: q.name ?? q.title ?? "Quotation", currency: q.currency, version: q.version, status: q.status, validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : null, lines, subtotal, tax, total };
}

/** 反例守卫用：投影对象不得含任何内部键 */
export const INTERNAL_KEY_PATTERN = /cost|supplier|margin|markup|commission|profit|internal|sourcing|fx|duty|freight|landed|scenario|breakdown/i;
export function customerViewLeaks(view: unknown): string[] {
  const leaks: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (INTERNAL_KEY_PATTERN.test(k)) leaks.push(`${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
  };
  walk(view, "$");
  return leaks;
}
