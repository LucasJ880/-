/**
 * Revenue Spine — 企业业务配置 / 评分策略 / SLA 与跟进策略（PART 11 / 14 / 16）
 *
 * 规则不写死在 Agent prompt：默认值在此，企业级覆盖存 OrgBusinessRule
 *   ruleKey = "revenue_spine.business_profile" | "revenue_spine.policy"（versioned configJson）。
 * 其它 OEM 企业复用同一结构，只换配置。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { isValidTimeZone } from "@/lib/automation/local-time";
import { parseClockMinutes, type BusinessCalendar } from "./business-days";

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
  /**
   * 明确不做的类目（如 bedding / slipper）。询盘只命中这些类目、没有提到任何在做的类目时：
   * productFit = 0，按 excludedCategoryAction 处理。默认 [] = V1 行为（不在范围只扣一半分）。
   */
  excludedCategories: string[];
  /** review = 不自动起草，留给人工判断婉拒或转介（默认）；decline = 直接判为不合格 */
  excludedCategoryAction: "review" | "decline";
  /** 产品识别关键词 → 类目（小写，含中英文） */
  productKeywords: Record<string, string>;
  minimumMargin: number | null;
  defaultCurrency: string;
  defaultIncoterm: string;
  supportedIncoterms: string[];
  samplePolicy: { available: boolean | null; note: string };
  /**
   * 企业确认过、可以写进给买家邮件的商务事实。全部为空 = 草稿仍一律写"需内部确认"（V1 行为）。
   * 只放销售/老板确认过的参考值；价格永远不进这里。
   */
  commercialFacts: CommercialFacts;
}

/** 已获准对外引用的在市参考项目（只放匿名或已获买家书面同意的；内部级别不要配置） */
export interface ReferenceProgram {
  /** 对应 productCategories 里的类目 key；null = 不按类目匹配（不会自动出现在草稿里） */
  category: string | null;
  /** 一句话，不含买家名称以外的承诺；disclosure = anonymized 时不得出现买家名 */
  summaryEn: string;
  summaryZh: string;
  disclosure: "anonymized" | "named";
}

export interface CommercialFacts {
  /** 参考起订量（例：1000 pcs / style），草稿写"参考值，按项目确认" */
  moq: { quantity: number; unit: string; per: string } | null;
  /** 样品时效：现货样寄出天数 / 定制样天数区间 */
  sampleLeadTime: { stockDays: number | null; customDaysMin: number | null; customDaysMax: number | null } | null;
  /** 大货周期区间与起算点（例：35–45 天，自确认大货样起） */
  productionLeadTime: { daysMin: number; daysMax: number; startsFrom: string } | null;
  /** 装运港（只作事实列出，不构成报价条款） */
  loadingPorts: string[];
  /** 落款附加行（职位 / WhatsApp / 网站）；姓名仍取发件人 */
  signature: { title: string | null; whatsapp: string | null; website: string | null } | null;
  /** 不得写进给买家邮件的款号（即使出现在展会卡或参考表里） */
  blockedStyleCodes: string[];
  referencePrograms: ReferenceProgram[];
  /** 展会 C 级：只发目录、不追问、不进无回复跟进 */
  gradeCCatalogOnly: boolean;
  /** 目录链接（gradeCCatalogOnly 时写进草稿；为空则写"目录随后发送"） */
  catalogUrl: string | null;
  /**
   * 给海外买家看的英文公司名（如 "Example Home Textile"）。英文草稿的主题、正文、落款用它；
   * 为空时用组织名。组织名常是中文，直接写进英文邮件会让买家困惑。
   */
  buyerFacingName: string | null;
}

export const EMPTY_COMMERCIAL_FACTS: CommercialFacts = {
  moq: null,
  sampleLeadTime: null,
  productionLeadTime: null,
  loadingPorts: [],
  signature: null,
  blockedStyleCodes: [],
  referencePrograms: [],
  gradeCCatalogOnly: false,
  catalogUrl: null,
  buyerFacingName: null,
};

