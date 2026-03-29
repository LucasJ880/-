/**
 * 报价金额计算 — 纯函数，前后端通用
 */

import type { QuoteLineItemData } from "./types";

export interface QuoteTotals {
  subtotal: number;
  internalCost: number;
  totalAmount: number;
  profitMargin: number | null;
  lineCount: number;
}

export function calculateLineTotalPrice(
  quantity: number | null,
  unitPrice: number | null
): number | null {
  if (quantity == null || unitPrice == null) return null;
  return Math.round(quantity * unitPrice * 100) / 100;
}

export function calculateTotals(lines: QuoteLineItemData[]): QuoteTotals {
  let subtotal = 0;
  let internalCost = 0;
  let lineCount = 0;

  for (const line of lines) {
    const amount = line.totalPrice ?? 0;
    subtotal += amount;
    lineCount++;

    if (line.costPrice != null) {
      internalCost += line.costPrice * (line.quantity ?? 1);
    } else {
      internalCost += amount;
    }
  }

  subtotal = Math.round(subtotal * 100) / 100;
  internalCost = Math.round(internalCost * 100) / 100;

  const profitMargin =
    subtotal > 0 && internalCost > 0
      ? Math.round(((subtotal - internalCost) / subtotal) * 10000) / 100
      : null;

  return {
    subtotal,
    internalCost,
    totalAmount: subtotal,
    profitMargin,
    lineCount,
  };
}
