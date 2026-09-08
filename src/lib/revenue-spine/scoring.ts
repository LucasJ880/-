/**
 * Revenue Spine — 可解释 Opportunity Score（PART 4 Step 3-4 / 10 / 11）
 *
 * 不让 LLM 凭感觉打总分：六个维度按策略权重计算，每个维度带 reason。
 */

import { INTENT_ASK_KEYWORDS, URGENCY_KEYWORDS } from "./lexicon";
import { gradeForScore, priorityForGrade, type ActionPriority, type RevenueSpinePolicy, type ScoreGrade } from "./policy";
import type { InquiryResearch } from "./research";
import { completenessRatio, computeMissingFields, missingFeasibilityFields } from "./rfq/missing-info";
import type { RfqField, RfqFields } from "./rfq/types";

export interface ScoreDimension {
  key: "productFit" | "commercialPotential" | "buyerQuality" | "intent" | "completeness" | "strategicValue";
  label: string;
  score: number;
  max: number;
  reason: string;
}

export type RecommendedAction =
  | "ask_missing_info"
  | "prepare_quote"
  | "reply_and_qualify"
  | "nurture"
  | "decline";

export type Qualification = "qualified" | "rfq_ready" | "needs_info" | "disqualified";

export interface OpportunityScoreResult {
  score: number;
  grade: ScoreGrade;
  priority: ActionPriority;
  dimensions: ScoreDimension[];
  reasoning: string;
  missingInformation: RfqField[];
  qualification: Qualification;
  recommendedNextAction: RecommendedAction;
  recommendedNextActionLabel: { zh: string; en: string };
  policyVersion: string;
  /** quantity × targetPrice（两者都有时），供 estimatedValue */
  estimatedValue: number | null;
}

const ACTION_LABELS: Record<RecommendedAction, { zh: string; en: string }> = {
  ask_missing_info: { zh: "报价前先向客户确认缺失的技术信息", en: "Ask missing technical questions before quoting." },
  prepare_quote: { zh: "信息齐全，进入报价准备", en: "RFQ is complete — prepare the quotation." },
  reply_and_qualify: { zh: "先回复并确认买家背景与需求", en: "Reply and qualify the buyer and requirement." },
  nurture: { zh: "潜力有限，转入培育", en: "Limited potential — move to nurture." },
  decline: { zh: "产品不匹配，礼貌婉拒或转介", en: "Product does not fit — politely decline or refer." },
};

function round(n: number): number {
  return Math.round(n);
}

export interface ScoreInput {
  fields: RfqFields;
  research: InquiryResearch;
  message: string;
  policy: RevenueSpinePolicy;
}

