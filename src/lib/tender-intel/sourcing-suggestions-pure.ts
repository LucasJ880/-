/**
 * CHAIN-2 — 寻源建议的组装与文案（纯函数，零 DB / 零 LLM）
 *
 * 推荐型号：只取已完成评估算出的排名里首选 / 备选（强制项通过）的前 3 个；没有就照实说原因。
 * 价格对照：可比授标 / 市场价格基准 / 我方落地价三栏并排、各写各的口径，缺哪栏写明缺；
 * 三栏不合并、不换汇、不推导「建议报价」（硬纪律第 4、7 条）。
 */

import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";
import { gstNoteZh, quantityBasisZh, type CompareCostSuggestion } from "@/lib/tender-pricing/compare-cost-source";

export const SOURCING_PRICE_NOTE_ZH = "三种价格口径不同，不合并成一个数；报价由人定。";
export const SOURCING_MAX_RECOMMENDATIONS = 3;
export const SOURCING_MAX_MARKET_ITEMS = 5;
export const SOURCING_MIN_AWARD_SAMPLES = 3;

export function supplyChainHref(projectId: string): string {
  return `/projects/intelligence/supply-chain?projectId=${encodeURIComponent(projectId)}`;
}

/* ---------------------------------- 推荐型号 ---------------------------------- */

export type ScoreSet = { technical: number | null; commercial: number | null; reliability: number | null; importRisk: number | null; total: number | null };

/** 排名里的一行（取自供应商情报的推荐排名）+ 这个候选的强制项条目 */
export type RankedCandidateInput = {
  candidateId: string;
  supplierId: string;
  supplierName: string;
  offeringName: string | null;
  offeringSku: string | null;
  section: string;
  rank: number | null;
  mandatoryGateResult: string;
  scores: ScoreSet;
  gateItems: Array<{ requirementKey: string; gateVerdict: string; evidenceAdmissible: boolean }>;
};

export type SourcingRecommendationItem = {
  candidateId: string;
  supplierName: string;
  offeringName: string | null;
  offeringSku: string | null;
  section: "PRIMARY" | "BACKUP";
  rank: number | null;
  scores: ScoreSet;
  /** 强制项一句话：全部通过（几条、证据是否都可采信）/ 没有强制项 */
  mandatoryZh: string;
};

type RecommendationLink = { href: string | null; hrefLabelZh: string | null; poolNoteZh: string | null };
export type SourcingRecommendations =
  | ({ status: "ready"; items: SourcingRecommendationItem[] } & RecommendationLink)
  | ({ status: "not_evaluated" | "none_passed" | "not_ranked" | "intel_off" | "unavailable"; messageZh: string } & RecommendationLink);

export const RECOMMENDATION_TEXT = {
  intelOff: "供应商情报没有开启，暂时没有推荐型号。",
  unavailable: "推荐型号暂时读不出来，请稍后刷新。",
  notApproved: "招标分析还没有批准。批准后系统会从内部供应商库建候选池；候选在供应链页评估完，这里会列出推荐。",
  notEvaluated: "还没有评估过的候选。请到供应链页逐个评估候选（逐条判定要求），评估完这里会列出推荐。",
} as const;

/** 自动建的候选池那一句；没有自动建过 = null */
export function poolNoteZh(autoPoolCount: number | null): string | null {
  if (autoPoolCount === null) return null;
  return autoPoolCount > 0
    ? `系统已在批准分析后从内部供应商库建了候选池（${autoPoolCount} 家，未筛选，还要逐个评估）。`
    : "系统已在批准分析后查过内部供应商库，没有找到可放进候选池的供应商。";
}

function mandatoryZh(items: RankedCandidateInput["gateItems"]): string {
  if (items.length === 0) return "没有强制项";
  const withEvidence = items.filter((g) => g.gateVerdict === "PASS" && g.evidenceAdmissible).length;
  return withEvidence === items.length
    ? `强制项全部通过（${items.length} 条都有可采信的证据）`
    : `强制项全部通过（${items.length} 条里 ${withEvidence} 条有可采信的证据）`;
}

/** 卡住最多的强制项（不满足 / 资料不足分开数；同样多时按编号排），最多 3 个 */
function blockedZh(ranked: readonly RankedCandidateInput[]): string {
  const tally = new Map<string, { fail: number; unknown: number }>();
  for (const r of ranked) {
    for (const g of r.gateItems) {
      if (g.gateVerdict === "PASS") continue;
      const t = tally.get(g.requirementKey) ?? { fail: 0, unknown: 0 };
      if (g.gateVerdict === "FAIL") t.fail++;
      else t.unknown++;
      tally.set(g.requirementKey, t);
    }
  }
  const top = [...tally.entries()]
    .sort((a, b) => b[1].fail + b[1].unknown - (a[1].fail + a[1].unknown) || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k, t]) => `${k}（${[t.fail ? `不满足 ${t.fail} 个` : "", t.unknown ? `资料不足 ${t.unknown} 个` : ""].filter(Boolean).join("、")}）`);
  return top.length ? `卡得最多的强制项：${top.join("、")}。` : "";
}

