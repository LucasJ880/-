/**
 * S4-B：正式 Supplier Score 的四个组件（40 / 25 / 20 / 15）——**纯函数**。
 *
 * 唯一的加权实现是 score-contract.ts 的 computeSupplierScore()；本模块不复制权重、不手写
 * 「technical × 四成 + …」这类加权。这里只负责把**冻结的证据快照**折算成 0–100 的子分或 UNKNOWN(null)，
 * 并把原因码 / 证据摘要写进 breakdown（历史可回放）。
 *
 * 铁律（任务书 §16 / §17 / §61）：
 *   - 无 IO / 无 LLM / 无网络 / 无时钟 / 无随机；同输入必同输出。
 *   - 缺失数据必须伤害覆盖率：技术分分母 = 项目全部可计分技术项，UNKNOWN / 缺 Match 按 0 计入。
 *   - 平台挂牌价（1688 等）不能产生正式 Commercial Score；只有同项目、同一询价轮、同币种、
 *     ≥2 家已确认报价才可比。
 *   - 历史可靠性只用 Qyane 内部真实交互历史（<2 条 → null，不虚构 50 中性分）。
 *   - 进口准备度只接受 VERIFIED 出口能力证据；没有证据 → null（没证据 ≠ 已证明不会出口）。
 */

