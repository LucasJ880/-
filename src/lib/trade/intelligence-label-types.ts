/**
 * 吊牌 / 包装图 Vision 提取 — 字段槽位（与 API / DB JSON 一致）
 */

export type LabelFieldSource =
  | "visible_text"
  | "barcode_digits"
  | "inferred_from_label"
  | "user_confirmed"
  | "unknown";

export interface LabelFieldSlot {
  value: string | null;
  confidence: number;
  evidence: string;
  source: LabelFieldSource;
}

/** AI 顶层 JSON 的字段键（与 prompt 一致） */
export const LABEL_VISION_FIELD_KEYS = [
  "productName",
  "brand",
  "upc",
  "gtin",
  "sku",
  "mpn",
  "styleNumber",
  "itemNumber",
  "material",
  "size",
  "color",
  "countryOfOrigin",
  "manufacturer",
  "importer",
  "distributor",
  "retailer",
  "address",
  "barcodeDigits",
  "language",
  "marketRegion",
  "notes",
] as const;

export type LabelVisionFieldKey = (typeof LABEL_VISION_FIELD_KEYS)[number];

export type LabelExtractedFields = Partial<Record<LabelVisionFieldKey, LabelFieldSlot>>;