export function buildRecommendations(input: {
  projectId: string;
  intelEnabled: boolean;
  /** 项目当前有效的那份招标分析是否已批准 */
  analysisApproved: boolean;
  /** null = 取数出错 */
  ranked: RankedCandidateInput[] | null;
  /** 系统为当前这份分析自动建的候选池里的家数；没有自动建过 = null */
  autoPoolCount: number | null;
}): SourcingRecommendations {
  const href = supplyChainHref(input.projectId);
  if (!input.intelEnabled) return { status: "intel_off", messageZh: RECOMMENDATION_TEXT.intelOff, href: null, hrefLabelZh: null, poolNoteZh: null };
  const pool = poolNoteZh(input.autoPoolCount);
  if (!input.ranked) return { status: "unavailable", messageZh: RECOMMENDATION_TEXT.unavailable, href, hrefLabelZh: "去供应链页 →", poolNoteZh: pool };
  const eligible = input.ranked
    .filter((r) => (r.section === "PRIMARY" || r.section === "BACKUP") && r.mandatoryGateResult === "PASS")
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  if (eligible.length > 0) {
    return {
      status: "ready",
      href,
      hrefLabelZh: "查看完整排名 →",
      poolNoteZh: pool,
      items: eligible.slice(0, SOURCING_MAX_RECOMMENDATIONS).map((r) => ({
        candidateId: r.candidateId,
        supplierName: r.supplierName,
        offeringName: r.offeringName,
        offeringSku: r.offeringSku,
        section: r.section as "PRIMARY" | "BACKUP",
        rank: r.rank,
        scores: r.scores,
        mandatoryZh: mandatoryZh(r.gateItems),
      })),
    };
  }
  if (input.ranked.length === 0) {
    return input.analysisApproved
      ? { status: "not_evaluated", messageZh: RECOMMENDATION_TEXT.notEvaluated, href, hrefLabelZh: "去供应链页评估 →", poolNoteZh: pool }
      : { status: "not_evaluated", messageZh: RECOMMENDATION_TEXT.notApproved, href: null, hrefLabelZh: null, poolNoteZh: pool };
  }
  const gatePassed = input.ranked.filter((r) => r.mandatoryGateResult === "PASS").length;
  const n = input.ranked.length;
  if (gatePassed === 0) {
    return { status: "none_passed", messageZh: `评估过 ${n} 个候选，都没有通过强制项。${blockedZh(input.ranked)}`, href, hrefLabelZh: "去供应链页查看 →", poolNoteZh: pool };
  }
  // 有通过强制项的，但都还待核实、风险高或分数不全——不算「没通过」，照实分开说
  const notPassed = n - gatePassed;
  return {
    status: "not_ranked",
    messageZh: `评估过 ${n} 个候选，暂时没有可推荐的：${gatePassed} 个通过了强制项，但还待核实、风险高或分数不全${notPassed ? `；${notPassed} 个没有通过强制项` : ""}。`,
    href,
    hrefLabelZh: "去供应链页查看 →",
    poolNoteZh: pool,
  };
}

/* ---------------------------------- 价格对照 ---------------------------------- */

export type AwardGroupInput = { buyerName: string; comparableScopeKey: string; currency: string; sampleSize: number; min: number; max: number; median: number; from: string | null; to: string | null };
export type AwardColumn =
  | { status: "ok"; groups: Array<{ scope: string; currency: string; sampleSize: number; min: number; median: number; max: number; from: string | null; to: string | null }> }
  | { status: "missing"; messageZh: string };

export const AWARD_TEXT = {
  notConnected: "授标记录还没有接通。",
  unavailable: "授标记录暂时读不出来，请稍后刷新。",
  noBuyer: "项目没有采购方名称，没法比对。",
  tooFew: "同一采购方、同口径、同币种的授标（不含我方结果）不足 3 个，不做区间。",
} as const;

/** awards：null = 取数出错 */
export function buildAwardColumn(input: { schemaReady: boolean; projectBuyer: string | null; groups: AwardGroupInput[] | null }): AwardColumn {
  if (!input.schemaReady) return { status: "missing", messageZh: AWARD_TEXT.notConnected };
  if (!input.groups) return { status: "missing", messageZh: AWARD_TEXT.unavailable };
  const buyer = (input.projectBuyer ?? "").trim();
  if (!buyer) return { status: "missing", messageZh: AWARD_TEXT.noBuyer };
  const want = normalizeBuyerName(buyer);
  const groups = input.groups
    // 没写币种的金额不知道是什么钱，不进区间
    .filter((g) => g.sampleSize >= SOURCING_MIN_AWARD_SAMPLES && g.currency !== "UNSPECIFIED" && normalizeBuyerName(g.buyerName) === want)
    .map((g) => ({ scope: g.comparableScopeKey, currency: g.currency, sampleSize: g.sampleSize, min: g.min, median: g.median, max: g.max, from: g.from, to: g.to }));
  return groups.length ? { status: "ok", groups } : { status: "missing", messageZh: AWARD_TEXT.tooFew };
}