import type { ScoreReasonCode, PriceEvidenceTier } from "./constants";
import { NON_TECHNICAL_REQUIREMENT_CATEGORIES, SCORE_COMPONENT_RULE_VERSIONS, TECHNICAL_SCORABLE_CATEGORIES } from "./constants";
import { computeSupplierScore, type SupplierScoreBreakdown } from "./score-contract";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function clamp100(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

/* ───────────────── Technical Fit — 40 ───────────────── */

export const TECHNICAL_POINTS = { PASS: 100, PARTIAL: 50, FAIL: 0, UNKNOWN: 0, MISSING: 0 } as const;

export interface TechnicalRequirementInput {
  key: string;
  category: string | null;
  mandatory: true | false | "uncertain";
}
export interface TechnicalMatchInput {
  requirementKey: string;
  verdict: string;
  evaluatedBy: string;
}
export interface TechnicalItemBreakdown {
  key: string;
  category: string | null;
  verdict: string | "MISSING";
  evaluatedBy: string | null;
  points: number;
  reason: ScoreReasonCode | null;
}
export interface TechnicalBreakdown {
  rule: typeof SCORE_COMPONENT_RULE_VERSIONS.technical;
  score: number | null;
  /** 分母：项目全部可计分技术项 */
  scorableCount: number;
  items: TechnicalItemBreakdown[];
  /** 明确非技术项（不进分母） */
  excluded: Array<{ key: string; category: string | null }>;
  /** 词表外 category（不静默计分；显式列出） */
  unmapped: Array<{ key: string; category: string | null }>;
  reasonCodes: ScoreReasonCode[];
}

export function computeTechnicalFit(requirements: TechnicalRequirementInput[], matches: TechnicalMatchInput[]): TechnicalBreakdown {
  const byKey = new Map(matches.map((m) => [m.requirementKey, m]));
  const items: TechnicalItemBreakdown[] = [];
  const excluded: TechnicalBreakdown["excluded"] = [];
  const unmapped: TechnicalBreakdown["unmapped"] = [];
  const reasons = new Set<ScoreReasonCode>();
  for (const r of requirements) {
    const cat = (r.category ?? "").toLowerCase();
    if ((TECHNICAL_SCORABLE_CATEGORIES as readonly string[]).includes(cat)) {
      const m = byKey.get(r.key);
      if (!m) { items.push({ key: r.key, category: r.category, verdict: "MISSING", evaluatedBy: null, points: TECHNICAL_POINTS.MISSING, reason: null }); continue; }
      if (m.evaluatedBy === "AI_ASSISTED") {
        // AI 建议未经人工确认：不能成为正式 numeric score 的高分来源
        items.push({ key: r.key, category: r.category, verdict: m.verdict, evaluatedBy: m.evaluatedBy, points: 0, reason: "TECHNICAL_AI_ASSISTED_UNCONFIRMED" });
        reasons.add("TECHNICAL_AI_ASSISTED_UNCONFIRMED");
        continue;
      }
      const pts = m.verdict === "PASS" ? TECHNICAL_POINTS.PASS : m.verdict === "PARTIAL" ? TECHNICAL_POINTS.PARTIAL : 0;
      items.push({ key: r.key, category: r.category, verdict: m.verdict, evaluatedBy: m.evaluatedBy, points: pts, reason: null });
    } else if ((NON_TECHNICAL_REQUIREMENT_CATEGORIES as readonly string[]).includes(cat)) {
      excluded.push({ key: r.key, category: r.category });
    } else {
      unmapped.push({ key: r.key, category: r.category });
      reasons.add("UNMAPPED_REQUIREMENT_CATEGORY");
    }
  }
  let score: number | null = null;
  if (items.length === 0) reasons.add("TECHNICAL_NO_SCORABLE_REQUIREMENTS");
  else score = round2(items.reduce((a, it) => a + it.points, 0) / items.length);
  return { rule: SCORE_COMPONENT_RULE_VERSIONS.technical, score, scorableCount: items.length, items, excluded, unmapped, reasonCodes: [...reasons] };
}

/* ───────────────── Commercial — 25 ───────────────── */

export const COMMERCIAL_V1 = { price: 0.7, delivery: 0.2, completeness: 0.1 } as const;

export interface RfqRoundItemInput {
  itemId: string;
  supplierId: string;
  status: string;
  repliedAt: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string;
  deliveryDays: number | null;
  validUntil: string | null;
}
export interface RfqRoundInput {
  inquiryId: string;
  roundNumber: number;
  scope: string | null;
  items: RfqRoundItemInput[];
}
export interface CommercialBreakdown {
  rule: typeof SCORE_COMPONENT_RULE_VERSIONS.commercial;
  score: number | null;
  priceEvidenceTier: PriceEvidenceTier;
  round: { inquiryId: string; roundNumber: number; scope: string | null } | null;
  priceBasis: "totalPrice" | "unitPrice" | null;
  currency: string | null;
  candidate: { itemId: string; price: number | null; deliveryDays: number | null; validUntil: string | null } | null;
  comparableGroup: Array<{ supplierId: string; itemId: string; price: number; deliveryDays: number | null }>;
  sub: { price: number | null; delivery: number; completeness: number | null };
  reasonCodes: ScoreReasonCode[];
}

/** 已确认报价 = 有回复时间 + 价格 > 0（客户端不能声明；服务端从 InquiryItem 事实推导） */
export function isConfirmedQuote(it: RfqRoundItemInput): boolean {
  return it.repliedAt !== null && (((it.totalPrice ?? 0) > 0) || ((it.unitPrice ?? 0) > 0));
}

/**
 * FR1：候选自己的报价 = **显式绑定**的 InquiryItem（candidateItemId），不是「这家供应商在本轮的任意一条」。
 * 同一家供应商多款 Offering 时，一张 RFQ 不能被多个 Offering 各自消费。
 */
export function computeCommercialScore(input: { candidateSupplierId: string; candidateItemId: string | null; round: RfqRoundInput | null; priceEvidenceTier: PriceEvidenceTier }): CommercialBreakdown {
  const base = (over: Partial<CommercialBreakdown>, reasons: ScoreReasonCode[]): CommercialBreakdown => ({
    rule: SCORE_COMPONENT_RULE_VERSIONS.commercial, score: null, priceEvidenceTier: input.priceEvidenceTier, round: input.round ? { inquiryId: input.round.inquiryId, roundNumber: input.round.roundNumber, scope: input.round.scope } : null,
    priceBasis: null, currency: null, candidate: null, comparableGroup: [], sub: { price: null, delivery: 0, completeness: null }, reasonCodes: reasons, ...over,
  });
  if (!input.round) {
    const r: ScoreReasonCode[] = ["COMMERCIAL_NO_CONFIRMED_RFQ"];
    if (input.priceEvidenceTier === "PLATFORM_LISTED") r.push("COMMERCIAL_PLATFORM_LISTED_ONLY");
    return base({}, r);
  }
  const confirmed = input.round.items.filter(isConfirmedQuote);
  const mine = input.candidateItemId ? confirmed.find((it) => it.itemId === input.candidateItemId && it.supplierId === input.candidateSupplierId) : undefined;
  if (!mine) {
    const r: ScoreReasonCode[] = [input.candidateItemId ? "COMMERCIAL_BINDING_NOT_CONFIRMED" : "COMMERCIAL_NOT_BOUND_TO_OFFERING"];
    if (input.priceEvidenceTier === "PLATFORM_LISTED") r.push("COMMERCIAL_PLATFORM_LISTED_ONLY");
    return base({}, r);
  }
  if (confirmed.length < 2) return base({ candidate: { itemId: mine.itemId, price: mine.totalPrice ?? mine.unitPrice, deliveryDays: mine.deliveryDays, validUntil: mine.validUntil } }, ["COMMERCIAL_SINGLE_QUOTE"]);
  const currencies = new Set(confirmed.map((it) => it.currency));
  if (currencies.size > 1) return base({ candidate: { itemId: mine.itemId, price: mine.totalPrice ?? mine.unitPrice, deliveryDays: mine.deliveryDays, validUntil: mine.validUntil } }, ["COMMERCIAL_NOT_COMPARABLE_CURRENCY"]);
  // 价格口径：同一轮 ≥2 家都有 totalPrice → totalPrice；否则 ≥2 家都有 unitPrice → unitPrice；不混用
  const totalGroup = confirmed.filter((it) => (it.totalPrice ?? 0) > 0);
  const unitGroup = confirmed.filter((it) => (it.unitPrice ?? 0) > 0);
  let basis: "totalPrice" | "unitPrice" | null = null;
  let group: RfqRoundItemInput[] = [];
  if (totalGroup.length >= 2 && totalGroup.some((it) => it.itemId === mine.itemId)) { basis = "totalPrice"; group = totalGroup; }
  else if (unitGroup.length >= 2 && unitGroup.some((it) => it.itemId === mine.itemId)) { basis = "unitPrice"; group = unitGroup; }
  if (!basis) return base({ candidate: { itemId: mine.itemId, price: mine.totalPrice ?? mine.unitPrice, deliveryDays: mine.deliveryDays, validUntil: mine.validUntil } }, ["COMMERCIAL_NOT_COMPARABLE_PRICE_BASIS"]);
  const priceOf = (it: RfqRoundItemInput) => (basis === "totalPrice" ? (it.totalPrice as number) : (it.unitPrice as number));
  const myPrice = priceOf(mine);
  const minPrice = Math.min(...group.map(priceOf));
  const priceScore = round2(clamp100((minPrice / myPrice) * 100));
  const reasons: ScoreReasonCode[] = [];
  const withDelivery = group.filter((it) => (it.deliveryDays ?? 0) > 0);
  let delivery = 0;
  if (withDelivery.length >= 2 && (mine.deliveryDays ?? 0) > 0) {
    const minD = Math.min(...withDelivery.map((it) => it.deliveryDays as number));
    delivery = round2(clamp100((minD / (mine.deliveryDays as number)) * 100));
  } else reasons.push("DELIVERY_UNKNOWN");
  const completeness = round2((100 * ([true, (mine.deliveryDays ?? 0) > 0, Boolean(mine.validUntil)].filter(Boolean).length)) / 3);
  const score = round2(COMMERCIAL_V1.price * priceScore + COMMERCIAL_V1.delivery * delivery + COMMERCIAL_V1.completeness * completeness);
  return base({
    score, priceBasis: basis, currency: mine.currency,
    candidate: { itemId: mine.itemId, price: myPrice, deliveryDays: mine.deliveryDays, validUntil: mine.validUntil },
    comparableGroup: group.map((it) => ({ supplierId: it.supplierId, itemId: it.itemId, price: priceOf(it), deliveryDays: it.deliveryDays })),
    sub: { price: priceScore, delivery, completeness },
  }, reasons);
}

/* ───────────────── Reliability — 20 ───────────────── */

export const RELIABILITY_V1 = { responseRate: 0.7, priorSelection: 0.3, minHistory: 2 } as const;

export interface ReliabilityHistoryItem {
  itemId: string;
  projectId: string;
  status: string;
  sentAt: string | null;
  repliedAt: string | null;
  isSelected: boolean;
}
export interface ReliabilityBreakdown {
  rule: typeof SCORE_COMPONENT_RULE_VERSIONS.reliability;
  score: number | null;
  contacted: number;
  replied: number;
  selected: number;
  sub: { responseRate: number | null; priorSelection: number | null };
  /** 只记 id / 项目 / 状态，不复制别项目报价 */
  history: Array<{ itemId: string; projectId: string; status: string; replied: boolean; selected: boolean }>;
  reasonCodes: ScoreReasonCode[];
}

/** 真实发起过联系 = 已发送（或之后的任何状态）；pending 不算联系 */
export function isContacted(it: ReliabilityHistoryItem): boolean {
  return it.sentAt !== null || ["sent", "replied", "quoted", "declined", "no_response"].includes(it.status);
}
export function isReplied(it: ReliabilityHistoryItem): boolean {
  return it.repliedAt !== null || ["replied", "quoted"].includes(it.status);
}

export function computeReliabilityScore(input: { currentProjectId: string; history: ReliabilityHistoryItem[] }): ReliabilityBreakdown {
  // 排除当前项目：不能让当前 Tender 给自己制造「历史」
  const past = input.history.filter((it) => it.projectId !== input.currentProjectId && isContacted(it));
  const contacted = past.length;
  const replied = past.filter(isReplied).length;
  const selected = past.filter((it) => it.isSelected).length;
  const history = past.map((it) => ({ itemId: it.itemId, projectId: it.projectId, status: it.status, replied: isReplied(it), selected: it.isSelected }));
  if (contacted < RELIABILITY_V1.minHistory) {
    return { rule: SCORE_COMPONENT_RULE_VERSIONS.reliability, score: null, contacted, replied, selected, sub: { responseRate: null, priorSelection: null }, history, reasonCodes: ["RELIABILITY_HISTORY_INSUFFICIENT"] };
  }
  const responseRate = round2((replied / contacted) * 100);
  const priorSelection = selected >= 2 ? 100 : selected === 1 ? 50 : 0;
  const score = round2(RELIABILITY_V1.responseRate * responseRate + RELIABILITY_V1.priorSelection * priorSelection);
  return { rule: SCORE_COMPONENT_RULE_VERSIONS.reliability, score, contacted, replied, selected, sub: { responseRate, priorSelection }, history, reasonCodes: [] };
}

/* ───────────────── Import / Delivery Readiness — 15 ───────────────── */

export const IMPORT_RISK_V1 = { readiness: 0.5, packaging: 0.2, incoterm: 0.15, leadTime: 0.15 } as const;
export const RECOGNIZED_INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP", "DDU"] as const;

export interface CapabilityEvidenceInput {
  id: string;
  type: string;
  evidenceStatus: string;
  /** 出处线索（审计元数据；FR2：必须属于当前评估项目，由调用方按项目范围加载） */
  discoverySignalId?: string | null;
}
export interface ImportRiskBreakdown {
  rule: typeof SCORE_COMPONENT_RULE_VERSIONS.importRisk;
  score: number | null;
  /** 当时用的是哪条**当前项目**能力证据（只记 id / 类型 / 出处线索 id，不复制线索全文） */
  verified: Array<{ id: string; type: string; discoverySignalId: string | null; projectScope: "CURRENT_PROJECT" }>;
  /** 非 VERIFIED 的出口相关声明（只展示「待核实」，不计分） */
  unverified: Array<{ id: string; type: string; evidenceStatus: string; discoverySignalId: string | null }>;
  sub: { readiness: number | null; packaging: number; incoterm: number; leadTime: number };
  offering: { incoterm: string | null; leadTimeDays: number | null };
  reasonCodes: ScoreReasonCode[];
}

const EXPORT_TYPES = ["CANADA_EXPORT", "OVERSEAS_EXPORT", "EXPORT_PACKAGING"];

export function computeImportRiskScore(input: { capabilities: CapabilityEvidenceInput[]; offering: { incoterm: string | null; leadTimeDays: number | null } | null }): ImportRiskBreakdown {
  const exportRelated = input.capabilities.filter((c) => EXPORT_TYPES.includes(c.type));
  const verified = exportRelated.filter((c) => c.evidenceStatus === "VERIFIED").map((c) => ({ id: c.id, type: c.type, discoverySignalId: c.discoverySignalId ?? null, projectScope: "CURRENT_PROJECT" as const }));
  const unverified = exportRelated.filter((c) => c.evidenceStatus !== "VERIFIED").map((c) => ({ id: c.id, type: c.type, evidenceStatus: c.evidenceStatus, discoverySignalId: c.discoverySignalId ?? null }));
  const offering = { incoterm: input.offering?.incoterm ?? null, leadTimeDays: input.offering?.leadTimeDays ?? null };
  const hasCanada = verified.some((c) => c.type === "CANADA_EXPORT");
  const hasOverseas = verified.some((c) => c.type === "OVERSEAS_EXPORT");
  if (!hasCanada && !hasOverseas) {
    const reasons: ScoreReasonCode[] = ["EXPORT_READINESS_UNVERIFIED"];
    if (unverified.length > 0) reasons.push("EXPORT_CLAIMED_ONLY");
    return { rule: SCORE_COMPONENT_RULE_VERSIONS.importRisk, score: null, verified, unverified, sub: { readiness: null, packaging: 0, incoterm: 0, leadTime: 0 }, offering, reasonCodes: reasons };
  }
  const readiness = hasCanada ? 100 : 75;
  const packaging = verified.some((c) => c.type === "EXPORT_PACKAGING") ? 100 : 0;
  const incoterm = offering.incoterm && (RECOGNIZED_INCOTERMS as readonly string[]).includes(offering.incoterm.toUpperCase().trim()) ? 100 : 0;
  const leadTime = (offering.leadTimeDays ?? 0) > 0 ? 100 : 0;
  const score = round2(IMPORT_RISK_V1.readiness * readiness + IMPORT_RISK_V1.packaging * packaging + IMPORT_RISK_V1.incoterm * incoterm + IMPORT_RISK_V1.leadTime * leadTime);
  return { rule: SCORE_COMPONENT_RULE_VERSIONS.importRisk, score, verified, unverified, sub: { readiness, packaging, incoterm, leadTime }, offering, reasonCodes: [] };
}

/* ───────────────── 价格证据层（服务端推导） ───────────────── */

export function isOne688Url(url: string | null | undefined): boolean {
  if (!url) return false;
  try { const h = new URL(url).hostname.toLowerCase(); return h === "1688.com" || h.endsWith(".1688.com"); } catch { return false; }
}

export interface PriceEvidenceInput {
  /** 本项目内该供应商是否有已确认报价（同项目 RFQ；服务端事实） */
  rfqConfirmed: boolean;
  offering: { sourceKind: string | null; priceStatus: string | null; unitPrice: string | number | null; sourceUrl: string | null; sourceSignalPlatform: string | null } | null;
}

export function derivePriceEvidenceTier(input: PriceEvidenceInput): PriceEvidenceTier {
  if (input.rfqConfirmed) return "RFQ_CONFIRMED";
  const o = input.offering;
  if (!o) return "UNKNOWN";
  const hasPrice = o.unitPrice !== null && o.unitPrice !== undefined && Number(o.unitPrice) > 0;
  if (o.sourceKind === "INQUIRY" && o.priceStatus === "KNOWN" && hasPrice) return "INQUIRY_CONFIRMED";
  const platformListed = o.sourceSignalPlatform === "ONE688" || isOne688Url(o.sourceUrl);
  if (platformListed && hasPrice) return "PLATFORM_LISTED";
  if (o.sourceKind === "MANUAL" && o.priceStatus === "KNOWN" && hasPrice) return "HUMAN_ENTERED";
  if (o.priceStatus === "ESTIMATED" && hasPrice) return "ESTIMATED";
  return "UNKNOWN";
}

/* ───────────────── 官方总分：只调 computeSupplierScore ───────────────── */

export interface OfficialScoreOutcome {
  breakdown: SupplierScoreBreakdown;
  /** 只有四维齐全（knownWeightShare == 1）才有官方总分；否则 null（不拿归一化分冒充） */
  officialTotalScore: number | null;
}

export function buildOfficialScore(components: { technical: number | null; commercial: number | null; reliability: number | null; importRisk: number | null }): OfficialScoreOutcome {
  const breakdown = computeSupplierScore(components);
  const officialTotalScore = breakdown.knownWeightShare === 1 ? breakdown.totalScore : null;
  return { breakdown, officialTotalScore };
}
