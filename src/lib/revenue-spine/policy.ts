/**
 * Revenue Spine — 企业业务配置 / 评分策略 / SLA 与跟进策略（PART 11 / 14 / 16）
 *
 * 规则不写死在 Agent prompt：默认值在此，企业级覆盖存 OrgBusinessRule
 *   ruleKey = "revenue_spine.business_profile" | "revenue_spine.policy"（versioned configJson）。
 * 其它 OEM 企业复用同一结构，只换配置。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const REVENUE_SPINE_POLICY_VERSION = "revenue-spine-policy/v1";

export const RULE_KEY_BUSINESS_PROFILE = "revenue_spine.business_profile";
export const RULE_KEY_POLICY = "revenue_spine.policy";

export type BusinessType = "OEM_MANUFACTURER" | "TRADING_COMPANY" | "BRAND" | "OTHER";

export interface BusinessProfile {
  businessType: BusinessType;
  /** ISO-ish 国家名（英文，如 "Canada"） */
  primaryMarkets: string[];
  /** 可生产的产品类目（内部 key，如 bathrobe / blanket / curtain） */
  productCategories: string[];
  /** 产品识别关键词 → 类目（小写，含中英文） */
  productKeywords: Record<string, string>;
  minimumMargin: number | null;
  defaultCurrency: string;
  defaultIncoterm: string;
  supportedIncoterms: string[];
  samplePolicy: { available: boolean | null; note: string };
}

export interface SalesSlaPolicy {
  /** 新询盘人工处理时限（工作小时） */
  newInquiryResponseHours: number;
  /** 客户来信后回复时限（工作小时） */
  customerReplyResponseHours: number;
}

export interface FollowUpPolicy {
  /** 已回复客户无响应 → 跟进（工作日） */
  afterReplyNoResponseBusinessDays: number;
  /** 报价后逐次跟进天数 */
  quoteFollowUpDays: number[];
  /** 样品送达后跟进（工作日） */
  sampleDeliveredFollowUpBusinessDays: number;
  /** 谈判阶段无动作跟进（工作日） */
  negotiationFollowUpBusinessDays: number;
  /** 长期无互动判定为 stale（天） */
  staleAfterDays: number;
  /** 培育客户定期回访（天） */
  nurtureCheckInDays: number;
  /** 一次回复最多询问的问题数 */
  maxQuestionsPerReply: number;
  /** 历史客户复购提示窗口（天，V1 仅数据接口） */
  reorderWindowDays: number;
}

export interface ScoringPolicy {
  weights: {
    productFit: number;
    commercialPotential: number;
    buyerQuality: number;
    intent: number;
    completeness: number;
    strategicValue: number;
  };
  /** 分数下限：>= hot → HOT，>= high → HIGH，>= medium → MEDIUM，否则 LOW */
  grades: { hot: number; high: number; medium: number };
  /** buyerType → 0..1 质量系数 */
  buyerTypeScores: Record<string, number>;
  /** 数量阶梯（从大到小匹配）：quantity >= min → ratio(0..1) */
  quantityTiers: Array<{ min: number; ratio: number }>;
  /** 数量未知时的 commercialPotential 系数 */
  unknownQuantityRatio: number;
  /** 视为战略市场的国家（英文） */
  strategicMarkets: string[];
  /** 数量达到该值视为大单（战略加分） */
  largeOrderQuantity: number;
  /** 个人买家且数量低于此值 → 不合格 */
  individualMinQuantity: number;
}

export interface RevenueSpinePolicy {
  version: string;
  businessProfile: BusinessProfile;
  salesSla: SalesSlaPolicy;
  followUp: FollowUpPolicy;
  scoring: ScoringPolicy;
  /** 阶段 → 成交概率（Expected Revenue 口径） */
  stageWinProbability: Record<string, number>;
}

