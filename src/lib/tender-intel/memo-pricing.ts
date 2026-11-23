/**
 * CHAIN-2d 投标策略备忘与我方成本（纯函数，零 IO、零模型调用）
 *
 * 1. buildMemoPricingAnalysis：给备忘模型用的报价演算。从调查室 summaryJson 里只取对手价（人工输入 >
 *    联邦对标中位 > 现任价格带中位），不读我方成本、成本来源、目标毛利；演算时不传成本，
 *    所以没有「成本 + 目标毛利」「成本价」情景、没有毛利。
 * 2. redactLegacyMemo：改动以前生成的旧版备忘（版本不在「输入里没有成本」的集合里）可能写着成本或毛利——
 *    「评分演算」「报价策略」置空，其余自由文字段一律整段换成一句固定的话（不看字眼），RFI 的理由去掉，
 *    RFI 的问题按规则判断、碰到的整条去掉。所有读备忘给人看或交给别的模型的地方都先过它。
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
 * 旧版备忘的 RFI 问题按这些规则判断（宁可多去掉）。判断前先归一：NFKC（全角转半角），
 * 去掉数字里的空格、千分位逗号 / 撇号与三位一组的点（87 654、87,654、87.654 → 87654）。
 * - 字眼（简繁、英文不分大小写；GP 区分大小写）：成本、毛利、底价 / 底线、利润、盈利、盈亏、保本、亏损 / 亏本、赚、
 *   落地价、进价 / 进货、采购价、供应商报价、加价 / 加成、让利 / 让价、下限、我方报价 / 我们报价 / 我司报价，
 *   margin、cost、COGS、profit、markup / mark-up、floor、landed、bottom line、GP；
 * - 金额：带币种前缀的数字、4 位以上的数字、数字后跟 万 / 亿 / 元 / 块 / 加元 / 美元、两位以上（或带小数）的数字后跟 k、
 *   中文数字（零一二…十、壹贰叁…拾佰仟）后跟 万 / 亿 / 元 / 块、两个以上连着的大写数字；
 * - 百分比：数字后跟 %、「百分之」、「百分点」、数字或中文数字后跟「个点 / 個點」、数字后跟 pt / pts / bps / percent。
 */
const COST_WORDS =
  /成本|毛利|底价|底價|底线|底線|利润|利潤|盈利|盈亏|盈虧|保本|亏损|虧損|亏本|虧本|会亏|會虧|赚|賺|落地价|落地價|进价|進價|进货|進貨|采购价|採購價|采購價|供应商的?报价|供應商的?報價|加价|加價|加成|让利|讓利|让价|讓價|下限|我方的?报价|我方的?報價|我们的?报价|我們的?報價|我司报|我司報|margin|cost|cogs|profit|mark-?up|floor|landed|bottom\s?line/i;
