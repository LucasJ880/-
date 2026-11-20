/**
 * CHAIN-2d 投标策略备忘与我方成本（纯函数，零 IO、零模型调用）
 *
 * 1. buildMemoPricingAnalysis：给备忘模型用的报价演算。从调查室 summaryJson 里只取对手价（人工输入 >
 *    联邦对标中位 > 现任价格带中位），不读我方成本、成本来源、目标毛利；演算时不传成本，
 *    所以没有「成本 + 目标毛利」「成本价」情景、没有毛利。
 * 2. redactLegacyMemo：改动以前生成的旧版备忘（版本不在「输入里没有成本」的集合里）可能写着成本或毛利——
 *    去掉「评分演算」「报价策略」两段，其余文字段碰到成本类字眼就换成一句固定的话。
 *    所有读备忘给人看或交给别的模型的地方都先过它。
 */
import { buildScenarios, type ScoringModel } from "@/lib/tender-pricing/calc";

/** 输入里没有我方成本的备忘版本（CHAIN-2d 起）。读取端只认这个集合，不在里面的都按旧版处理 */
export const BID_STRATEGY_MEMO_NO_COST_VERSION = "tender-bid-strategy-memo/v3" as const;
export const BID_STRATEGY_MEMO_NO_COST_VERSIONS: ReadonlySet<string> = new Set([BID_STRATEGY_MEMO_NO_COST_VERSION]);

export const MEMO_COST_EXCLUDED_ZH = "我方成本、目标毛利与成本底价只给有财务查看权的人看，这里不提供；不要推测。";
export const LEGACY_MEMO_REDACTED_ZH = "（旧版备忘的这一段可能提到我方成本或毛利，已隐藏。）";
export const LEGACY_MEMO_PRICING_NOTE_ZH = "报价策略：这份策略备忘是旧版生成的，可能含我方成本或毛利，已隐藏；请有编辑权限的同事重新检索外部情报，会生成新的。";

/** 旧版备忘里碰到这些字眼的文字段整段换掉（宁可多换） */
const COST_WORDS = /成本|毛利|底价|利润|我方报价|margin|cost/i;
/** 没有成本时演算会加的那句假设——这里成本不是没填，是不给，换成 MEMO_COST_EXCLUDED_ZH */
const NO_COST_ASSUMPTION = /未填我方成本/;
const COST_SCENARIO_KEYS = new Set(["floor", "cost"]);

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type MemoPricingAnalysis = {
  model: { priceWeightPct: number; costFormula: ScoringModel["costFormula"]; otherCriteria: ScoringModel["otherCriteria"]; source: ScoringModel["source"] };
  inputs: { competitorPriceCad: number | null };
  breakEvenPriceCad: number | null;
  breakEvenNoteZh: string;
  ourOtherPts: number;
  competitorOtherPts: number;
  scenarios: Array<{ key: string; labelZh: string; priceCad: number; ourTotal: number; competitorTotal: number; deltaPts: number }>;
  assumptionsZh: string[];
  costExcludedZh: string;
};

/** 对手价：人工输入 > 联邦对标中位 > 现任价格带中位（与改动前同一顺序） */
export function memoCompetitorPrice(roomSummary: unknown, vendorPriceBenchmark: unknown): number | null {
  const rsj = rec(roomSummary);
  const manual = num(rec(rsj.pricingInputs).competitorPriceCad);
  if (manual != null) return manual;
  const bench = num(rec(vendorPriceBenchmark).median);
  if (bench != null) return bench;
  const band = rec(rec(rsj.incumbentLead).priceBandCad);
  const low = num(band.low);
  const high = num(band.high);
  return low != null && high != null ? Math.round((low + high) / 2) : null;
}

export function buildMemoPricingAnalysis(input: { model: ScoringModel; roomSummary: unknown; vendorPriceBenchmark: unknown }): MemoPricingAnalysis {
  const competitor = memoCompetitorPrice(input.roomSummary, input.vendorPriceBenchmark);
  const result = buildScenarios(input.model, { competitorPriceCad: competitor, ourCostCad: null, targetMarginPct: null });
  const m = input.model;
  return {
    model: { priceWeightPct: m.priceWeightPct, costFormula: m.costFormula, otherCriteria: m.otherCriteria, source: m.source },
    inputs: { competitorPriceCad: competitor },
    breakEvenPriceCad: result.breakEvenPriceCad,
    breakEvenNoteZh: result.breakEvenNoteZh,
    ourOtherPts: result.ourOtherPts,
    competitorOtherPts: result.competitorOtherPts,
    scenarios: result.scenarios
      .filter((sc) => !COST_SCENARIO_KEYS.has(sc.key))
      .map((sc) => ({ key: sc.key, labelZh: sc.labelZh, priceCad: sc.priceCad, ourTotal: sc.ourTotal, competitorTotal: sc.competitorTotal, deltaPts: sc.deltaPts })),
    assumptionsZh: result.assumptionsZh.filter((a) => !NO_COST_ASSUMPTION.test(a)),
    costExcludedZh: MEMO_COST_EXCLUDED_ZH,
  };
}

export function isNoCostMemo(memo: unknown): boolean {
  const v = rec(memo).version;
  return typeof v === "string" && BID_STRATEGY_MEMO_NO_COST_VERSIONS.has(v);
}

const cleanText = (v: unknown): unknown => (typeof v === "string" && COST_WORDS.test(v) ? LEGACY_MEMO_REDACTED_ZH : v);

/**
 * 旧版备忘的裁剪：不是对象 → 原样；输入里没有成本的版本 → 原样；
 * 其余 → 「评分演算」「报价策略」置空，摘要、竞争格局、teaming、数据缺口、风险门里碰到成本类字眼的整段换掉，
 * 碰到成本类字眼的 RFI 整条去掉，带 legacyCostRedacted。
 */
export function redactLegacyMemo<T>(memo: T): T {
  if (!memo || typeof memo !== "object" || Array.isArray(memo)) return memo;
  if (isNoCostMemo(memo)) return memo;
  const m = memo as Rec;
  const out: Rec = { ...m, scoringAnalysisZh: "", pricingStrategyZh: "", legacyCostRedacted: true };
  for (const k of ["summaryZh", "competitiveLandscapeZh", "teamingAdviceZh", "dataGapsZh"]) if (k in m) out[k] = cleanText(m[k]);
  if (Array.isArray(m.riskGates)) out.riskGates = m.riskGates.map((g) => (g && typeof g === "object" ? { ...(g as Rec), gateZh: cleanText((g as Rec).gateZh), basisZh: cleanText((g as Rec).basisZh) } : g));
  // RFI 会原样进澄清问题文件（对外提交），碰到成本类字眼的整条去掉，不放占位句
  if (Array.isArray(m.strategicRfis)) out.strategicRfis = m.strategicRfis.filter((q) => !(q && typeof q === "object" && (COST_WORDS.test(String((q as Rec).questionZh ?? "")) || COST_WORDS.test(String((q as Rec).whyZh ?? "")))));
  return out as T;
}