export type MarketColumn =
  | { status: "ok"; items: Array<{ productName: string; vendor: string | null; priceRaw: string; currency: string | null; unit: string | null }>; fxNoteZh: string }
  | { status: "missing"; messageZh: string };

export const MARKET_TEXT = {
  neverRan: "还没有做过外部情报检索（可在情报室发起）。",
  notConnected: "市场价格基准还没有接通。",
  noProduct: "分析里没有可检索的产品名称。",
  noneFound: "已查询，没有找到可比的市场价格。",
  unavailable: "市场价格基准暂时读不出来，请稍后刷新。",
  fxFallback: "基准价按来源原币呈现，未做汇率换算。",
} as const;

/** 只读外部情报已存的 summaryJson.marketPricing（不重新检索、不调模型） */
export function buildMarketColumn(marketPricing: unknown, readError = false): MarketColumn {
  if (readError) return { status: "missing", messageZh: MARKET_TEXT.unavailable };
  if (!marketPricing || typeof marketPricing !== "object") return { status: "missing", messageZh: MARKET_TEXT.neverRan };
  const m = marketPricing as { status?: unknown; benchmarks?: unknown; fxNoteZh?: unknown };
  if (m.status === "unavailable") return { status: "missing", messageZh: MARKET_TEXT.notConnected };
  if (m.status === "no_product") return { status: "missing", messageZh: MARKET_TEXT.noProduct };
  if (m.status !== "ran") return { status: "missing", messageZh: MARKET_TEXT.neverRan };
  const list = Array.isArray(m.benchmarks) ? m.benchmarks : [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const items = list
    .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>) : null))
    .filter((b): b is Record<string, unknown> => !!b && !!str(b.productName) && !!str(b.priceRaw))
    .slice(0, SOURCING_MAX_MARKET_ITEMS)
    .map((b) => ({ productName: str(b.productName) as string, vendor: str(b.vendor), priceRaw: str(b.priceRaw) as string, currency: str(b.currency), unit: str(b.unit) }));
  if (!items.length) return { status: "missing", messageZh: MARKET_TEXT.noneFound };
  return { status: "ok", items, fxNoteZh: str(m.fxNoteZh) ?? MARKET_TEXT.fxFallback };
}

export type LandedColumn =
  | { status: "ok"; supplierName: string; roundNumber: number; landedCadTotal: number; basisZh: string; taxNoteZh: string; warnings: string[] }
  | { status: "missing"; messageZh: string };

export const LANDED_TEXT = {
  notConnected: "我方落地价还没有接通。",
  noneSelected: "比价矩阵里还没有选定报价。",
  unconvertible: "选定的报价换算不了落地价。",
  unavailable: "我方落地价暂时读不出来，请稍后刷新。",
} as const;

/** 比价矩阵选定那家的落地价；sourceEnabled = 比价矩阵作为成本来源的开关（与报价表助手同一个） */
export function buildLandedColumn(s: CompareCostSuggestion | null, sourceEnabled = true): LandedColumn {
  if (!sourceEnabled) return { status: "missing", messageZh: LANDED_TEXT.notConnected };
  if (s?.status === "ok") {
    return {
      status: "ok",
      supplierName: s.supplierName,
      roundNumber: s.roundNumber,
      landedCadTotal: s.landedCadTotal,
      basisZh: quantityBasisZh(s.quantityBasis),
      taxNoteZh: gstNoteZh(s.breakdown),
      warnings: s.warnings.slice(0, 3),
    };
  }
  if (s?.status === "none_selected") return { status: "missing", messageZh: LANDED_TEXT.noneSelected };
  if (s?.status === "unconvertible") return { status: "missing", messageZh: LANDED_TEXT.unconvertible };
  return { status: "missing", messageZh: LANDED_TEXT.unavailable };
}

/* ---------------------------------- 整体 ---------------------------------- */

export type SourcingSuggestionsView = {
  recommendations: SourcingRecommendations;
  prices: {
    awards: AwardColumn;
    market: MarketColumn;
    /** 只有对本项目有财务查看权的人才有这一栏（没有权限时没有这个键） */
    landed?: LandedColumn;
  };
  noteZh: string;
};

export function assembleSourcingSuggestions(input: {
  recommendations: SourcingRecommendations;
  awards: AwardColumn;
  market: MarketColumn;
  landed: LandedColumn | null;
}): SourcingSuggestionsView {
  return {
    recommendations: input.recommendations,
    prices: { awards: input.awards, market: input.market, ...(input.landed ? { landed: input.landed } : {}) },
    noteZh: SOURCING_PRICE_NOTE_ZH,
  };
}
