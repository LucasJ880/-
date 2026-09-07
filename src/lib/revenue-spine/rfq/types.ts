/**
 * Revenue Spine — 结构化 RFQ 类型（PART 3 / 8）
 */

import type { InquiryLanguage } from "../normalize";

export const RFQ_FIELDS = [
  "productCategory",
  "productName",
  "material",
  "composition",
  "size",
  "quantity",
  "unit",
  "color",
  "customLogo",
  "customization",
  "packaging",
  "certification",
  "sampleRequired",
  "targetPrice",
  "currency",
  "destinationCountry",
  "destinationCity",
  "incoterm",
  "requiredDeliveryDate",
  "buyerType",
  "application",
] as const;

export type RfqField = (typeof RFQ_FIELDS)[number];

export interface RfqFields {
  productCategory: string | null;
  productName: string | null;
  material: string | null;
  composition: string | null;
  size: string | null;
  quantity: number | null;
  unit: string | null;
  color: string | null;
  customLogo: boolean | null;
  customization: string | null;
  packaging: string | null;
  certification: string | null;
  sampleRequired: boolean | null;
  targetPrice: number | null;
  currency: string | null;
  destinationCountry: string | null;
  destinationCity: string | null;
  incoterm: string | null;
  requiredDeliveryDate: Date | null;
  buyerType: string | null;
  application: string | null;
}

export type RfqExtractedBy = "heuristic" | "llm" | "human";

export interface RfqEvidence {
  field: RfqField;
  /** 字段值的字符串形式（数字/布尔/日期序列化） */
  value: string;
  /** 0..1 */
  confidence: number;
  /** 来源文本片段（必须来自源消息） */
  evidenceText: string;
  extractedBy: RfqExtractedBy;
}

export type RfqExtractionMethod = "heuristic" | "llm" | "merged" | "manual";

export interface RfqExtraction {
  fields: RfqFields;
  evidence: RfqEvidence[];
  language: InquiryLanguage;
  method: RfqExtractionMethod;
  /** 抽取过程说明（不写入客户可见内容） */
  notes: string[];
}

export function emptyRfqFields(): RfqFields {
  return {
    productCategory: null,
    productName: null,
    material: null,
    composition: null,
    size: null,
    quantity: null,
    unit: null,
    color: null,
    customLogo: null,
    customization: null,
    packaging: null,
    certification: null,
    sampleRequired: null,
    targetPrice: null,
    currency: null,
    destinationCountry: null,
    destinationCity: null,
    incoterm: null,
    requiredDeliveryDate: null,
    buyerType: null,
    application: null,
  };
}

export function isRfqField(v: unknown): v is RfqField {
  return typeof v === "string" && (RFQ_FIELDS as readonly string[]).includes(v);
}

export function rfqValueToString(field: RfqField, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return String(value);
}

export const RFQ_FIELD_LABELS: Record<RfqField, { zh: string; en: string }> = {
  productCategory: { zh: "产品类目", en: "Product category" },
  productName: { zh: "产品", en: "Product" },
  material: { zh: "材质", en: "Material" },
  composition: { zh: "成分/克重", en: "Composition / weight" },
  size: { zh: "尺寸", en: "Size" },
  quantity: { zh: "数量", en: "Quantity" },
  unit: { zh: "单位", en: "Unit" },
  color: { zh: "颜色", en: "Color" },
  customLogo: { zh: "定制 Logo", en: "Custom logo" },
  customization: { zh: "定制要求", en: "Customization" },
  packaging: { zh: "包装", en: "Packaging" },
  certification: { zh: "认证", en: "Certification" },
  sampleRequired: { zh: "是否需样品", en: "Sample required" },
  targetPrice: { zh: "目标价", en: "Target price" },
  currency: { zh: "币种", en: "Currency" },
  destinationCountry: { zh: "目的国", en: "Destination country" },
  destinationCity: { zh: "交货目的地（城市/港口）", en: "Delivery destination (city / port)" },
  incoterm: { zh: "贸易术语", en: "Incoterm" },
  requiredDeliveryDate: { zh: "要求交期", en: "Required delivery date" },
  buyerType: { zh: "买家类型", en: "Buyer type" },
  application: { zh: "用途", en: "Application" },
};
