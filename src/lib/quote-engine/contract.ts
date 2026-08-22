/**
 * Quote & Cost Engine Phase 1 · 契约（词表 / 输入结构 / zod）
 *
 * 数据链：Tender(Project) → Cost Budget(QuoteCostLine) → Pricing(rule + revenue-based lines)
 *        → Quote Version(ProjectQuote.version/sourceQuoteId) → Award → Project Budget(ProjectBudget*) → Actual(ProjectCost)
 * 纪律：成本与卖价彻底分开；定价口径（Markup on Cost / Margin on Revenue）必须显式；
 *       AI 仅 advisory；历史 approved 版本不可覆盖；禁 eval 用户公式。
 */

import { z } from "zod";

export const QUOTE_ENGINE_CALC_VERSION = "quote-engine-calc/v1" as const;

export const QUOTE_TYPES = [
  "PROJECT_SUPPLY_INSTALL",
  "STANDING_OFFER",
  "SUPPLY_ONLY",
  "INSTALL_ONLY",
  "SERVICE",
  "CUSTOM",
] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];

/** 与既有 ProjectQuote.status（小写）约定一致 */
export const QUOTE_STATUSES = ["draft", "review", "approved", "superseded", "awarded", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ["review", "cancelled"],
  review: ["approved", "draft", "cancelled"],
  approved: ["superseded", "awarded", "cancelled"],
  superseded: [],
  awarded: [],
  cancelled: [],
};
/** approved 之后内容冻结：只能通过 revision（新版本）修改；cancelled 为终态同样冻结（B4） */
export const FROZEN_STATUSES: readonly QuoteStatus[] = ["approved", "superseded", "awarded", "cancelled"];

export const COST_CATEGORIES = [
  "MATERIAL",
  "PROCUREMENT",
  "LOGISTICS",
  "FREIGHT",
  "CUSTOMS",
  "DUTY",
  "LABOUR",
  "EQUIPMENT",
  "SITE_GENERAL",
  "ENGINEERING",
  "PERMIT",
  "COMPLIANCE",
  "PROJECT_MANAGEMENT",
  "INSURANCE",
  "BOND",
  "FINANCING",
  "WAREHOUSING",
  "ADMIN",
  "COMMISSION",
  "CONTINGENCY",
  "PROFIT",
  "OTHER",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** 资本占用（Cash Required / PERCENT_OF_CAPITAL 默认基数）= 采购 + 物流 + 关税类 */
export const CAPITAL_CATEGORIES: readonly CostCategory[] = ["MATERIAL", "PROCUREMENT", "LOGISTICS", "FREIGHT", "CUSTOMS", "DUTY", "WAREHOUSING"];
/** 到岸成本（LANDED 基数） */
export const LANDED_CATEGORIES: readonly CostCategory[] = ["MATERIAL", "PROCUREMENT", "LOGISTICS", "FREIGHT", "CUSTOMS", "DUTY"];
export const PROCUREMENT_CATEGORIES: readonly CostCategory[] = ["MATERIAL", "PROCUREMENT"];

export const CALCULATION_TYPES = [
  "FIXED",
  "PER_UNIT",
  "PER_HOUR",
  "PER_DAY",
  "PER_MONTH",
  "PER_TRIP",
  "PER_CONTAINER",
  "PERCENT_OF_COST",
  "PERCENT_OF_REVENUE",
  "PERCENT_OF_CAPITAL",
  "TIER_BASED",
  "CUSTOM_FORMULA",
] as const;
export type CalculationType = (typeof CALCULATION_TYPES)[number];

export const PERCENT_OF_COST_TYPES: readonly CalculationType[] = ["PERCENT_OF_COST", "PERCENT_OF_CAPITAL"];
export const REVENUE_BASED_TYPES: readonly CalculationType[] = ["PERCENT_OF_REVENUE"];

/** 百分比基数：固定基数 | CATEGORY:<COST_CATEGORY> */
export const CALC_BASES = ["DIRECT_COST", "PROCUREMENT", "LANDED", "CAPITAL", "REVENUE"] as const;
export type CalcBase = (typeof CALC_BASES)[number] | `CATEGORY:${CostCategory}`;

export const PRICING_METHODS = ["MARKUP_ON_COST", "MARGIN_ON_REVENUE"] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];
export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  MARKUP_ON_COST: "Markup on Cost（成本加成）",
  MARGIN_ON_REVENUE: "Margin on Selling Price（按售价毛利率）",
};

export const QUOTE_CURRENCIES = ["CAD", "USD", "CNY", "EUR", "GBP"] as const;

/* ------------------------------- 引擎输入（纯数据） ------------------------------- */

export type CostLineInput = {
  id: string;
  sortOrder: number;
  category: string;
  subcategory?: string | null;
  description: string;
  quantity: number | null;
  unit?: string | null;
  unitCost: number | null;
  sourceCurrency: string;
  /** 1 原币 = fxRate 报价币；报价币本币时 1 */
  fxRate: number | null;
  calculationType: string;
  calculationBase?: string | null;
  /** 百分数 */
  rate: number | null;
  duration: number | null;
  included: boolean;
  supplierName?: string | null;
  notes?: string | null;
};

