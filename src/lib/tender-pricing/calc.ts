/**
 * 报价表助手 · 纯计算层（tender-pricing/v1）
 *
 * 输入：评分模型（价格权重 + 成本评分公式 + 其它项权重与双方预期得分）、对手价、
 * 我方成本/目标毛利。输出：情景表（跟价/让价/成本底价/打平价）与「可接受溢价上限」。
 * 纪律：纯函数、零 IO、零 AI；所有假设显式写进 assumptionsZh；绝不输出 GO/NO-GO。
 */

export const PRICING_MODEL_VERSION = "tender-pricing-model/v1" as const;

export type CostFormula = "lowest_over_bid" | "linear_gap" | "unknown";

export type ScoringCriterion = {
  key: string;
  nameZh: string;
  weightPct: number;
  /** 我方预期得分率 0-100（null = 未知，计算时按 60 中性处理并记假设） */
  ourPct: number | null;
  /** 对手（现任）预期得分率 0-100 */
  competitorPct: number | null;
  basisZh?: string;
};

export type ScoringModel = {
  version: typeof PRICING_MODEL_VERSION;
  priceWeightPct: number;
  costFormula: CostFormula;
  otherCriteria: ScoringCriterion[];
  source: "AI_INFERRED" | "HEURISTIC" | "HUMAN";
  evidenceZh: string[];
  derivedAt: string;
};

export type PricingInputs = {
  competitorPriceCad: number | null;
  ourCostCad: number | null;
  targetMarginPct: number | null;
};

export type Scenario = {
  key: string;
  labelZh: string;
  priceCad: number;
  ourPriceScore: number;
  competitorPriceScore: number;
  ourTotal: number;
  competitorTotal: number;
  /** 我方总分 − 对手总分 */
  deltaPts: number;
  marginPct: number | null;
  noteZh: string;
};

export type PricingResult = {
  scenarios: Scenario[];
  /** 与对手打平的我方最高报价（null = 任意价都赢/都输，见 note） */
  breakEvenPriceCad: number | null;
  breakEvenNoteZh: string;
  ourOtherPts: number;
  competitorOtherPts: number;
  assumptionsZh: string[];
};

const NEUTRAL_PCT = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 价格项得分（分值单位 = 百分点） */
export function priceScore(
  model: Pick<ScoringModel, "priceWeightPct" | "costFormula">,
  price: number,
  competitorPrice: number,
): { ours: number; competitor: number } {
  const W = model.priceWeightPct;
  if (!(price > 0) || !(competitorPrice > 0) || !(W >= 0)) {
    return { ours: 0, competitor: 0 };
  }
  const lowest = Math.min(price, competitorPrice);
  const f = model.costFormula === "linear_gap" ? "linear_gap" : "lowest_over_bid";
  const score = (p: number) => {
    if (f === "linear_gap") return W * Math.max(0, 1 - (p - lowest) / lowest);
    return W * (lowest / p);
  };
  return { ours: round2(score(price)), competitor: round2(score(competitorPrice)) };
}

export function otherPoints(
  model: Pick<ScoringModel, "otherCriteria">,
  side: "ours" | "competitor",
): { pts: number; assumptionsZh: string[] } {
  const assumptionsZh: string[] = [];
  let pts = 0;
  for (const c of model.otherCriteria) {
    const raw = side === "ours" ? c.ourPct : c.competitorPct;
    const pct = raw ?? NEUTRAL_PCT;
    if (raw == null) {
      assumptionsZh.push(
        `「${c.nameZh}」${side === "ours" ? "我方" : "对手"}得分率未知，按 ${NEUTRAL_PCT}% 中性假设`,
      );
    }
    pts += (c.weightPct * pct) / 100;
  }
  return { pts: round2(pts), assumptionsZh };
}

/**
 * 打平价：使 我方总分 = 对手总分 的我方报价（仅 lowest_over_bid / unknown 口径）。
 * gap = 对手其它项分 − 我方其它项分（>0 = 我们在非价格项落后，必须更便宜）。
 */