/** 通用家纺/OEM 产品词表（企业可覆盖/追加） */
export const DEFAULT_PRODUCT_KEYWORDS: Record<string, string> = {
  "blackout curtain": "curtain",
  "blackout curtains": "curtain",
  "blackout drapes": "curtain",
  curtain: "curtain",
  curtains: "curtain",
  drapery: "curtain",
  drapes: "curtain",
  "sheer curtain": "curtain",
  窗帘: "curtain",
  遮光帘: "curtain",
  遮光窗帘: "curtain",
  bathrobe: "bathrobe",
  bathrobes: "bathrobe",
  robe: "bathrobe",
  robes: "bathrobe",
  "spa robe": "bathrobe",
  "hotel robe": "bathrobe",
  浴袍: "bathrobe",
  睡袍: "bathrobe",
  blanket: "blanket",
  blankets: "blanket",
  throw: "blanket",
  throws: "blanket",
  "fleece blanket": "blanket",
  毯子: "blanket",
  毛毯: "blanket",
  盖毯: "blanket",
  towel: "towel",
  towels: "towel",
  "bath towel": "towel",
  毛巾: "towel",
  浴巾: "towel",
  bedding: "bedding",
  "bed sheet": "bedding",
  "bed sheets": "bedding",
  "duvet cover": "bedding",
  duvet: "bedding",
  comforter: "bedding",
  quilt: "bedding",
  pillowcase: "bedding",
  pillow: "bedding",
  床品: "bedding",
  床单: "bedding",
  被套: "bedding",
  枕套: "bedding",
  cushion: "cushion",
  "cushion cover": "cushion",
  抱枕: "cushion",
  tablecloth: "table_linen",
  "table runner": "table_linen",
  桌布: "table_linen",
  slippers: "slipper",
  slipper: "slipper",
  拖鞋: "slipper",
};

export const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  businessType: "OEM_MANUFACTURER",
  primaryMarkets: ["Canada", "United States", "United Kingdom", "Australia", "Germany"],
  productCategories: ["bathrobe", "blanket", "towel", "bedding", "curtain", "cushion", "table_linen", "slipper"],
  productKeywords: DEFAULT_PRODUCT_KEYWORDS,
  minimumMargin: null,
  defaultCurrency: "USD",
  defaultIncoterm: "FOB",
  supportedIncoterms: ["EXW", "FOB", "CIF", "CFR", "DDP", "DAP"],
  samplePolicy: { available: null, note: "" },
};

export const DEFAULT_REVENUE_SPINE_POLICY: RevenueSpinePolicy = {
  version: REVENUE_SPINE_POLICY_VERSION,
  businessProfile: DEFAULT_BUSINESS_PROFILE,
  salesSla: { newInquiryResponseHours: 4, customerReplyResponseHours: 8 },
  followUp: {
    afterReplyNoResponseBusinessDays: 3,
    quoteFollowUpDays: [3, 7, 14],
    sampleDeliveredFollowUpBusinessDays: 1,
    negotiationFollowUpBusinessDays: 2,
    staleAfterDays: 21,
    nurtureCheckInDays: 30,
    maxQuestionsPerReply: 4,
    reorderWindowDays: 180,
  },
  scoring: {
    weights: {
      productFit: 25,
      commercialPotential: 20,
      buyerQuality: 20,
      intent: 15,
      completeness: 10,
      strategicValue: 10,
    },
    grades: { hot: 90, high: 70, medium: 50 },
    buyerTypeScores: {
      distributor: 0.9,
      hotel_group: 0.9,
      hotel_supplier: 0.85,
      importer: 0.85,
      wholesaler: 0.8,
      brand: 0.85,
      retailer: 0.7,
      contractor: 0.7,
      ecommerce: 0.6,
      sourcing_agent: 0.6,
      individual: 0.2,
      unknown: 0.5,
    },
    quantityTiers: [
      { min: 5000, ratio: 1 },
      { min: 1000, ratio: 0.8 },
      { min: 500, ratio: 0.6 },
      { min: 100, ratio: 0.4 },
      { min: 1, ratio: 0.2 },
    ],
    unknownQuantityRatio: 0.3,
    strategicMarkets: [],
    largeOrderQuantity: 3000,
    individualMinQuantity: 50,
  },
  stageWinProbability: {
    new_inquiry: 0.05,
    enriching: 0.05,
    needs_info: 0.08,
    qualified: 0.15,
    rfq_ready: 0.2,
    quoting: 0.25,
    quoted: 0.3,
    follow_up: 0.3,
    sample: 0.5,
    negotiation: 0.7,
    won: 1,
    lost: 0,
    nurture: 0.05,
    stale: 0.02,
    disqualified: 0,
  },
};

/** 梦馨家纺（浴袍 / 毯子 / 毛巾 / 床品 OEM）企业配置 — 由 scripts/seed-revenue-spine-policy.ts 写入 */
export const MENGXIN_BUSINESS_PROFILE: BusinessProfile = {
  ...DEFAULT_BUSINESS_PROFILE,
  businessType: "OEM_MANUFACTURER",
  primaryMarkets: ["Canada", "United States", "United Kingdom", "Australia"],
  productCategories: ["bathrobe", "blanket", "towel", "bedding", "slipper"],
  defaultCurrency: "USD",
  defaultIncoterm: "FOB",
  supportedIncoterms: ["EXW", "FOB", "CIF", "CFR"],
  samplePolicy: { available: null, note: "" },
};