export type PricingRuleInput = { method: string; rate: number | null };

export type ScenarioParam = { key: string; labelZh: string; method: string; rate: number };

export type TaxConfig = { gstPct?: number | null; hstPct?: number | null; pstPct?: number | null };

export type StandingOfferInput = {
  supplierCostPerPiece: number | null;
  supplierCurrency?: string | null;
  fxRate?: number | null;
  piecesPerBox: number | null;
  boxesPerContainer: number | null;
  moq?: number | null;
  annualQuantity?: number | null;
  freightPerContainer?: number | null;
  customsPerContainer?: number | null;
  /** 关税 %（对供应商货值） */
  dutyPct?: number | null;
  warehousePerContainer?: number | null;
  otherPerContainer?: number | null;
  /** 库存持有 %（对到岸成本） */
  inventoryCarryingPct?: number | null;
};

export type TierInput = {
  id: string;
  sortOrder: number;
  tierName: string;
  minQuantity: number;
  maxQuantity: number | null;
  expectedQuantity: number;
  pricingMethod: string;
  rate: number | null;
  active: boolean;
};

export type EngineConfig = {
  scenarios?: ScenarioParam[];
  tax?: TaxConfig;
  standingOffer?: StandingOfferInput | null;
  /** 风险阈值（情景风险指示用，可配置） */
  marginRiskPct?: { high: number; medium: number };
};

export const DEFAULT_SCENARIOS: ScenarioParam[] = [
  { key: "aggressive", labelZh: "Aggressive（进攻）", method: "MARGIN_ON_REVENUE", rate: 8 },
  { key: "recommended", labelZh: "Recommended（推荐）", method: "MARGIN_ON_REVENUE", rate: 12 },
  { key: "target", labelZh: "Target（目标）", method: "MARGIN_ON_REVENUE", rate: 15 },
];

/* ----------------------------------- zod ----------------------------------- */

const num = (min?: number) => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.number().finite().min(min ?? -Infinity).nullable());

export const costLineSchema = z.object({
  id: z.string().optional(),
  sortOrder: z.number().int().default(0),
  category: z.string().min(1).max(40),
  subcategory: z.string().max(60).nullable().optional(),
  description: z.string().min(1).max(300),
  quantity: num(),
  unit: z.string().max(30).nullable().optional(),
  unitCost: num(),
  sourceCurrency: z.string().min(3).max(3).default("CAD"),
  fxRate: num(),
  fxRateSource: z.string().max(40).nullable().optional(),
  calculationType: z.enum(CALCULATION_TYPES).default("FIXED"),
  calculationBase: z.string().max(60).nullable().optional(),
  rate: num(),
  duration: num(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().max(120).nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  included: z.boolean().default(true),
});
export type CostLinePayload = z.infer<typeof costLineSchema>;

export const tierSchema = z.object({
  id: z.string().optional(),
  sortOrder: z.number().int().default(0),
  tierName: z.string().min(1).max(60),
  minQuantity: z.number().finite().min(0),
  maxQuantity: z.number().finite().min(0).nullable().optional(),
  expectedQuantity: z.number().finite().min(0),
  pricingMethod: z.enum(PRICING_METHODS).default("MARKUP_ON_COST"),
  rate: num(),
  active: z.boolean().default(true),
});
export type TierPayload = z.infer<typeof tierSchema>;

export const engineConfigSchema = z.object({
  scenarios: z.array(z.object({ key: z.string().min(1).max(30), labelZh: z.string().max(40), method: z.enum(PRICING_METHODS), rate: z.number().finite() })).max(6).optional(),
  tax: z.object({ gstPct: num(0).optional(), hstPct: num(0).optional(), pstPct: num(0).optional() }).optional(),
  standingOffer: z
    .object({
      supplierCostPerPiece: num(0),
      supplierCurrency: z.string().max(3).nullable().optional(),
      fxRate: num(0).optional(),
      piecesPerBox: num(0),
      boxesPerContainer: num(0),
      moq: num(0).optional(),
      annualQuantity: num(0).optional(),
      freightPerContainer: num(0).optional(),
      customsPerContainer: num(0).optional(),
      dutyPct: num(0).optional(),
      warehousePerContainer: num(0).optional(),
      otherPerContainer: num(0).optional(),
      inventoryCarryingPct: num(0).optional(),
    })
    .nullable()
    .optional(),
  marginRiskPct: z.object({ high: z.number().finite(), medium: z.number().finite() }).optional(),
});

export const quoteHeaderSchema = z.object({
  name: z.string().max(160).nullable().optional(),
  quoteNumber: z.string().max(60).nullable().optional(),
  currency: z.enum(QUOTE_CURRENCIES).optional(),
  pricingMethod: z.enum(PRICING_METHODS).optional(),
  pricingRate: num(),
  internalNotes: z.string().max(4000).nullable().optional(),
  engine: engineConfigSchema.optional(),
});

export type QuoteValidationError = { code: string; message: string; lineId?: string; tierId?: string };