export function scoreOpportunity(input: ScoreInput): OpportunityScoreResult {
  const { fields, research, policy } = input;
  const w = policy.scoring.weights;
  const lower = (input.message ?? "").toLowerCase();
  const dims: ScoreDimension[] = [];

  // 1. Product Fit
  const categories = policy.businessProfile.productCategories;
  let productFit = 0;
  let productReason: string;
  if (fields.productCategory && categories.includes(fields.productCategory)) {
    productFit = w.productFit;
    productReason = `产品类目「${fields.productCategory}」在工厂能力范围内`;
  } else if (fields.productCategory) {
    productFit = round(w.productFit * 0.5);
    productReason = `产品类目「${fields.productCategory}」不在已配置能力范围（${categories.join("/") || "未配置"}），需内部确认`;
  } else if (fields.productName) {
    productFit = round(w.productFit * 0.4);
    productReason = `识别到产品「${fields.productName}」但未映射到类目`;
  } else {
    productFit = round(w.productFit * 0.2);
    productReason = "未识别到具体产品";
  }
  dims.push({ key: "productFit", label: "Product Fit", score: productFit, max: w.productFit, reason: productReason });

  // 2. Commercial Potential
  let commercial: number;
  let commercialReason: string;
  if (fields.quantity && fields.quantity > 0) {
    const tier = policy.scoring.quantityTiers.find((t) => fields.quantity! >= t.min);
    const ratio = tier?.ratio ?? 0.2;
    commercial = round(w.commercialPotential * ratio);
    commercialReason = `数量 ${fields.quantity}${fields.unit ? " " + fields.unit : ""} 落在阶梯 ≥${tier?.min ?? 1}`;
  } else {
    commercial = round(w.commercialPotential * policy.scoring.unknownQuantityRatio);
    commercialReason = "数量未知，按中性系数计";
  }
  dims.push({ key: "commercialPotential", label: "Commercial Potential", score: commercial, max: w.commercialPotential, reason: commercialReason });

  // 3. Buyer Quality
  const buyerType = fields.buyerType ?? research.buyerType ?? "unknown";
  const bq = policy.scoring.buyerTypeScores[buyerType] ?? policy.scoring.buyerTypeScores.unknown ?? 0.5;
  let buyer = round(w.buyerQuality * bq);
  let buyerReason = `买家类型 ${buyerType}（系数 ${bq}）`;
  if (research.isFreeMail) {
    buyer = Math.max(0, buyer - 3);
    buyerReason += "，免费邮箱 −3";
  }
  dims.push({ key: "buyerQuality", label: "Buyer Quality", score: buyer, max: w.buyerQuality, reason: buyerReason });

  // 4. Intent
  let intent = 0;
  const intentBits: string[] = [];
  if (fields.quantity) {
    intent += 5;
    intentBits.push("给出数量");
  }
  if (fields.productName) {
    intent += 4;
    intentBits.push("产品明确");
  }
  if (INTENT_ASK_KEYWORDS.some((k) => lower.includes(k))) {
    intent += 4;
    intentBits.push("询问 MOQ/价格/交期");
  }
  if (URGENCY_KEYWORDS.some((k) => lower.includes(k)) || fields.requiredDeliveryDate) {
    intent += 2;
    intentBits.push("有交期/紧迫性");
  }
  intent = Math.min(w.intent, round((intent / 15) * w.intent));
  dims.push({ key: "intent", label: "Intent", score: intent, max: w.intent, reason: intentBits.join("、") || "询价信息笼统" });

  // 5. Completeness
  const ratio = completenessRatio(fields);
  const completeness = round(w.completeness * ratio);
  const missing = computeMissingFields(fields);
  dims.push({
    key: "completeness",
    label: "Completeness",
    score: completeness,
    max: w.completeness,
    reason: `必填字段完整度 ${Math.round(ratio * 100)}%`,
  });

  // 6. Strategic Value
  let strategic = 0;
  const strategicBits: string[] = [];
  const market = fields.destinationCountry ?? research.country;
  if (market && policy.scoring.strategicMarkets.some((m) => m.toLowerCase() === market.toLowerCase())) {
    strategic += round(w.strategicValue * 0.5);
    strategicBits.push(`战略市场 ${market}`);
  }
  if (fields.quantity && fields.quantity >= policy.scoring.largeOrderQuantity) {
    strategic += round(w.strategicValue * 0.3);
    strategicBits.push("大单");
  }
  if (["distributor", "hotel_group", "brand", "importer", "wholesaler", "hotel_supplier"].includes(buyerType)) {
    strategic += round(w.strategicValue * 0.2);
    strategicBits.push("长期渠道型买家");
  }
  strategic = Math.min(w.strategicValue, strategic);
  dims.push({ key: "strategicValue", label: "Strategic Value", score: strategic, max: w.strategicValue, reason: strategicBits.join("、") || "无额外战略加分" });

  const total = Math.min(100, dims.reduce((s, d) => s + d.score, 0));
  const grade = gradeForScore(total, policy.scoring);

  // Qualification + recommended action
  const feasibilityMissing = missingFeasibilityFields(fields);
  const requiredMissing = missing.filter((f) => ["productName", "quantity", "size", "material", "destinationCountry", "destinationCity", "requiredDeliveryDate"].includes(f));
  let qualification: Qualification;
  let action: RecommendedAction;
  const individualTooSmall =
    buyerType === "individual" && (fields.quantity ?? 0) < policy.scoring.individualMinQuantity;
  if (productFit === 0 || individualTooSmall) {
    qualification = "disqualified";
    action = individualTooSmall ? "nurture" : "decline";
  } else if (feasibilityMissing.length > 0) {
    qualification = "needs_info";
    action = fields.productName || fields.quantity ? "ask_missing_info" : "reply_and_qualify";
  } else if (requiredMissing.length > 0) {
    qualification = "qualified";
    action = "ask_missing_info";
  } else {
    qualification = "rfq_ready";
    action = "prepare_quote";
  }

  const reasoning = dims.map((d) => `${d.label} ${d.score}/${d.max}：${d.reason}`).join("\n");
  const estimatedValue =
    fields.quantity && fields.targetPrice && fields.quantity > 0 && fields.targetPrice > 0
      ? Math.round(fields.quantity * fields.targetPrice * 100) / 100
      : null;

  return {
    score: total,
    grade,
    priority: priorityForGrade(grade),
    dimensions: dims,
    reasoning,
    missingInformation: missing,
    qualification,
    recommendedNextAction: action,
    recommendedNextActionLabel: ACTION_LABELS[action],
    policyVersion: policy.version,
    estimatedValue,
  };
}