const COST_WORDS_CASED = /\bGP\b/;
const CN_DIGIT = "零〇一二两兩三四五六七八九十";
const CN_UPPER = "壹贰貳叁參肆伍陆陸柒捌玖拾";
const AMOUNT_LIKE = new RegExp(
  [
    "(?:CAD|USD|C\\$|US\\$|\\$|¥|￥)\\s?\\d",
    "\\d{4,}",
    "\\d\\s?(?:万|萬|亿|億|元|块|塊|加元|加币|加幣|美元)",
    "(?:\\d{2,}|\\d\\.\\d+)\\s?k(?![a-z])",
    "\\d\\s?(?:dollars?|bucks)\\b",
    `(?:[${CN_DIGIT}][${CN_DIGIT}百千]*|[${CN_UPPER}][${CN_UPPER}佰仟零]*)\\s?(?:万|萬|亿|億|元|块|塊|加元|美元)`,
    `[${CN_UPPER}][${CN_UPPER}佰仟零]+`,
  ].join("|"),
  "i",
);
const PERCENT_LIKE = new RegExp(
  ["\\d\\s?%", "百分之", "百分[点點]", `(?:\\d|[${CN_DIGIT}几幾])\\s?(?:个|個)[点點]`, "\\d\\s?(?:pts?|bps|percent|per\\s?cent)\\b"].join("|"),
  "i",
);
/** 判断前的归一（导出给测试） */
export function normalizeForCostCheck(text: string): string {
  return text.normalize("NFKC").replace(/(\d)[\s,'’.](?=\d{3}(?!\d))/g, "$1");
}
export function looksCostRelated(text: string): boolean {
  const s = normalizeForCostCheck(text);
  return COST_WORDS.test(s) || COST_WORDS_CASED.test(s) || AMOUNT_LIKE.test(s) || PERCENT_LIKE.test(s);
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

/** 旧版备忘里照旧保留的结构化字段（系统写的，不是模型写的文字） */
const LEGACY_KEEP_KEYS = new Set(["version", "label", "generatedAt", "model"]);
/** 风险门状态只认这三个取值（模型输出时已归一），其余当自由文字 */
const GATE_STATUSES = new Set(["已满足", "需解决", "高风险"]);
/** 本函数自己写的标记，原值不沿用 */
const REDACTION_MARK_KEYS = new Set(["legacyCostRedacted", "legacyRfisRemoved"]);

function redactLegacyRfis(list: unknown[]): { kept: unknown[]; removed: number } {
  const kept: unknown[] = [];
  let removed = 0;
  for (const q of list) {
    const question = typeof q === "string" ? q : q && typeof q === "object" && !Array.isArray(q) ? (q as Rec).questionZh : undefined;
    // 没有问题文字的条目本来也进不了澄清问题文件（buildRfiItems 跳过），直接去掉、不计数
    if (typeof question !== "string" || !question.trim()) continue;
    if (looksCostRelated(question)) {
      removed += 1;
      continue;
    }
    // 理由（whyZh）是模型写的自由文字，一律去掉；字符串形式的 RFI 本来就只有问题
    kept.push(typeof q === "string" ? q : { questionZh: question, whyZh: null });
  }
  return { kept, removed };
}

/**
 * 旧版备忘的裁剪：不是对象 → 原样；输入里没有成本的版本 → 原样（同一个对象）；其余返回副本：
 * - 版本、标签、生成时间、模型名照旧；「评分演算」「报价策略」置空；
 * - 其余字段（摘要、竞争格局、teaming、数据缺口及任何别的字段）一律整段换成固定短句，原本没有的保持没有；
 * - 风险门只留对象：名称与依据换成固定短句，状态是「已满足 / 需解决 / 高风险」之一的照旧、否则也换掉；
 *   风险门与 RFI 总是数组（不是数组的当作空）；
 * - RFI：理由去掉（null）；问题按 looksCostRelated 判断，碰到的整条去掉（对象或字符串都算），
 *   去掉几条记在 legacyRfisRemoved；带 legacyCostRedacted。
 */
export function redactLegacyMemo<T>(memo: T): T {
  if (!memo || typeof memo !== "object" || Array.isArray(memo)) return memo;
  if (isNoCostMemo(memo)) return memo;
  const m = memo as Rec;
  const out: Rec = {};
  for (const [k, v] of Object.entries(m)) {
    if (REDACTION_MARK_KEYS.has(k) || k === "riskGates" || k === "strategicRfis") continue;
    if (LEGACY_KEEP_KEYS.has(k)) out[k] = v;
    else out[k] = v === undefined || v === null ? v : LEGACY_MEMO_REDACTED_ZH;
  }
  out.scoringAnalysisZh = "";
  out.pricingStrategyZh = "";
  // 风险门与 RFI 总是数组（读取端按数组用；不是数组的整个丢掉）
  out.riskGates = (Array.isArray(m.riskGates) ? m.riskGates : [])
    .filter((g): g is Rec => !!g && typeof g === "object" && !Array.isArray(g))
    .map((g) => ({
      gateZh: LEGACY_MEMO_REDACTED_ZH,
      statusZh: typeof g.statusZh === "string" && GATE_STATUSES.has(g.statusZh) ? g.statusZh : LEGACY_MEMO_REDACTED_ZH,
      basisZh: LEGACY_MEMO_REDACTED_ZH,
    }));
  // RFI 会进澄清问题文件（对外提交），碰到的整条去掉，不放占位句
  const rfis = redactLegacyRfis(Array.isArray(m.strategicRfis) ? m.strategicRfis : []);
  out.strategicRfis = rfis.kept;
  out.legacyRfisRemoved = rfis.removed;
  out.legacyCostRedacted = true;
  return out as T;
}

/** 给模型用的地方：被换掉的段落不送占位句，送 null */
export function placeholderToNull(v: unknown): string | null {
  return typeof v === "string" && v !== LEGACY_MEMO_REDACTED_ZH ? v : null;
}
