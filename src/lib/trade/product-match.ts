/**
 * 询盘/手输货号 → 组织内 TradeProduct。只匹配已有目录，不编造货号。
 */

import { db } from "@/lib/db";

export type TradeProductMatch = {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  category: string | null;
  status: string;
};

export function parseInquiryQuantity(raw?: string | null): number {
  if (!raw) return 1;
  const n = Number(String(raw).replace(/,/g, "").match(/[\d.]+/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function tokenizeProductQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,;/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
}

export function rankProductMatch(
  product: { sku: string; name: string; nameEn?: string | null },
  query: { sku?: string | null; productName?: string | null },
): number {
  const skuQ = (query.sku ?? "").trim().toLowerCase();
  const nameQ = (query.productName ?? "").trim().toLowerCase();
  const sku = product.sku.toLowerCase();
  const name = `${product.name} ${product.nameEn ?? ""}`.toLowerCase();
  let score = 0;
  if (skuQ && sku === skuQ) score += 100;
  else if (skuQ && sku.includes(skuQ)) score += 40;
  if (nameQ && name.includes(nameQ)) score += 30;
  for (const token of tokenizeProductQuery(nameQ)) {
    if (name.includes(token)) score += 8;
    if (sku.includes(token)) score += 6;
  }
  return score;
}

export async function searchTradeProductsForOrg(input: {
  orgId: string;
  query?: string;
  sku?: string;
  productName?: string;
  take?: number;
}): Promise<TradeProductMatch[]> {
  const take = Math.min(20, Math.max(1, input.take ?? 8));
  const q = (input.query ?? input.sku ?? input.productName ?? "").trim();
  const where = {
    orgId: input.orgId,
    status: { not: "archived" },
    ...(q
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { nameEn: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const rows = await db.tradeProduct.findMany({
    where,
    take: take * 3,
    orderBy: { updatedAt: "desc" },
    select: { id: true, sku: true, name: true, nameEn: true, category: true, status: true },
  });
  const ranked = rows
    .map((p) => ({
      p,
      score: rankProductMatch(p, { sku: input.sku ?? q, productName: input.productName ?? q }),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, take).map((r) => r.p);
}

export async function loadTradeProductForOrg(productId: string, orgId: string) {
  return db.tradeProduct.findFirst({
    where: { id: productId, orgId, status: { not: "archived" } },
    select: { id: true, sku: true, name: true, nameEn: true, category: true, status: true },
  });
}