// ── 合并 / 校验 ──────────────────────────────────────────────

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown, fallback: number | null): number | null {
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function strList(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return out;
}

function numList(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
  return out.length ? out : fallback;
}

function numMap(v: unknown, fallback: Record<string, number>): Record<string, number> {
  const r = rec(v);
  if (!r) return fallback;
  const out: Record<string, number> = { ...fallback };
  for (const [k, val] of Object.entries(r)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
  }
  return out;
}

function strMap(v: unknown, fallback: Record<string, string>): Record<string, string> {
  const r = rec(v);
  if (!r) return fallback;
  const out: Record<string, string> = { ...fallback };
  for (const [k, val] of Object.entries(r)) {
    if (typeof val === "string" && val.trim()) out[k.toLowerCase()] = val.trim();
  }
  return out;
}

export function mergeBusinessProfile(base: BusinessProfile, override: unknown): BusinessProfile {
  const o = rec(override);
  if (!o) return base;
  const bt = str(o.businessType, base.businessType);
  const sp = rec(o.samplePolicy);
  return {
    businessType: (["OEM_MANUFACTURER", "TRADING_COMPANY", "BRAND", "OTHER"] as const).includes(bt as BusinessType)
      ? (bt as BusinessType)
      : base.businessType,
    primaryMarkets: strList(o.primaryMarkets, base.primaryMarkets),
    productCategories: strList(o.productCategories, base.productCategories),
    productKeywords: strMap(o.productKeywords, base.productKeywords),
    minimumMargin: numOrNull(o.minimumMargin, base.minimumMargin),
    defaultCurrency: str(o.defaultCurrency, base.defaultCurrency).toUpperCase(),
    defaultIncoterm: str(o.defaultIncoterm, base.defaultIncoterm).toUpperCase(),
    supportedIncoterms: strList(o.supportedIncoterms, base.supportedIncoterms).map((x) => x.toUpperCase()),
    samplePolicy: sp
      ? {
          available: typeof sp.available === "boolean" ? sp.available : base.samplePolicy.available,
          note: str(sp.note, base.samplePolicy.note),
        }
      : base.samplePolicy,
  };
}

export function mergeRevenueSpinePolicy(base: RevenueSpinePolicy, override: unknown): RevenueSpinePolicy {
  const o = rec(override);
  if (!o) return base;
  const sla = rec(o.salesSla) ?? {};
  const fu = rec(o.followUp) ?? {};
  const sc = rec(o.scoring) ?? {};
  const w = rec(sc.weights) ?? {};
  const g = rec(sc.grades) ?? {};
  const tiersRaw = Array.isArray(sc.quantityTiers) ? sc.quantityTiers : null;
  const tiers = tiersRaw
    ? tiersRaw
        .map((t) => rec(t))
        .filter((t): t is Rec => !!t)
        .map((t) => ({ min: num(t.min, 0), ratio: Math.min(1, Math.max(0, num(t.ratio, 0))) }))
        .filter((t) => t.min > 0)
        .sort((a, b) => b.min - a.min)
    : base.scoring.quantityTiers;
  return {
    version: base.version,
    businessProfile: mergeBusinessProfile(base.businessProfile, o.businessProfile),
    salesSla: {
      newInquiryResponseHours: num(sla.newInquiryResponseHours, base.salesSla.newInquiryResponseHours),
      customerReplyResponseHours: num(sla.customerReplyResponseHours, base.salesSla.customerReplyResponseHours),
    },
    followUp: {
      afterReplyNoResponseBusinessDays: num(fu.afterReplyNoResponseBusinessDays, base.followUp.afterReplyNoResponseBusinessDays),
      quoteFollowUpDays: numList(fu.quoteFollowUpDays, base.followUp.quoteFollowUpDays),
      sampleDeliveredFollowUpBusinessDays: num(fu.sampleDeliveredFollowUpBusinessDays, base.followUp.sampleDeliveredFollowUpBusinessDays),
      negotiationFollowUpBusinessDays: num(fu.negotiationFollowUpBusinessDays, base.followUp.negotiationFollowUpBusinessDays),
      staleAfterDays: num(fu.staleAfterDays, base.followUp.staleAfterDays),
      nurtureCheckInDays: num(fu.nurtureCheckInDays, base.followUp.nurtureCheckInDays),
      maxQuestionsPerReply: Math.max(1, Math.min(8, num(fu.maxQuestionsPerReply, base.followUp.maxQuestionsPerReply))),
      reorderWindowDays: num(fu.reorderWindowDays, base.followUp.reorderWindowDays),
    },
    scoring: {
      weights: {
        productFit: num(w.productFit, base.scoring.weights.productFit),
        commercialPotential: num(w.commercialPotential, base.scoring.weights.commercialPotential),
        buyerQuality: num(w.buyerQuality, base.scoring.weights.buyerQuality),
        intent: num(w.intent, base.scoring.weights.intent),
        completeness: num(w.completeness, base.scoring.weights.completeness),
        strategicValue: num(w.strategicValue, base.scoring.weights.strategicValue),
      },
      grades: {
        hot: num(g.hot, base.scoring.grades.hot),
        high: num(g.high, base.scoring.grades.high),
        medium: num(g.medium, base.scoring.grades.medium),
      },
      buyerTypeScores: numMap(sc.buyerTypeScores, base.scoring.buyerTypeScores),
      quantityTiers: tiers,
      unknownQuantityRatio: num(sc.unknownQuantityRatio, base.scoring.unknownQuantityRatio),
      strategicMarkets: strList(sc.strategicMarkets, base.scoring.strategicMarkets),
      largeOrderQuantity: num(sc.largeOrderQuantity, base.scoring.largeOrderQuantity),
      individualMinQuantity: num(sc.individualMinQuantity, base.scoring.individualMinQuantity),
    },
    stageWinProbability: numMap(o.stageWinProbability, base.stageWinProbability),
  };
}

// ── 读写（OrgBusinessRule） ───────────────────────────────────

async function loadActiveRuleConfig(orgId: string, ruleKey: string): Promise<unknown | null> {
  const row = await db.orgBusinessRule.findFirst({
    where: { orgId, ruleKey, status: "active" },
    orderBy: { version: "desc" },
    select: { configJson: true },
  });
  return row?.configJson ?? null;
}

/** 企业策略 = 默认 ← revenue_spine.policy ← revenue_spine.business_profile（profile 单独可覆盖） */
export async function loadRevenueSpinePolicy(orgId: string): Promise<RevenueSpinePolicy> {
  const [policyOverride, profileOverride] = await Promise.all([
    loadActiveRuleConfig(orgId, RULE_KEY_POLICY),
    loadActiveRuleConfig(orgId, RULE_KEY_BUSINESS_PROFILE),
  ]);
  let merged = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, policyOverride);
  if (profileOverride) {
    merged = { ...merged, businessProfile: mergeBusinessProfile(merged.businessProfile, profileOverride) };
  }
  return merged;
}

