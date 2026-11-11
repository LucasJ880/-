/**
 * TI-2 逐行投标成本 — 契约（类型与词表；纯定义，零 DB / 网络 / 模型）
 *
 * 金额一律定点（project-finance/money.ts）；汇率方向唯一：1 单位原币 = X 加元。
 * 成本分项与报价引擎的成本类别对齐（MATERIAL / DUTY / FREIGHT / LOGISTICS / CONTINGENCY），
 * 便于后续把核算结果写回报价引擎。
 */
import { Prisma } from "@prisma/client";
import type { DecimalInput } from "@/lib/project-finance/money";
import type { PriceScheduleLine } from "@/lib/tender-price-schedule/contract";
import type { QuoteBasis } from "@/lib/tender-price-schedule/unit-conversion";

export const SOURCING_TYPES = ["IMPORT", "DOMESTIC"] as const;
export type SourcingType = (typeof SOURCING_TYPES)[number];

/** 报价证据类别：已签报价 / 平台标价 / 零售价 / 估计——分开标，不混成一个「价格」。 */
export const QUOTE_EVIDENCE_KINDS = ["SIGNED_QUOTE", "PLATFORM_LISTED", "RETAIL_PRICE", "ESTIMATE"] as const;
export type QuoteEvidenceKind = (typeof QUOTE_EVIDENCE_KINDS)[number];
export const QUOTE_EVIDENCE_LABELS_ZH: Record<QuoteEvidenceKind, string> = {
  SIGNED_QUOTE: "已签报价",
  PLATFORM_LISTED: "平台标价",
  RETAIL_PRICE: "零售价",
  ESTIMATE: "估计",
};

/** 关税依据：带 HS 编码、原产地、来源引用、取数日期四项的才算已核实。 */
export const DUTY_BASES = ["VERIFIED", "SENSITIVITY"] as const;
export type DutyBasis = (typeof DUTY_BASES)[number];

export const FREIGHT_MODES = ["FCL", "LCL", "AIR", "LOCAL"] as const;
export type FreightMode = (typeof FREIGHT_MODES)[number];
export const FREIGHT_MODE_LABELS_ZH: Record<FreightMode, string> = { FCL: "整柜", LCL: "拼柜", AIR: "空运", LOCAL: "本地" };

export const ALLOCATION_METHODS = ["BY_VOLUME", "BY_WEIGHT", "BY_VALUE", "BY_QUANTITY"] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];
export const ALLOCATION_LABELS_ZH: Record<AllocationMethod, string> = {
  BY_VOLUME: "按体积", BY_WEIGHT: "按重量", BY_VALUE: "按货值", BY_QUANTITY: "按数量",
};

export const RESERVE_MODES = ["ON_SALE", "IN_COST"] as const;
export type ReserveMode = (typeof RESERVE_MODES)[number];

export type SupplierQuoteInput = {
  unitPrice: DecimalInput | null;
  basis: QuoteBasis;
  /** ISO 币种；CAD 不需要汇率 */
  currency: string;
  evidenceKind: QuoteEvidenceKind;
  sourceRef?: string | null;
  asOf?: string | null;
  /** 供应商起订量（件） */
  moqPieces?: number | null;
  /** 整包装倍数（每箱多少件）；采购件数向上取整到它的倍数 */
  cartonPieces?: number | null;
};

export type FxInput = { rateCadPerUnit: DecimalInput | null; source?: string | null; asOf?: string | null };

export type DutyInput = {
  ratePct: DecimalInput;
  hsCode?: string | null;
  origin?: string | null;
  sourceRef?: string | null;
  asOf?: string | null;
};

export type CostLineInput = {
  line: PriceScheduleLine;
  sourcing: SourcingType;
  quote: SupplierQuoteInput | null;
  /** 报价币种不是 CAD 时必填，且须带来源与日期 */
  fx?: FxInput | null;
  /** 仅进口行；本地行给了即拒绝 */
  duty?: DutyInput | null;
  /** 本行的进口 GST 是否可抵扣；缺省取情景级设置 */
  importGstItcEligible?: boolean | null;
  /** 直接记在本行的国际段运费（加元）；本地行给了即拒绝。整票费用走 freight 分摊 */
  internationalFreightCad?: DecimalInput | null;
  /** 境内运费（供应商到我方） */
  domesticFreightCad?: DecimalInput | null;
  /** 配送到各交付点 */
  localDeliveryCad?: DecimalInput | null;
  otherNonRecoverableCad?: DecimalInput | null;
  /** 分摊依据 */
  volumeCbm?: DecimalInput | null;
  weightKg?: DecimalInput | null;
};

