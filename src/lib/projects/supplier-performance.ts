/**
 * 组织内供应商表现统计（基于询价回复/选中）
 */

import { db } from "@/lib/db";

export type SupplierPerformanceRow = {
  supplierId: string;
  name: string;
  inquiryCount: number;
  repliedCount: number;
  selectedCount: number;
  declinedCount: number;
  replyRate: number;
  selectRate: number;
  avgDeliveryDays: number | null;
  avgUnitPrice: number | null;
  currency: string | null;
};

export async function getOrgSupplierPerformance(input: {
  orgId: string;
  limit?: number;
}): Promise<SupplierPerformanceRow[]> {
  const items = await db.inquiryItem.findMany({
    where: {
      inquiry: { project: { orgId: input.orgId } },
    },
    select: {
      supplierId: true,
      status: true,
      repliedAt: true,
      declinedAt: true,
      isSelected: true,
      unitPrice: true,
      deliveryDays: true,
      currency: true,
      supplier: { select: { id: true, name: true } },
    },
    take: 2000,
  });

  const map = new Map<
    string,
    {
      name: string;
      inquiryCount: number;
      repliedCount: number;
      selectedCount: number;
      declinedCount: number;
      deliverySum: number;
      deliveryN: number;
      priceSum: number;
      priceN: number;
      currency: string | null;
    }
  >();

  for (const it of items) {
    const cur = map.get(it.supplierId) || {
      name: it.supplier.name,
      inquiryCount: 0,
      repliedCount: 0,
      selectedCount: 0,
      declinedCount: 0,
      deliverySum: 0,
      deliveryN: 0,
      priceSum: 0,
      priceN: 0,
      currency: it.currency || null,
    };
    cur.inquiryCount += 1;
    if (it.repliedAt || it.status === "replied" || it.unitPrice != null) {
      cur.repliedCount += 1;
    }
    if (it.isSelected) cur.selectedCount += 1;
    if (it.declinedAt || it.status === "declined") cur.declinedCount += 1;
    if (it.deliveryDays != null) {
      cur.deliverySum += it.deliveryDays;
      cur.deliveryN += 1;
    }
    if (it.unitPrice != null) {
      cur.priceSum += Number(it.unitPrice);
      cur.priceN += 1;
      cur.currency = it.currency || cur.currency;
    }
    map.set(it.supplierId, cur);
  }

  const rows: SupplierPerformanceRow[] = [...map.entries()].map(
    ([supplierId, v]) => ({
      supplierId,
      name: v.name,
      inquiryCount: v.inquiryCount,
      repliedCount: v.repliedCount,
      selectedCount: v.selectedCount,
      declinedCount: v.declinedCount,
      replyRate:
        v.inquiryCount > 0
          ? Math.round((v.repliedCount / v.inquiryCount) * 1000) / 10
          : 0,
      selectRate:
        v.repliedCount > 0
          ? Math.round((v.selectedCount / v.repliedCount) * 1000) / 10
          : 0,
      avgDeliveryDays:
        v.deliveryN > 0
          ? Math.round((v.deliverySum / v.deliveryN) * 10) / 10
          : null,
      avgUnitPrice:
        v.priceN > 0 ? Math.round((v.priceSum / v.priceN) * 100) / 100 : null,
      currency: v.currency,
    }),
  );

  rows.sort(
    (a, b) =>
      b.selectedCount - a.selectedCount ||
      b.replyRate - a.replyRate ||
      b.inquiryCount - a.inquiryCount,
  );
  return rows.slice(0, input.limit ?? 30);
}
