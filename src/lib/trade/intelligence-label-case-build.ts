/**
 * 由 Vision / 用户确认后的 Label 字段生成 TradeIntelligenceCase 写入载荷
 */

import type { LabelExtractedFields } from "./intelligence-label-types";
import { pickMpnForCase, pickUpcForCase } from "./intelligence-label-vision";

export function buildCasePayloadFromLabelFields(options: {
  extractedFields: LabelExtractedFields;
  assetType: string;
  safeFileName: string;
  userNotes: string | null;
  extractedSummary: string | null;
}): {
  title: string;
  notes: string;
  structuredProduct: object;
  productName: string | null;
  brand: string | null;
  upc: string | null;
  gtin: string | null;
  sku: string | null;
  mpn: string | null;
  material: string | null;
  size: string | null;
  color: string | null;
  countryOfOrigin: string | null;
  retailerName: string | null;
} {
  const { extractedFields, assetType, safeFileName, userNotes, extractedSummary } = options;
  const upc = pickUpcForCase(extractedFields);
  const mpn = pickMpnForCase(extractedFields);
  const productName = extractedFields.productName?.value?.trim() || null;
  const brand = extractedFields.brand?.value?.trim() || null;
  const sku = extractedFields.sku?.value?.trim() || null;
  const gtin = extractedFields.gtin?.value?.trim() || null;
  const material = extractedFields.material?.value?.trim() || null;
  const size = extractedFields.size?.value?.trim() || null;
  const color = extractedFields.color?.value?.trim() || null;
  const countryOfOrigin = extractedFields.countryOfOrigin?.value?.trim() || null;
  const retailerName = extractedFields.retailer?.value?.trim() || null;

  const extraLines: string[] = [];
  if (extractedSummary) extraLines.push(`Vision 摘要：${extractedSummary}`);
  const mf = extractedFields.manufacturer?.value?.trim();
  if (mf) extraLines.push(`Manufacturer（吊牌）: ${mf}`);
  const im = extractedFields.importer?.value?.trim();
  if (im) extraLines.push(`Importer（吊牌）: ${im}`);
  const dist = extractedFields.distributor?.value?.trim();
  if (dist) extraLines.push(`Distributor（吊牌）: ${dist}`);
  const addr = extractedFields.address?.value?.trim();
  if (addr) extraLines.push(`Address（吊牌）: ${addr.slice(0, 500)}`);

  const notes = [
    `[吊牌识别] assetType=${assetType} file=${safeFileName}`,
    ...extraLines,
    userNotes ? `用户备注: ${userNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const title =
    [brand, productName].filter(Boolean).join(" · ") ||
    (upc ? `竞品溯源 · UPC ${upc}` : mpn ? `竞品溯源 · MPN ${mpn}` : `竞品溯源 · 图片 ${safeFileName}`);

  const structuredProduct = {
    labelImage: true,
    assetType,
    extractedSummary: extractedSummary ?? "",
    extractedFields,
  };

  return {
    title: title.slice(0, 500),
    notes: notes.slice(0, 12000),
    structuredProduct,
    productName,
    brand,
    upc,
    gtin,
    sku,
    mpn,
    material,
    size,
    color,
    countryOfOrigin,
    retailerName,
  };
}