export function breakEvenPrice(
  model: Pick<ScoringModel, "priceWeightPct" | "costFormula" | "otherCriteria">,
  competitorPrice: number,
): { price: number | null; noteZh: string } {
  const W = model.priceWeightPct;
  if (!(competitorPrice > 0) || !(W > 0)) {
    return { price: null, noteZh: "缺少对手价或价格权重，无法计算打平价" };
  }
  const gap = otherPoints(model, "competitor").pts - otherPoints(model, "ours").pts;
  if (model.costFormula === "linear_gap") {
    // P>C: W(1-(P-C)/C) + O_us = W + O_c → P = C(1 - gap/W)（gap<0 时 P>C）
    // P<C: W + O_us = W(1-(C-P)/P)... 非线性，退化为数值解
    if (gap <= 0) {
      const p = competitorPrice * (1 - gap / W);
      return { price: round2(p), noteZh: "线性差额公式：我方非价格项领先，可高于对手价至此仍打平" };
    }
    // 数值求解 P<C
    let lo = competitorPrice * 0.01;
    let hi = competitorPrice;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const s = priceScore({ priceWeightPct: W, costFormula: "linear_gap" }, mid, competitorPrice);
      const delta = s.ours - s.competitor - gap;
      if (delta > 0) lo = mid;
      else hi = mid;
    }
    return { price: round2((lo + hi) / 2), noteZh: "线性差额公式：我方非价格项落后，须低于对手价至此才打平" };
  }
  // lowest_over_bid / unknown
  if (gap <= 0) {
    // 我方非价格项不落后：可高于对手价。P>C: W·C/P + O_us = W + O_c → P = W·C/(W + gap)
    const denom = W + gap;
    if (denom <= 0) {
      return { price: null, noteZh: "我方非价格项领先超过价格项满分，任何报价都不会输在总分上（请复核模型假设）" };
    }
    return {
      price: round2((W * competitorPrice) / denom),
      noteZh:
        gap === 0
          ? "非价格项双方持平：打平价 = 对手价（高一分钱就输）"
          : "我方非价格项领先：可高于对手价至此仍总分打平",
    };
  }
  // 我方落后：必须更便宜。P<C: W + O_us = W·P/C + O_c → P = C·(W − gap)/W
  const p = (competitorPrice * (W - gap)) / W;
  if (p <= 0) {
    return { price: null, noteZh: "非价格项落后幅度超过价格项满分，价格无法追平（需改善非价格项或 teaming）" };
  }
  return { price: round2(p), noteZh: "我方非价格项落后：须低于对手价至此才能总分打平" };
}

export function buildScenarios(model: ScoringModel, inputs: PricingInputs): PricingResult {
  const assumptionsZh: string[] = [];
  const C = inputs.competitorPriceCad;
  const K = inputs.ourCostCad;
  const m = inputs.targetMarginPct;
  const ourOther = otherPoints(model, "ours");
  const compOther = otherPoints(model, "competitor");
  assumptionsZh.push(...ourOther.assumptionsZh, ...compOther.assumptionsZh);
  if (model.costFormula === "unknown") {
    assumptionsZh.push("文件未明确成本评分公式，按「最低价/本标价」等比例口径假设");
  }
  if (model.source !== "HUMAN") {
    assumptionsZh.push("评分模型为自动推导（AI_INFERRED/启发式），权重与公式请对照文件人工确认");
  }
  if (!(C && C > 0)) {
    return {
      scenarios: [],
      breakEvenPriceCad: null,
      breakEvenNoteZh: "缺少对手/现任价格假设——请填入或等待价格带对标",
      ourOtherPts: ourOther.pts,
      competitorOtherPts: compOther.pts,
      assumptionsZh,
    };
  }
  const be = breakEvenPrice(model, C);
  const margin = (p: number) => (K && K > 0 ? round2(((p - K) / p) * 100) : null);
  const mk = (key: string, labelZh: string, price: number, noteZh: string): Scenario => {
    const s = priceScore(model, price, C);
    const ourTotal = round2(s.ours + ourOther.pts);
    const competitorTotal = round2(s.competitor + compOther.pts);
    return {
      key,
      labelZh,
      priceCad: round2(price),
      ourPriceScore: s.ours,
      competitorPriceScore: s.competitor,
      ourTotal,
      competitorTotal,
      deltaPts: round2(ourTotal - competitorTotal),
      marginPct: margin(price),
      noteZh,
    };
  };
  const scenarios: Scenario[] = [
    mk("match", "跟价（= 对手价）", C, "价格项双方同分，胜负全看非价格项"),
    mk("under5", "让价 5%", C * 0.95, "小幅让价，换取价格项领先"),
    mk("under10", "让价 10%", C * 0.9, "中幅让价"),
    mk("under15", "让价 15%", C * 0.85, "大幅让价——核对毛利"),
  ];
  if (be.price != null) {
    scenarios.push(mk("breakeven", "打平价", be.price, be.noteZh));
  }
  if (K && K > 0 && m != null && m >= 0 && m < 100) {
    const floor = K / (1 - m / 100);
    scenarios.push(mk("floor", `成本 + 目标毛利 ${m}%`, floor, "我方成本底线（低于此价即亏目标毛利）"));
  } else if (K && K > 0) {
    scenarios.push(mk("cost", "成本价（零毛利）", K, "绝对底线"));
  } else {
    assumptionsZh.push("未填我方成本——毛利列为空；成本底价情景未生成");
  }
  scenarios.sort((a, b) => b.priceCad - a.priceCad);
  return {
    scenarios,
    breakEvenPriceCad: be.price,
    breakEvenNoteZh: be.noteZh,
    ourOtherPts: ourOther.pts,
    competitorOtherPts: compOther.pts,
    assumptionsZh,
  };
}
