/**
 * CHAIN-2 — 寻源建议的组装与文案（纯函数，零 DB / 零 LLM）
 *
 * 推荐型号：只取已完成评估算出的排名里主选 / 备选、强制闸通过的前 3 个；没有就照实说原因。
 * 价格对照：可比授标 / 市场价格基准 / 我方落地价三栏并排、各写各的口径，缺哪栏写明缺；
 * 三栏不合并、不换汇、不推导「建议报价」（硬纪律第 4、7 条）。
 */

import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";

export const SOURCING_PRICE_NOTE_ZH = "三种价格口径不同，不合并成一个数；报价由人定。";
export const SOURCING_MAX_RECOMMENDATIONS = 3;
export const SOURCING_MAX_MARKET_ITEMS = 5;

export function supplyChainHref(projectId: string): string {
  return `/projects/intelligence/supply-chain?projectId=${encodeURIComponent(projectId)}`;
}

/* ---------------------------------- 推荐型号 ---------------------------------- */

export type ScoreSet = { technical: number | null; commercial: number | null; reliability: number | null; importRisk: number | null; total: number | null };

/** 排名里的一行（取自供应商情报的推荐排名）+ 这个候选的强制闸条目 */
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
  supplierName: string;
  offeringName: string | null;
  offeringSku: string | null;
  section: "PRIMARY" | "BACKUP";
  rank: number | null;
  scores: ScoreSet;
  /** 强制要求里判定通过且证据可采信的条数 / 强制要求总条数 */
  mandatoryEvidence: { withEvidence: number; total: number };
};

export type SourcingRecommendations =
  | { status: "ready"; items: SourcingRecommendationItem[]; href: string }
  | { status: "not_evaluated" | "none_passed" | "intel_off" | "unavailable"; messageZh: string; href: string | null };

export function buildRecommendations(input: {
  projectId: string;
  intelEnabled: boolean;
  /** null = 取数出错 */
  ranked: RankedCandidateInput[] | null;
  /** 系统在批准分析后自动建的候选池里的家数；没有自动建过 = null */
  autoPoolCount: number | null;
}): SourcingRecommendations {
  const href = supplyChainHref(input.projectId);
  if (!input.intelEnabled) return { status: "intel_off", messageZh: "供应商情报没有开启，暂时没有推荐型号。", href: null };
  if (!input.ranked) return { status: "unavailable", messageZh: "推荐型号暂时读不出来，请稍后刷新。", href };
  const eligible = input.ranked
    .filter((r) => (r.section === "PRIMARY" || r.section === "BACKUP") && r.mandatoryGateResult === "PASS")
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  if (eligible.length > 0) {
    return {
      status: "ready",
      href,
      items: eligible.slice(0, SOURCING_MAX_RECOMMENDATIONS).map((r) => ({
        supplierName: r.supplierName,
        offeringName: r.offeringName,
        offeringSku: r.offeringSku,
        section: r.section as "PRIMARY" | "BACKUP",
        rank: r.rank,
        scores: r.scores,
        mandatoryEvidence: { withEvidence: r.gateItems.filter((g) => g.gateVerdict === "PASS" && g.evidenceAdmissible).length, total: r.gateItems.length },
      })),
    };
  }
  if (input.ranked.length === 0) {
    const pool = input.autoPoolCount !== null ? `系统已在批准分析后建了候选池（${input.autoPoolCount} 家），` : "";
    return { status: "not_evaluated", messageZh: `还没有评估过的候选。${pool}请在供应链页逐条判定要求后，这里会列出推荐。`, href };
  }
  // 评估过但没有通过强制闸的：数一数哪些要求卡住得最多（同样多时按要求编号排）
  const blocked = new Map<string, number>();
  for (const r of input.ranked) for (const g of r.gateItems) if (g.gateVerdict !== "PASS") blocked.set(g.requirementKey, (blocked.get(g.requirementKey) ?? 0) + 1);
  const top = [...blocked.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([k]) => k);
  return {
    status: "none_passed",
    messageZh: `评估过 ${input.ranked.length} 个候选，都没有通过强制闸。${top.length ? `卡得最多的要求：${top.join("、")}。` : ""}`,
    href,
  };
}