/** 发布新版本（旧 active → superseded） */
export async function publishRevenueSpineRule(params: {
  orgId: string;
  ruleKey: typeof RULE_KEY_POLICY | typeof RULE_KEY_BUSINESS_PROFILE;
  config: Record<string, unknown>;
  userId: string | null;
}): Promise<{ version: number }> {
  return db.$transaction(async (tx) => {
    const latest = await tx.orgBusinessRule.findFirst({
      where: { orgId: params.orgId, ruleKey: params.ruleKey },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    await tx.orgBusinessRule.updateMany({
      where: { orgId: params.orgId, ruleKey: params.ruleKey, status: "active" },
      data: { status: "superseded" },
    });
    await tx.orgBusinessRule.create({
      data: {
        orgId: params.orgId,
        ruleKey: params.ruleKey,
        version,
        status: "active",
        configJson: params.config as Prisma.InputJsonValue,
        createdById: params.userId,
        updatedById: params.userId,
      },
    });
    return { version };
  });
}

export type ScoreGrade = "HOT" | "HIGH" | "MEDIUM" | "LOW";
export type ActionPriority = "urgent" | "high" | "medium" | "low";

export function gradeForScore(score: number, policy: ScoringPolicy): ScoreGrade {
  if (score >= policy.grades.hot) return "HOT";
  if (score >= policy.grades.high) return "HIGH";
  if (score >= policy.grades.medium) return "MEDIUM";
  return "LOW";
}

export function priorityForGrade(grade: ScoreGrade): ActionPriority {
  switch (grade) {
    case "HOT":
      return "urgent";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    default:
      return "low";
  }
}