export interface SalesSlaPolicy {
  /** 新询盘人工处理时限（工作小时） */
  newInquiryResponseHours: number;
  /** 客户来信后回复时限（工作小时） */
  customerReplyResponseHours: number;
  // 首响分级提醒（sla-tiers.ts）。三档任一非 null = 本组织启用分级提醒，Revenue Spine 新询盘的提醒改由分级接管；
  // 全部 null（默认）= 沿用 inquiry-sla 旧提醒（5 分钟提醒外贸成员、24 小时升级管理员），行为不变。
  // 分钟数按 businessHours 计（设了工作时间时），否则按自然时间。只提醒，不给买家自动发任何邮件。
  /** 新询盘 T+N 分钟仍未回复 → 提醒负责人（站内 + 微信） */
  unclaimedAlertMinutes: number | null;
  /** T+N 分钟仍未回复 → 升级管理层（站内 + 微信） */
  ownerEscalationMinutes: number | null;
  /** T+N 小时仍未回复 → 告诉管理层是否有草稿在审批中心等待（或没有草稿的原因） */
  overdueDraftHours: number | null;
  /**
   * 工作时间（组织当地时区）。null（默认）= V1 口径：SLA 到期按 UTC 周一至周五全天计时，分级提醒按自然时间。
   * 设置后只影响之后新算出的到期时间（新询盘的 SalesAction.dueAt、回复类下一步），已落库的行动不重算。
   */
  businessHours: BusinessCalendar | null;
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
  /**
   * 首封回复后买家一直没回信：在第几天（从首封算起）自动起草跟进邮件进审批；空数组 = 不起草。
   * 只起草、不发送；买家回信、商机进入报价或之后的阶段即停止。
   */
  noReplyFollowUpDays: number[];
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

/** 微信提醒开关（按组织）；默认全部关闭，老板显式打开才推 */
export interface NotifyPolicy {
  /** FDE 生成新的询盘回复草稿时，微信提醒审批人（每人每小时最多一条，只给链接，不含买家邮箱/电话） */
  wechatOnNewDraft: boolean;
}

/**
 * 内部自治开关（B-5，按组织）；默认全部关闭。只自动做内部动作（阶段流转 + 站内通知），外发一律仍走审批。
 * dogfood 经 scripts/seed-revenue-autonomy.ts 按组织开启，不改默认值。
 */
export interface AutonomyPolicy {
  /** 开放商机超过 followUp.staleAfterDays 无互动、买家未来信、无在途审批 → revenue-spine 定时任务自动转 stale 并通知负责人 */
  autoStale: boolean;
}

export interface RevenueSpinePolicy {
  version: string;
  businessProfile: BusinessProfile;
  salesSla: SalesSlaPolicy;
  followUp: FollowUpPolicy;
  scoring: ScoringPolicy;
  notify: NotifyPolicy;
  autonomy: AutonomyPolicy;
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
  excludedCategories: [],
  excludedCategoryAction: "review",
  productKeywords: DEFAULT_PRODUCT_KEYWORDS,
  minimumMargin: null,
  defaultCurrency: "USD",
  defaultIncoterm: "FOB",
  supportedIncoterms: ["EXW", "FOB", "CIF", "CFR", "DDP", "DAP"],
  samplePolicy: { available: null, note: "" },
  commercialFacts: EMPTY_COMMERCIAL_FACTS,
};

export const DEFAULT_REVENUE_SPINE_POLICY: RevenueSpinePolicy = {
  version: REVENUE_SPINE_POLICY_VERSION,
  businessProfile: DEFAULT_BUSINESS_PROFILE,
  salesSla: {
    newInquiryResponseHours: 4,
    customerReplyResponseHours: 8,
    unclaimedAlertMinutes: null,
    ownerEscalationMinutes: null,
    overdueDraftHours: null,
    businessHours: null,
  },
  followUp: {
    afterReplyNoResponseBusinessDays: 3,
    quoteFollowUpDays: [3, 7, 14],
    sampleDeliveredFollowUpBusinessDays: 1,
    negotiationFollowUpBusinessDays: 2,
    staleAfterDays: 21,
    nurtureCheckInDays: 30,
    maxQuestionsPerReply: 4,
    reorderWindowDays: 180,
    noReplyFollowUpDays: [3, 7, 14],
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
  notify: { wechatOnNewDraft: false },
  autonomy: { autoStale: false },
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

/** 固定键的数字表（权重 / 档位）：逐键取覆盖值，形状不对的键保留 base */
function nums<T extends Record<string, number>>(o: Rec, base: T): T {
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, num(o[k], v)])) as T;
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

function posIntOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

function strOrNull(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/** 分级提醒的分钟 / 小时上限：7 天（再长就不是"首响"提醒了） */
const SLA_TIER_MAX_MINUTES = 7 * 24 * 60;
const SLA_TIER_MAX_HOURS = 7 * 24;
const DEFAULT_BUSINESS_WORKDAYS = [1, 2, 3, 4, 5];

/**
 * 工作时间校验：timezone 必须是合法 IANA 时区；start / end 为 "HH:MM"（end 可为 "24:00"，须晚于 start，
 * 缺省 09:00 / 18:00）；workdays 为 ISO 1..7（缺省周一至周五）。
 * 返回 null = 显式关闭；undefined = 形状不对（调用方保留原值）。
 */
export function parseBusinessCalendar(v: unknown): BusinessCalendar | null | undefined {
  if (v === null) return null;
  const o = rec(v);
  if (!o) return undefined;
  const timezone = typeof o.timezone === "string" ? o.timezone.trim() : "";
  if (!isValidTimeZone(timezone)) return undefined;
  const start = o.start === undefined ? "09:00" : typeof o.start === "string" ? o.start.trim() : "";
  const end = o.end === undefined ? "18:00" : typeof o.end === "string" ? o.end.trim() : "";
  const startMin = parseClockMinutes(start);
  const endMin = parseClockMinutes(end, true);
  if (startMin === null || endMin === null || endMin <= startMin) return undefined;
  let workdays = DEFAULT_BUSINESS_WORKDAYS;
  if (o.workdays !== undefined) {
    if (!Array.isArray(o.workdays)) return undefined;
    workdays = [...new Set(o.workdays.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
    if (!workdays.length) return undefined;
  }
  return { timezone, start, end, workdays: [...workdays] };
}

/** 分级提醒档位：显式 null = 关闭；正数（不超过上限）= 启用；其它形状 = 保留原值 */
function slaTierValue(o: Rec, key: string, base: number | null, opts: { max: number; integer: boolean }): number | null {
  if (!(key in o)) return base;
  const v = o[key];
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return base;
  const n = opts.integer ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100;
  return n > 0 && n <= opts.max ? n : base;
}

/** 本组织是否启用了首响分级提醒（任一档非 null） */
export function slaTiersEnabled(sla: Partial<SalesSlaPolicy> | null | undefined): boolean {
  return !!sla && (sla.unclaimedAlertMinutes != null || sla.ownerEscalationMinutes != null || sla.overdueDraftHours != null);
}

/** 款号归一（去空白、各种横线 / 下划线统一为 -、大写）：禁用款号合并时与草稿过滤时同一规则 */
export const normalizeStyleCode = (v: string) => v.replace(/\s+/g, "").replace(/[–—_]/g, "-").toUpperCase();

/** 商务事实合并：字段级覆盖；显式 null 清空；形状不对的字段忽略（保留 base） */
export function mergeCommercialFacts(base: CommercialFacts, override: unknown): CommercialFacts {
  const o = rec(override);
  if (!o) return base;
  const out: CommercialFacts = { ...base };
  if ("moq" in o) {
    const m = rec(o.moq);
    const quantity = m ? posIntOrNull(m.quantity) : null;
    out.moq = m && quantity ? { quantity, unit: strOrNull(m.unit, 20) ?? "pcs", per: strOrNull(m.per, 40) ?? "style" } : null;
  }
  if ("sampleLeadTime" in o) {
    const s = rec(o.sampleLeadTime);
    const v = s
      ? { stockDays: posIntOrNull(s.stockDays), customDaysMin: posIntOrNull(s.customDaysMin), customDaysMax: posIntOrNull(s.customDaysMax) }
      : null;
    out.sampleLeadTime = v && (v.stockDays || v.customDaysMin) ? v : null;
  }
  if ("productionLeadTime" in o) {
    const p = rec(o.productionLeadTime);
    const daysMin = p ? posIntOrNull(p.daysMin) : null;
    const daysMax = p ? posIntOrNull(p.daysMax) ?? daysMin : null;
    out.productionLeadTime =
      p && daysMin && daysMax && daysMax >= daysMin
        ? { daysMin, daysMax, startsFrom: strOrNull(p.startsFrom, 120) ?? "pre-production sample approval" }
        : null;
  }
  if ("loadingPorts" in o) out.loadingPorts = strList(o.loadingPorts, []).slice(0, 10);
  if ("signature" in o) {
    const s = rec(o.signature);
    const v = s ? { title: strOrNull(s.title, 80), whatsapp: strOrNull(s.whatsapp, 40), website: strOrNull(s.website, 120) } : null;
    out.signature = v && (v.title || v.whatsapp || v.website) ? v : null;
  }
  if ("blockedStyleCodes" in o) out.blockedStyleCodes = [...new Set(strList(o.blockedStyleCodes, []).map(normalizeStyleCode))].slice(0, 500);
  if ("referencePrograms" in o) {
    const list = Array.isArray(o.referencePrograms) ? o.referencePrograms : [];
    out.referencePrograms = list
      .map((x) => rec(x))
      .filter((x): x is Rec => !!x)
      .map((x) => ({
        category: strOrNull(x.category, 40),
        summaryEn: strOrNull(x.summaryEn, 300) ?? "",
        summaryZh: strOrNull(x.summaryZh, 300) ?? "",
        disclosure: x.disclosure === "named" ? ("named" as const) : x.disclosure === "anonymized" ? ("anonymized" as const) : null,
      }))
      // 内部级别（或未声明披露级别）的参考项目一律丢弃：宁可不写，不可外泄
      .filter((x): x is ReferenceProgram => x.disclosure !== null && !!x.summaryEn && !!x.summaryZh)
      .slice(0, 20);
  }
  if ("gradeCCatalogOnly" in o) out.gradeCCatalogOnly = o.gradeCCatalogOnly === true;
  if ("buyerFacingName" in o) out.buyerFacingName = strOrNull(o.buyerFacingName, 120);
  if ("catalogUrl" in o) {
    const u = strOrNull(o.catalogUrl, 300);
    out.catalogUrl = u && /^https:\/\//.test(u) ? u : null;
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
    excludedCategories: strList(o.excludedCategories, base.excludedCategories),
    excludedCategoryAction: o.excludedCategoryAction === "decline" || o.excludedCategoryAction === "review" ? o.excludedCategoryAction : base.excludedCategoryAction,
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
    commercialFacts: mergeCommercialFacts(base.commercialFacts, o.commercialFacts),
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
  const nt = rec(o.notify) ?? {};
  const au = rec(o.autonomy) ?? {};
  const businessHours = "businessHours" in sla ? parseBusinessCalendar(sla.businessHours) : undefined;
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
      // 以下字段必须在这里逐个列出：不在白名单里的字段会在合并时被丢掉。存量策略没有这些键 → 保持 null（旧行为）
      unclaimedAlertMinutes: slaTierValue(sla, "unclaimedAlertMinutes", base.salesSla.unclaimedAlertMinutes, { max: SLA_TIER_MAX_MINUTES, integer: true }),
      ownerEscalationMinutes: slaTierValue(sla, "ownerEscalationMinutes", base.salesSla.ownerEscalationMinutes, { max: SLA_TIER_MAX_MINUTES, integer: true }),
      overdueDraftHours: slaTierValue(sla, "overdueDraftHours", base.salesSla.overdueDraftHours, { max: SLA_TIER_MAX_HOURS, integer: false }),
      // 键不在 / 形状不对 → 保留 base；显式 null → 关闭
      businessHours: businessHours === undefined ? base.salesSla.businessHours : businessHours,
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
      // 显式写 [] 表示关闭；递增排序、去重，最多 5 次
      noReplyFollowUpDays: Array.isArray(fu.noReplyFollowUpDays)
        ? [...new Set(numList(fu.noReplyFollowUpDays, []).map((d) => Math.round(d)))].sort((a, b) => a - b).slice(0, 5)
        : base.followUp.noReplyFollowUpDays,
    },
    scoring: {
      weights: nums(w, base.scoring.weights),
      grades: nums(g, base.scoring.grades),
      buyerTypeScores: numMap(sc.buyerTypeScores, base.scoring.buyerTypeScores),
      quantityTiers: tiers,
      unknownQuantityRatio: num(sc.unknownQuantityRatio, base.scoring.unknownQuantityRatio),
      strategicMarkets: strList(sc.strategicMarkets, base.scoring.strategicMarkets),
      largeOrderQuantity: num(sc.largeOrderQuantity, base.scoring.largeOrderQuantity),
      individualMinQuantity: num(sc.individualMinQuantity, base.scoring.individualMinQuantity),
    },
    notify: {
      // 只认布尔值；存量策略没有 notify 时保持关闭
      wechatOnNewDraft: typeof nt.wechatOnNewDraft === "boolean" ? nt.wechatOnNewDraft : (base.notify?.wechatOnNewDraft ?? false),
    },
    autonomy: {
      // 只认布尔值；存量策略没有 autonomy 时保持关闭
      autoStale: typeof au.autoStale === "boolean" ? au.autoStale : (base.autonomy?.autoStale ?? false),
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