export type FreightCharge = { label: string; amountCad: DecimalInput; allocation: AllocationMethod };
export type FreightPlan = { key: string; mode: FreightMode; charges: FreightCharge[]; sourceRef?: string | null; asOf?: string | null };
/** 一个情景只能选一个方案；两个及以上须声明混合并附说明。 */
export type FreightSelection = { plans: FreightPlan[]; blendNote?: string | null };

export type ReserveInput =
  | { key: string; label: string; mode: "ON_SALE"; ratePct: DecimalInput }
  | { key: string; label: string; mode: "IN_COST"; pctOfDirectCost: DecimalInput };

export type PricingInput =
  | { method: "MARGIN_ON_PRICE"; targetMarginPct: DecimalInput }
  | { method: "MARKUP_ON_COST"; markupPct: DecimalInput };

export type CostScenarioInput = {
  key: string;
  label: string;
  lines: CostLineInput[];
  importGst: { ratePct: DecimalInput; itcEligible: boolean };
  freight?: FreightSelection | null;
  reserves?: ReserveInput[];
  pricing: PricingInput;
};

export type LineBlockerCode =
  | "MISSING_QUOTE"
  | "MISSING_QUANTITY"
  | "MISSING_PACK_COUNT"
  | "MISSING_FX_RATE"
  | "MISSING_FX_SOURCE"
  | "MISSING_FX_DATE"
  | "MISSING_DUTY_RATE";
export type LineBlocker = { code: LineBlockerCode; messageZh: string };

export type RejectionCode =
  | "DOMESTIC_HAS_IMPORT_CHARGES"
  | "INVALID_PURCHASE_RULE"
  | "INVALID_RATE"
  | "MULTIPLE_FREIGHT_PLANS"
  | "ALLOCATION_BASIS_MISSING"
  | "RESERVE_DUPLICATED"
  | "PRICING_DENOMINATOR_NOT_POSITIVE"
  | "DUPLICATE_LINE";
export type Rejection = { ok: false; code: RejectionCode; lineNo: number | null; messageZh: string };

type D = Prisma.Decimal;

/** 逐行成本（未定价）。缺参数时 complete=false，全部金额为 null——不用默认值。 */
export type LineCost = {
  lineNo: number;
  description: string;
  uom: string;
  quantity: D | null;
  sourcing: SourcingType;
  evidenceKind: QuoteEvidenceKind | null;
  quoteUnitPrice: D | null;
  quoteCurrency: string | null;
  quoteBasis: QuoteBasis | null;
  requiredPieces: D | null;
  purchasePieces: D | null;
  excessPieces: D | null;
  dutyBasis: DutyBasis | null;
  dutyRatePct: D | null;
  complete: boolean;
  blockers: LineBlocker[];
  goodsCad: D | null;
  dutyCad: D | null;
  freightCad: D | null;
  localDeliveryCad: D | null;
  otherCad: D | null;
  nonRecoverableTaxCad: D | null;
  reserveInCostCad: D | null;
  directCostCad: D | null;
  unitCostCad: D | null;
  /** 进口 GST 现金流：始终单列；可抵扣时不进成本 */
  importGstCashCad: D | null;
};

export type PricedLine = LineCost & {
  unitBidCad: D | null;
  extendedBidCad: D | null;
  /** 行合计 ×（1 − 按售价预备金率）− 直接成本 */
  profitCad: D | null;
  /** （价 − 成本）÷ 价 */
  grossMarginPct: D | null;
  /** （价 − 成本）÷ 成本 */
  markupPct: D | null;
};

export type ScenarioTotals = {
  goodsCad: D; dutyCad: D; freightCad: D; localDeliveryCad: D; otherCad: D; nonRecoverableTaxCad: D; reserveInCostCad: D;
  directCostCad: D;
  bidExclHstCad: D;
  reserveOnSaleCad: D;
  profitCad: D;
  importGstCashCad: D;
  grossMarginPct: D | null;
  markupPct: D | null;
  netMarginPct: D | null;
};

export type AssumptionEntry = { item: string; value: string; basisKind: string; sourceRef: string | null; asOf: string | null };

export type ScenarioResult = {
  ok: true;
  key: string;
  label: string;
  lines: PricedLine[];
  totals: ScenarioTotals;
  flags: { incomplete: boolean; hasSensitivityDuty: boolean; hasIndicativePrice: boolean };
  meta: {
    pricingMethod: PricingInput["method"];
    pricingRatePct: D;
    reserveOnSaleRatePct: D;
    reserveModes: Array<{ key: string; label: string; mode: ReserveMode }>;
    freightModes: FreightMode[];
    freightBlendNote: string | null;
  };
  assumptions: AssumptionEntry[];
  notices: string[];
};
