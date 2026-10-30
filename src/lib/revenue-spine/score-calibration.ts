/**
 * Revenue Spine — 评分校准（B-4，openspec change fde-score-calibration）纯函数
 *
 * 把询盘分诊时的首次评估（六维得分 / 当时满分）与商机当前阶段对账：
 * - 结局与 /revenue 同口径：won = 赢、lost = 输，其余未定；报价看阶段 + QUOTE_SENT（只当布尔证据）
 * - 入驻测试与 disqualified 不进比率（disqualified 由评分自己决定，拿来校准是循环论证）
 * - 建议权重：可评估维度先拿下限（Product Fit 3、其余 1），剩余按区分度正部比例分配，最大余数法取整，
 *   和恒等于现有权重之和；只展示，不改 policy
 *
 * 只吃统计需要的字段（等级、维度分、阶段、是否测试、是否报价），拿不到客户信息与金额。
 */

import type { ScoreDimension } from "./scoring";
import { OPEN_STAGES, PRE_QUOTE_STAGES } from "./opportunity-stage";

export type CalibrationDimensionKey = ScoreDimension["key"];

/** 固定维度顺序（展示、片段键顺序、取整并列时的分配顺序） */
export const CALIBRATION_DIMENSIONS: ReadonlyArray<{ key: CalibrationDimensionKey; label: string }> = [
  { key: "productFit", label: "Product Fit" },
  { key: "commercialPotential", label: "Commercial Potential" },
  { key: "buyerQuality", label: "Buyer Quality" },
  { key: "intent", label: "Intent" },
  { key: "completeness", label: "Completeness" },
  { key: "strategicValue", label: "Strategic Value" },
];

export const CALIBRATION_MIN_DECIDED = 30;
export const DEFAULT_CALIBRATION_DAYS = 90;
export const MIN_CALIBRATION_DAYS = 30;
export const MAX_CALIBRATION_DAYS = 180;
/** 归一值 ≥ 0.5 视为该维"看好" */
export const FAVORABLE_THRESHOLD = 0.5;
export const CALIBRATION_GRADES = ["HOT", "HIGH", "MEDIUM", "LOW"] as const;
export type CalibrationGrade = (typeof CALIBRATION_GRADES)[number];

export type CalibrationBucketKey = "low" | "mid" | "high";
/** 低 [0, 0.4)、中 [0.4, 0.7)、高 [0.7, 1]；边界归入较高的桶 */
export const CALIBRATION_BUCKETS: ReadonlyArray<{ key: CalibrationBucketKey; label: string; min: number }> = [
  { key: "low", label: "低（<40%）", min: 0 },
  { key: "mid", label: "中（40–70%）", min: 0.4 },
  { key: "high", label: "高（≥70%）", min: 0.7 },
];

/** 浮点边界容差（14/20 这类归一值稳定落在 0.7 上） */
const EPS = 1e-9;

export function parseCalibrationDays(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_CALIBRATION_DAYS;
  return Math.min(MAX_CALIBRATION_DAYS, Math.max(MIN_CALIBRATION_DAYS, Math.round(n)));
}

// ── 结局口径 ──────────────────────────────────────────────

export type CalibrationOutcome = "won" | "lost" | "open";

export function outcomeOfStage(stage: string): CalibrationOutcome {
  if (stage === "won") return "won";
  if (stage === "lost") return "lost";
  return "open";
}

/** 报价及之后的阶段：开放态中报价前阶段之后的部分 + won */
export const QUOTE_REACHED_STAGES: readonly string[] = [
  ...OPEN_STAGES.filter((s) => !(PRE_QUOTE_STAGES as readonly string[]).includes(s)),
  "won",
];

export function reachedQuote(stage: string, quoteSent: boolean): boolean {
  return quoteSent || QUOTE_REACHED_STAGES.includes(stage);
}

/** 报价已见分晓：报过价，或已不在报价前的开放阶段 */
export function quoteResolved(stage: string, quoteSent: boolean): boolean {
  return reachedQuote(stage, quoteSent) || !(PRE_QUOTE_STAGES as readonly string[]).includes(stage);
}

// ── 维度归一 ──────────────────────────────────────────────

const DIMENSION_KEYS = new Set<string>(CALIBRATION_DIMENSIONS.map((d) => d.key));

