/**
 * Revenue Spine — Missing Information Engine（PART 5）
 *
 * 优先级：影响 feasibility > 影响 costing > 影响 lead time；一次最多问 N 个（policy.followUp.maxQuestionsPerReply）。
 */

import type { InquiryLanguage } from "../normalize";
import { RFQ_FIELD_LABELS, type RfqField, type RfqFields } from "./types";

export type MissingTier = "feasibility" | "costing" | "lead_time";

/** 顺序即询问优先级 */
export const MISSING_FIELD_TIERS: Array<{ field: RfqField; tier: MissingTier; required: boolean }> = [
  { field: "productName", tier: "feasibility", required: true },
  { field: "quantity", tier: "feasibility", required: true },
  { field: "size", tier: "feasibility", required: true },
  { field: "material", tier: "feasibility", required: true },
  { field: "composition", tier: "costing", required: false },
  { field: "customization", tier: "costing", required: false },
  { field: "packaging", tier: "costing", required: false },
  { field: "certification", tier: "costing", required: false },
  { field: "targetPrice", tier: "costing", required: false },
  { field: "destinationCountry", tier: "lead_time", required: true },
  { field: "destinationCity", tier: "lead_time", required: true },
  { field: "requiredDeliveryDate", tier: "lead_time", required: true },
  { field: "incoterm", tier: "lead_time", required: false },
];

export const REQUIRED_RFQ_FIELDS: RfqField[] = MISSING_FIELD_TIERS.filter((t) => t.required).map((t) => t.field);

function isMissing(fields: RfqFields, field: RfqField): boolean {
  const v = fields[field];
  return v === null || v === undefined || v === "";
}

/** 按优先级排序的缺失字段：必填（按 tier 顺序）在前，非必填成本项在后 */
export function computeMissingFields(fields: RfqFields): RfqField[] {
  const missing = MISSING_FIELD_TIERS.filter((t) => isMissing(fields, t.field));
  return [...missing.filter((t) => t.required), ...missing.filter((t) => !t.required)].map((t) => t.field);
}

export function computeMissingRequiredFields(fields: RfqFields): RfqField[] {
  return MISSING_FIELD_TIERS.filter((t) => t.required && isMissing(fields, t.field)).map((t) => t.field);
}

export function missingFeasibilityFields(fields: RfqFields): RfqField[] {
  return MISSING_FIELD_TIERS.filter((t) => t.tier === "feasibility" && isMissing(fields, t.field)).map((t) => t.field);
}

export type RfqStatus = "draft" | "partial" | "complete";

export function rfqStatusFor(fields: RfqFields): RfqStatus {
  const missing = computeMissingRequiredFields(fields);
  if (missing.length === 0) return "complete";
  const filled = REQUIRED_RFQ_FIELDS.length - missing.length;
  return filled >= 2 ? "partial" : "draft";
}

export function completenessRatio(fields: RfqFields): number {
  const missing = computeMissingRequiredFields(fields);
  return (REQUIRED_RFQ_FIELDS.length - missing.length) / REQUIRED_RFQ_FIELDS.length;
}

const QUESTION_TEMPLATES: Record<RfqField, { zh: string; en: string }> = {
  productCategory: { zh: "请确认您需要的产品类目。", en: "Could you confirm the product category you are looking for?" },
  productName: { zh: "请告诉我们您需要的具体产品。", en: "Which specific product are you looking for?" },
  material: { zh: "请确认面料/材质要求（例如纯棉、涤纶、珊瑚绒）。", en: "What material or fabric do you require (e.g. cotton, polyester, coral fleece)?" },
  composition: { zh: "请提供成分与克重要求（例如 100% 涤纶 280GSM）。", en: "Could you share the composition and weight (e.g. 100% polyester, 280 GSM)?" },
  size: { zh: "请提供成品尺寸（长 × 宽，或尺码范围）。", en: "What are the finished sizes (width × length, or size range)?" },
  quantity: { zh: "请告知本次预计采购数量。", en: "What quantity are you planning to order?" },
  unit: { zh: "请确认数量单位。", en: "Could you confirm the unit of quantity?" },
  color: { zh: "请确认颜色要求。", en: "Which colors do you need?" },
  customLogo: { zh: "是否需要定制 Logo（绣花/印花）？", en: "Do you need a custom logo (embroidery or print)?" },
  customization: { zh: "请说明定制要求（Logo、设计、标签等）。", en: "Please describe any customization (logo, design, labels)." },
  packaging: { zh: "请确认包装要求（单件包装 / 外箱 / 吊牌）。", en: "What packaging do you require (unit packaging, cartons, hang tags)?" },
  certification: { zh: "是否需要特定认证（如 OEKO-TEX、BSCI）？", en: "Do you require any specific certifications (e.g. OEKO-TEX, BSCI)?" },
  sampleRequired: { zh: "是否需要先打样？", en: "Would you like samples before bulk production?" },
  targetPrice: { zh: "如方便，请提供目标价格区间。", en: "If possible, please share your target price range." },
  currency: { zh: "请确认报价币种。", en: "Which currency would you like the quotation in?" },
  destinationCountry: { zh: "请告知货物目的国。", en: "Which country should the goods be delivered to?" },
  destinationCity: { zh: "请告知交货目的地（城市或港口）。", en: "What is the delivery destination (city or port)?" },
  incoterm: { zh: "请确认期望的贸易术语（FOB / CIF / DDP 等）。", en: "Which trade term do you prefer (FOB / CIF / DDP)?" },
  requiredDeliveryDate: { zh: "请告知要求的交货日期。", en: "When do you need the goods delivered by?" },
  buyerType: { zh: "请介绍贵司的业务类型（经销商 / 酒店集团 / 品牌等）。", en: "Could you tell us a little about your business (distributor, hotel group, brand)?" },
  application: { zh: "请说明产品用途场景。", en: "What is the intended application of the products?" },
};

export interface ClarifyingQuestion {
  field: RfqField;
  tier: MissingTier;
  label: string;
  question: string;
}

/** 生成客户问题：feasibility → costing → lead time，最多 max 个 */
export function buildClarifyingQuestions(
  missing: RfqField[],
  language: InquiryLanguage,
  max: number,
): ClarifyingQuestion[] {
  const lang: "zh" | "en" = language === "zh" ? "zh" : "en";
  const tiers = new Map(MISSING_FIELD_TIERS.map((t) => [t.field, t]));
  const ordered = MISSING_FIELD_TIERS.filter((t) => missing.includes(t.field));
  // 必填优先；非必填成本项只在名额剩余时追加
  const required = ordered.filter((t) => t.required);
  const optional = ordered.filter((t) => !t.required);
  const picked = [...required, ...optional].slice(0, Math.max(1, max));
  return picked.map((t) => ({
    field: t.field,
    tier: tiers.get(t.field)!.tier,
    label: RFQ_FIELD_LABELS[t.field][lang],
    question: QUESTION_TEMPLATES[t.field][lang],
  }));
}