/* ---------------------------------- 价格对照 ---------------------------------- */

export type AwardGroupInput = { buyerName: string; comparableScopeKey: string; currency: string; sampleSize: number; min: number; max: number; median: number; from: string | null; to: string | null };
export type AwardColumn =
  | { status: "ok"; groups: Array<{ scope: string; currency: string; sampleSize: number; min: number; median: number; max: number; from: string | null; to: string | null }> }
  | { status: "missing"; messageZh: string };

export function buildAwardColumn(input: { schemaReady: boolean; projectBuyer: string | null; groups: AwardGroupInput[] }): AwardColumn {
  if (!input.schemaReady) return { status: "missing", messageZh: "授标记录还没有接通。" };
  const buyer = (input.projectBuyer ?? "").trim();
  if (!buyer) return { status: "missing", messageZh: "项目没有采购方名称，没法比对。" };
  const want = normalizeBuyerName(buyer);
  const groups = input.groups
    .filter((g) => g.sampleSize >= 3 && normalizeBuyerName(g.buyerName) === want)
    .map((g) => ({ scope: g.comparableScopeKey, currency: g.currency, sampleSize: g.sampleSize, min: g.min, median: g.median, max: g.max, from: g.from, to: g.to }));
  return groups.length ? { status: "ok", groups } : { status: "missing", messageZh: "同一采购方、同口径的授标不足 3 个，不做区间。" };
}

export type MarketColumn =
  | { status: "ok"; items: Array<{ productName: string; vendor: string | null; priceRaw: string; currency: string | null; unit: string | null }>; fxNoteZh: string }
  | { status: "missing"; messageZh: string };

/** 只读外部情报已存的 summaryJson.marketPricing（不重新检索、不调模型） */
export function buildMarketColumn(marketPricing: unknown): MarketColumn {
  if (!marketPricing || typeof marketPricing !== "object") return { status: "missing", messageZh: "还没有跑过外部情报。" };
  const m = marketPricing as { status?: unknown; benchmarks?: unknown; fxNoteZh?: unknown };
  if (m.status === "unavailable") return { status: "missing", messageZh: "市场价格基准还没有接通。" };
  if (m.status === "no_product") return { status: "missing", messageZh: "分析里没有可检索的产品名称。" };
  if (m.status !== "ran") return { status: "missing", messageZh: "还没有跑过外部情报。" };
  const list = Array.isArray(m.benchmarks) ? m.benchmarks : [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const items = list
    .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>) : null))
    .filter((b): b is Record<string, unknown> => !!b && !!str(b.productName) && !!str(b.priceRaw))
    .slice(0, SOURCING_MAX_MARKET_ITEMS)
    .map((b) => ({ productName: str(b.productName) as string, vendor: str(b.vendor), priceRaw: str(b.priceRaw) as string, currency: str(b.currency), unit: str(b.unit) }));
  if (!items.length) return { status: "missing", messageZh: "已查询，没有找到可比的市场价格。" };
  return { status: "ok", items, fxNoteZh: str(m.fxNoteZh) ?? "基准价按来源原币呈现，未做汇率换算。" };
}

export type LandedColumn =
  | { status: "ok"; supplierName: string; roundNumber: number; landedCadTotal: number }
  | { status: "missing"; messageZh: string };

/** 比价矩阵选定那家的落地价（取数结果的形状同 tender-pricing 的 CompareCostSuggestion） */
export function buildLandedColumn(s: { status: string; landedCadTotal?: number; supplierName?: string; roundNumber?: number; messageZh?: string }): LandedColumn {
  if (s.status === "ok" && typeof s.landedCadTotal === "number" && s.supplierName && typeof s.roundNumber === "number") {
    return { status: "ok", supplierName: s.supplierName, roundNumber: s.roundNumber, landedCadTotal: s.landedCadTotal };
  }
  if (s.status === "none_selected") return { status: "missing", messageZh: "比价矩阵里还没有选定报价。" };
  if (s.status === "unconvertible") return { status: "missing", messageZh: "选定的报价换算不了落地价。" };
  return { status: "missing", messageZh: "我方落地价暂时读不出来。" };
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