/** dimensionsJson → 各维 score/max（0–1）；满分 ≤ 0、得分非数字、缺维度的不给值 */
export function normalizedDimensions(dimensionsJson: unknown): Partial<Record<CalibrationDimensionKey, number>> {
  const out: Partial<Record<CalibrationDimensionKey, number>> = {};
  if (!Array.isArray(dimensionsJson)) return out;
  for (const d of dimensionsJson) {
    if (!d || typeof d !== "object") continue;
    const { key, score, max } = d as { key?: unknown; score?: unknown; max?: unknown };
    if (typeof key !== "string" || !DIMENSION_KEYS.has(key)) continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) continue;
    const k = key as CalibrationDimensionKey;
    if (out[k] !== undefined) continue;
    out[k] = Math.min(1, Math.max(0, score / max));
  }
  return out;
}

export function bucketOf(r: number): CalibrationBucketKey {
  if (r + EPS >= 0.7) return "high";
  if (r + EPS >= 0.4) return "mid";
  return "low";
}

export function isFavorable(r: number): boolean {
  return r + EPS >= FAVORABLE_THRESHOLD;
}

// ── 统计 ──────────────────────────────────────────────────

export interface CalibrationRow {
  /** 首次评估记录的等级 */
  grade: string | null;
  /** 首次评估的 dimensionsJson */
  dimensions: unknown;
  /** 商机当前阶段 */
  stage: string;
  /** 有 QUOTE_SENT 业务结果 */
  quoteSent: boolean;
  /** 入驻测试（与询盘 SLA 指标同一判定） */
  onboardingTest: boolean;
}

export interface CalibrationTally {
  n: number;
  decided: number;
  won: number;
  winRate: number | null;
  quoteResolved: number;
  quoted: number;
  quoteRate: number | null;
}

export interface DimensionCalibration {
  key: CalibrationDimensionKey;
  label: string;
  currentWeight: number;
  /** 有归一值的样本数 */
  evaluated: number;
  buckets: Record<CalibrationBucketKey, CalibrationTally>;
  /** 有归一值的已定商机 */
  decided: number;
  hits: number;
  hitRate: number | null;
  favorable: { decided: number; won: number; winRate: number | null };
  unfavorable: { decided: number; won: number; winRate: number | null };
  /** 看好组赢单率 − 不看好组赢单率；任一组无已定商机时为空 */
  lift: number | null;
  evaluable: boolean;
  suggestedWeight: number | null;
}

export type CalibrationStatus = "ok" | "insufficient" | "no_signal";

export type CalibrationWeights = Record<CalibrationDimensionKey, number>;

export interface CalibrationPolicySnippet {
  scoring: { weights: CalibrationWeights };
}

export interface ScoreCalibrationReport {
  generatedAt: string;
  windowDays: number;
  minDecided: number;
  status: CalibrationStatus;
  /** 状态为无信号时的原因，其余为空 */
  noSignalReason: NoSignalReason | null;
  truncated: boolean;
  sample: CalibrationTally & {
    lost: number;
    open: number;
    excludedOnboardingTest: number;
    excludedDisqualified: number;
  };
  currentWeights: CalibrationWeights;
  dimensions: DimensionCalibration[];
  grades: Array<CalibrationTally & { grade: CalibrationGrade }>;
  suggestedWeights: CalibrationWeights | null;
  policySnippet: CalibrationPolicySnippet | null;
}

export function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

interface Counted {
  outcome: CalibrationOutcome;
  quoted: boolean;
  resolved: boolean;
}

function emptyTally(): CalibrationTally {
  return { n: 0, decided: 0, won: 0, winRate: null, quoteResolved: 0, quoted: 0, quoteRate: null };
}

function addTo(t: CalibrationTally, c: Counted): void {
  t.n += 1;
  if (c.outcome !== "open") t.decided += 1;
  if (c.outcome === "won") t.won += 1;
  if (c.resolved) t.quoteResolved += 1;
  if (c.quoted) t.quoted += 1;
}

function finish<T extends CalibrationTally>(t: T): T {
  t.winRate = ratio(t.won, t.decided);
  t.quoteRate = ratio(t.quoted, t.quoteResolved);
  return t;
}

