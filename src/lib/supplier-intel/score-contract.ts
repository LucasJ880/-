/**
 * Supplier Score V1 —— 冻结的确定性评分契约（B6）。
 *
 * 铁律：
 *   - LLM SHALL NOT determine numeric supplier score（H10）。
 *   - computeSupplierScore 是同步纯函数：no IO / no DB / no fetch / no LLM / no clock。
 *     同输入必同输出（T10 断言）。本模块不 import 任何其它模块。
 *   - 权重冻结（40/25/20/15，和恒为 1）；改动评分逻辑 = 发布新版本号，历史 Candidate 不动。
 *   - UNKNOWN（null）输入按显式规则折算并在 breakdown 里标注，绝不虚构数值。
 *   - LLM 允许出现的唯一位置是 S4 的 explainSupplierScore(breakdown)（解释既有分解，
 *     不产生数字）——本轮刻意不实现，避免提前发明 S4 细节。
 */

export const SUPPLIER_SCORE_V1 = {
  version: "supplier-score-v1",
  weights: {
    /** Technical Fit */
    technical: 0.4,
    /** Commercial */
    commercial: 0.25,
    /** Supplier Reliability */
    reliability: 0.2,
    /** Import / Delivery Risk（分高 = 风险低） */
    importRisk: 0.15,
  },
} as const;

export type ScoreComponentKey = keyof typeof SUPPLIER_SCORE_V1.weights;

export const SCORE_COMPONENT_KEYS: readonly ScoreComponentKey[] = [
  "technical",
  "commercial",
  "reliability",
  "importRisk",
];

/** 各维子分 0–100；null = UNKNOWN（该维暂无可判定输入，不虚构） */
export interface SupplierScoreInput {
  technical: number | null;
  commercial: number | null;
  reliability: number | null;
  importRisk: number | null;
}

export interface ScoreComponentBreakdown {
  /** 输入子分（clamp 到 0–100 后），UNKNOWN 时为 null */
  score: number | null;
  /** 冻结权重 */
  weight: number;
  /** score × weight，UNKNOWN 时为 null */
  weighted: number | null;
  known: boolean;
}

export interface SupplierScoreBreakdown {
  version: typeof SUPPLIER_SCORE_V1.version;
  components: Record<ScoreComponentKey, ScoreComponentBreakdown>;
  /** 已知维度的权重占比（0–1）；全 UNKNOWN 时为 0 */
  knownWeightShare: number;
  /**
   * 总分 0–100：已知维度加权和 ÷ knownWeightShare（按已知权重归一）；
   * 全 UNKNOWN → null。UNKNOWN 维度的中性基线细则属 S4（届时升 v2 或在 v1 文档化）。
   */
  totalScore: number | null;
  /** UNKNOWN 维度清单（显式标注，禁静默） */
  unknownComponents: ScoreComponentKey[];
}

function clamp01to100(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 同步纯函数：无 IO / 无时钟 / 无随机 / 无 LLM。 */
export function computeSupplierScore(input: SupplierScoreInput): SupplierScoreBreakdown {
  const components = {} as Record<ScoreComponentKey, ScoreComponentBreakdown>;
  const unknownComponents: ScoreComponentKey[] = [];
  let knownWeightShare = 0;
  let weightedSum = 0;

  for (const key of SCORE_COMPONENT_KEYS) {
    const weight = SUPPLIER_SCORE_V1.weights[key];
    const raw = input[key];
    if (raw === null || raw === undefined) {
      components[key] = { score: null, weight, weighted: null, known: false };
      unknownComponents.push(key);
      continue;
    }
    const score = clamp01to100(raw);
    const weighted = score * weight;
    components[key] = { score, weight, weighted: round2(weighted), known: true };
    knownWeightShare += weight;
    weightedSum += weighted;
  }

  const totalScore = knownWeightShare > 0 ? round2(weightedSum / knownWeightShare) : null;

  return {
    version: SUPPLIER_SCORE_V1.version,
    components,
    knownWeightShare: round2(knownWeightShare),
    totalScore,
    unknownComponents,
  };
}

/** 权重之和恒为 1 的自检（供测试与启动期断言调用；纯函数） */
export function scoreWeightSum(): number {
  return round2(
    SCORE_COMPONENT_KEYS.reduce((acc, k) => acc + SUPPLIER_SCORE_V1.weights[k], 0),
  );
}
