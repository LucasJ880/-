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

export const MEMO_COST_EXCLUDED_ZH = "我方成本、成本底价与毛利不在这里提供；不要推测。";
/** 旧版备忘里被换掉的段落（短句，卡片上风险门依据也用它） */
export const LEGACY_MEMO_REDACTED_ZH = "（内容涉及成本，已隐藏）";
/** 卡片第一行：旧版备忘 */
export const LEGACY_MEMO_CARD_NOTE_ZH = "旧版备忘可能写了我方成本或毛利，部分内容已隐藏。有编辑权限的成员可在本页上方「历史授标检索」点「立即检索外部情报」生成新版，完成后刷新页面。";
/** 卡片报价策略一行：旧版备忘 */
export const LEGACY_MEMO_PRICING_LINE_ZH = "报价策略：已隐藏（旧版）";
/** 卡片报价策略一行之后：新版备忘（对所有人） */
export const MEMO_COST_POINTER_ZH = "成本与毛利情景见工作台「报价表助手」（需要财务查看权）。";
/** 工作台摘要：旧版备忘的摘要 */
export const LEGACY_MEMO_WORKBENCH_ZH = "旧版策略备忘可能写了我方成本或毛利，摘要已隐藏；到情报页点「立即检索外部情报」生成新版。";
/** 澄清问题文件：旧版备忘里被去掉的问题（写在提交表之外） */
export const legacyRfiWithheldNoteZh = (n: number) => `旧版策略备忘里有 ${n} 条问题可能涉及我方成本，未列入；重新检索外部情报后再导出可补齐。`;

/**
 * 旧版备忘里碰到这些字眼（简繁、英文不分大小写）或像金额 / 百分比的数字的文字段整段换掉、RFI 整条去掉（宁可多换）。
 * 金额：带币种前缀、带千分位逗号、或 4 位以上的数字；百分比：数字后跟 % 或 ％。
 */
const COST_WORDS = /成本|毛利|底价|底價|底线|底線|利润|利潤|保本|盈亏|盈虧|会亏|會虧|落地价|落地價|进价|進價|加价|加價|加成|我方报价|我方報價|我们的报价|我們的報價|我司报|我司報|margin|cost|profit|markup|floor|landed/i;
const AMOUNT_LIKE = /(?:CAD|USD|C\$|US\$|\$|¥|￥)\s?\d|\d{1,3}(?:,\d{3})+|\d{4,}|\d+(?:\.\d+)?\s?[%％]/i;
export function looksCostRelated(text: string): boolean {
  return COST_WORDS.test(text) || AMOUNT_LIKE.test(text);
}
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

const cleanText = (v: unknown): unknown => (typeof v === "string" && looksCostRelated(v) ? LEGACY_MEMO_REDACTED_ZH : v);
const rfiHits = (q: unknown): boolean =>
  typeof q === "string" ? looksCostRelated(q) : !!q && typeof q === "object" && (looksCostRelated(String((q as Rec).questionZh ?? "")) || looksCostRelated(String((q as Rec).whyZh ?? "")));

/**
 * 旧版备忘的裁剪：不是对象 → 原样；输入里没有成本的版本 → 原样（同一个对象）；其余返回副本：
 * - 「评分演算」「报价策略」置空；摘要与每条风险门的依据整段换成固定短句（不看字眼）；
 * - 竞争格局、teaming、数据缺口与风险门名称碰到成本类字眼或像金额 / 百分比的数字整段换掉；
 * - 碰到的 RFI 整条去掉（对象或字符串都算），去掉几条记在 legacyRfisRemoved；带 legacyCostRedacted。
 */
export function redactLegacyMemo<T>(memo: T): T {
  if (!memo || typeof memo !== "object" || Array.isArray(memo)) return memo;
  if (isNoCostMemo(memo)) return memo;
  const m = memo as Rec;
  const out: Rec = { ...m, scoringAnalysisZh: "", pricingStrategyZh: "", legacyCostRedacted: true };
  if ("summaryZh" in m) out.summaryZh = LEGACY_MEMO_REDACTED_ZH;
  for (const k of ["competitiveLandscapeZh", "teamingAdviceZh", "dataGapsZh"]) if (k in m) out[k] = cleanText(m[k]);
  if (Array.isArray(m.riskGates)) out.riskGates = m.riskGates.map((g) => (g && typeof g === "object" ? { ...(g as Rec), gateZh: cleanText((g as Rec).gateZh), basisZh: LEGACY_MEMO_REDACTED_ZH } : g));
  if (Array.isArray(m.strategicRfis)) {
    // RFI 会原样进澄清问题文件（对外提交），碰到的整条去掉，不放占位句
    const kept = m.strategicRfis.filter((q) => !rfiHits(q));
    out.strategicRfis = kept;
    out.legacyRfisRemoved = m.strategicRfis.length - kept.length;
  } else out.legacyRfisRemoved = 0;
  return out as T;
}

/** 给模型用的地方：被换掉的段落不送占位句，送 null */
export function placeholderToNull(v: unknown): string | null {
  return typeof v === "string" && v !== LEGACY_MEMO_REDACTED_ZH ? v : null;
}