/** policy 权重 → 六维数字（缺失或非法记 0） */
export function calibrationWeightsOf(weights: Partial<Record<string, unknown>> | null | undefined): CalibrationWeights {
  const out = {} as CalibrationWeights;
  for (const { key } of CALIBRATION_DIMENSIONS) {
    const v = weights?.[key];
    out[key] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  return out;
}

/**
 * 可评估维度的建议权重下限：
 * - Product Fit 3：评分对"未识别到产品"按 round(权重 × 0.2) 给分，而 Product Fit = 0 会被判不合格（scoring.ts）；
 *   权重 ≥ 3 时这一档仍得 1 分，粘贴建议后不合格的判定与现在一致；
 * - 其余 1：权重一旦为 0，之后的评估满分为 0、该维永远无法评估，校准再也救不回来。
 */
export const CALIBRATION_MIN_WEIGHTS: Readonly<CalibrationWeights> = {
  productFit: 3,
  commercialPotential: 1,
  buyerQuality: 1,
  intent: 1,
  completeness: 1,
  strategicValue: 1,
};

/** 无信号的原因：没有可评估维度 / 区分度都不为正 / 总额不够分下限 */
export type NoSignalReason = "no_evaluable" | "no_positive_lift" | "budget";

export type WeightSuggestion = { weights: CalibrationWeights; reason: null } | { weights: null; reason: NoSignalReason };

/**
 * 建议权重：
 * 1. 总额 T = round(Σ max(0, 现有权重))；
 * 2. 无法评估的维度保留 round(max(0, 现有权重))；
 * 3. 可评估维度先各拿下限（CALIBRATION_MIN_WEIGHTS），剩余按 max(0, 区分度) 比例分配，
 *    floor 后差额按小数部分从大到小补 1（并列按固定维度顺序）。
 * 没有可评估维度、区分度正部之和为 0、或总额不够分下限时不给建议（无信号）。
 */
export function suggestWeights(
  dims: ReadonlyArray<{ key: CalibrationDimensionKey; lift: number | null; currentWeight: number }>,
): WeightSuggestion {
  const total = Math.round(dims.reduce((s, d) => s + Math.max(0, d.currentWeight), 0));
  const out = {} as CalibrationWeights;
  let reserved = 0;
  const evaluable: Array<{ key: CalibrationDimensionKey; pos: number; order: number }> = [];
  dims.forEach((d, order) => {
    if (d.lift === null) {
      out[d.key] = Math.round(Math.max(0, d.currentWeight));
      reserved += out[d.key];
    } else {
      evaluable.push({ key: d.key, pos: Math.max(0, d.lift), order });
      reserved += CALIBRATION_MIN_WEIGHTS[d.key];
    }
  });
  if (evaluable.length === 0) return { weights: null, reason: "no_evaluable" };
  const posSum = evaluable.reduce((s, d) => s + d.pos, 0);
  if (posSum <= EPS) return { weights: null, reason: "no_positive_lift" };
  const budget = total - reserved;
  if (budget < 0) return { weights: null, reason: "budget" };
  const parts = evaluable.map((d) => {
    const raw = (budget * d.pos) / posSum;
    const base = Math.floor(raw + EPS);
    return { ...d, base, frac: raw - base };
  });
  let rest = budget - parts.reduce((s, p) => s + p.base, 0);
  const byRemainder = [...parts].sort((a, b) => (Math.abs(b.frac - a.frac) > EPS ? b.frac - a.frac : a.order - b.order));
  for (const p of byRemainder) {
    if (rest <= 0) break;
    p.base += 1;
    rest -= 1;
  }
  for (const p of parts) out[p.key] = CALIBRATION_MIN_WEIGHTS[p.key] + p.base;
  // 按固定维度顺序重排键
  const ordered = {} as CalibrationWeights;
  for (const { key } of CALIBRATION_DIMENSIONS) if (key in out) ordered[key] = out[key];
  return { weights: ordered, reason: null };
}

export function calibrationPolicySnippet(weights: CalibrationWeights): CalibrationPolicySnippet {
  const ordered = {} as CalibrationWeights;
  for (const { key } of CALIBRATION_DIMENSIONS) ordered[key] = weights[key];
  return { scoring: { weights: ordered } };
}

/** 复制到剪贴板的文本（与区块 <pre> 显示一致） */
export function calibrationSnippetText(snippet: CalibrationPolicySnippet): string {
  return JSON.stringify(snippet, null, 2);
}

export function computeScoreCalibration(
  rows: readonly CalibrationRow[],
  opts: { weights: Partial<Record<string, unknown>> | null | undefined; windowDays: number; now: Date; truncated?: boolean },
): ScoreCalibrationReport {
  const currentWeights = calibrationWeightsOf(opts.weights);
  const sample = { ...emptyTally(), lost: 0, open: 0, excludedOnboardingTest: 0, excludedDisqualified: 0 };
  const dims = CALIBRATION_DIMENSIONS.map(({ key, label }) => ({
    key,
    label,
    currentWeight: currentWeights[key],
    evaluated: 0,
    buckets: { low: emptyTally(), mid: emptyTally(), high: emptyTally() } as Record<CalibrationBucketKey, CalibrationTally>,
    decided: 0,
    hits: 0,
    hitRate: null as number | null,
    favorable: { decided: 0, won: 0, winRate: null as number | null },
    unfavorable: { decided: 0, won: 0, winRate: null as number | null },
    lift: null as number | null,
    evaluable: false,
    suggestedWeight: null as number | null,
  }));
  const grades = new Map<CalibrationGrade, CalibrationTally>(CALIBRATION_GRADES.map((g) => [g, emptyTally()]));

  for (const row of rows) {
    if (row.onboardingTest) {
      sample.excludedOnboardingTest += 1;
      continue;
    }
    if (row.stage === "disqualified") {
      sample.excludedDisqualified += 1;
      continue;
    }
    const c: Counted = {
      outcome: outcomeOfStage(row.stage),
      quoted: reachedQuote(row.stage, row.quoteSent),
      resolved: quoteResolved(row.stage, row.quoteSent),
    };
    addTo(sample, c);
    if (c.outcome === "lost") sample.lost += 1;
    if (c.outcome === "open") sample.open += 1;

    const g = (row.grade ?? "").trim().toUpperCase() as CalibrationGrade;
    const gt = grades.get(g);
    if (gt) addTo(gt, c);

    const values = normalizedDimensions(row.dimensions);
    for (const d of dims) {
      const r = values[d.key];
      if (r === undefined) continue;
      d.evaluated += 1;
      addTo(d.buckets[bucketOf(r)], c);
      if (c.outcome === "open") continue;
      const fav = isFavorable(r);
      const won = c.outcome === "won";
      d.decided += 1;
      if (fav === won) d.hits += 1;
      const side = fav ? d.favorable : d.unfavorable;
      side.decided += 1;
      if (won) side.won += 1;
    }
  }

  finish(sample);
  for (const d of dims) {
    for (const b of CALIBRATION_BUCKETS) finish(d.buckets[b.key]);
    d.hitRate = ratio(d.hits, d.decided);
    d.favorable.winRate = ratio(d.favorable.won, d.favorable.decided);
    d.unfavorable.winRate = ratio(d.unfavorable.won, d.unfavorable.decided);
    d.evaluable = d.favorable.decided > 0 && d.unfavorable.decided > 0;
    d.lift = d.evaluable ? (d.favorable.winRate as number) - (d.unfavorable.winRate as number) : null;
  }

  let status: CalibrationStatus;
  let noSignalReason: NoSignalReason | null = null;
  let suggestedWeights: CalibrationWeights | null = null;
  if (sample.decided < CALIBRATION_MIN_DECIDED) {
    status = "insufficient";
  } else {
    const suggestion = suggestWeights(dims);
    suggestedWeights = suggestion.weights;
    noSignalReason = suggestion.reason;
    status = suggestedWeights ? "ok" : "no_signal";
  }
  if (suggestedWeights) for (const d of dims) d.suggestedWeight = suggestedWeights[d.key];

  return {
    generatedAt: opts.now.toISOString(),
    windowDays: opts.windowDays,
    minDecided: CALIBRATION_MIN_DECIDED,
    status,
    noSignalReason,
    truncated: opts.truncated === true,
    sample,
    currentWeights,
    dimensions: dims,
    grades: CALIBRATION_GRADES.map((grade) => ({ grade, ...finish(grades.get(grade) as CalibrationTally) })),
    suggestedWeights,
    policySnippet: suggestedWeights ? calibrationPolicySnippet(suggestedWeights) : null,
  };
}
