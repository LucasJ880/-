/**
 * Tender RFQ（P1-6）— 比价矩阵（纯函数，零 IO、零 AI）
 *
 *   buildCompareMatrix：每家落地价（landed-cost.normalizeQuote 的结果）+ §2.4 合规检查 → 排序、标记、推荐、一句话结论
 *   summarizeMatrixZh ：结论由代码拼，不走 LLM；不出现"毛利 / 利润"字样（出 Muse 前还会过 sanitizeOutbound strict）
 *   projectScenariosForMuse：buildScenarios 的结果投影成 Muse 可见字段——价格分、总分差、打平价、供应商落地价（决定 A），
 *                            丢掉 marginPct / noteZh / assumptionsZh
 *   buildMatrixInterpretationPrompt：/compare/analysis 的 LLM 只拿矩阵写解读，不碰原始行、不算数
 */

import {
  evaluateQuoteChecks,
  type NormalizedQuote,
  type QuoteChecks,
  type TenderTimeline,
} from "./landed-cost";
import { otherPoints, priceScore, type PricingResult, type ScoringModel } from "@/lib/tender-pricing/calc";

/* ---------------------------------- 类型 ---------------------------------- */

export type CompareFlag =
  | "cheapest"
  | "fully_compliant"
  | "delivery_late"
  | "validity_short"
  | "moq_unmet"
  | "mandatory_gap"
  | "missing_fields"
  | "not_normalized";

export type QuotedFields = {
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
  incoterm: string | null;
  moq: number | null;
  deliveryDays: number | null;
  validUntil: string | null; // YYYY-MM-DD
};

export type CompareInput = {
  itemId: string;
  supplierId: string;
  supplierName: string;
  quoted: QuotedFields;
  /** 回信日期（InquiryItem.repliedAt），交期从这天起算 */
  emailDate: Date | null;
  mandatoryAnswers: Array<{ requirementCode: string; answer: string }>;
  normalized: NormalizedQuote;
};

export type CompareRow = {
  itemId: string;
  supplierId: string;
  supplierName: string;
  quoted: QuotedFields;
  landedCad: { unit: number | null; total: number | null };
  checks: QuoteChecks;
  flags: CompareFlag[];
  /** 交期超出截止天数 / 有效期早于截标天数（用于结论，不超出则 null） */
  deliveryLateDays: number | null;
  validityShortDays: number | null;
  missingFields: Array<"price" | "deliveryDays" | "validUntil" | "incoterm">;
  assumptions: string[];
  warnings: string[];
  blockers: string[];
};

export type CompareMatrix = {
  rows: CompareRow[];
  cheapestItemId: string | null;
  recommendedItemId: string | null;
  summaryZh: string;
  generatedAt: string;
};

export type CompareTender = TenderTimeline & { now?: Date };

/* ---------------------------------- 矩阵 ---------------------------------- */

/**
 * 全合规：交期 / 有效期 / 强制项必须为 true；起订量 unknown 不算不合规（§2.4"没 MOQ → unknown（不算不合规）"），
 * 只有明确超出（false）才挡——否则没写 MOQ 的供应商（大多数）永远不可能被推荐。
 */
export function isFullyCompliant(c: QuoteChecks): boolean {
  return c.deliveryOk === true && c.validityOk === true && c.mandatoryOk === true && c.moqOk !== false;
}

export function buildCompareMatrix(inputs: CompareInput[], tender: CompareTender): CompareMatrix {
  const rows: CompareRow[] = inputs.map((q) => {
    const c = evaluateQuoteChecks(
      { emailDate: q.emailDate, deliveryDays: q.quoted.deliveryDays, validUntil: q.quoted.validUntil, moq: q.quoted.moq, mandatoryAnswers: q.mandatoryAnswers },
      tender,
    );
    const missingFields: CompareRow["missingFields"] = [];
    if (q.quoted.unitPrice == null && q.quoted.totalPrice == null) missingFields.push("price");
    if (q.quoted.deliveryDays == null) missingFields.push("deliveryDays");
    if (!q.quoted.validUntil) missingFields.push("validUntil");
    if (!q.quoted.incoterm) missingFields.push("incoterm");

    const flags: CompareFlag[] = [];
    if (isFullyCompliant(c.checks)) flags.push("fully_compliant");
    if (c.checks.deliveryOk === false) flags.push("delivery_late");
    if (c.checks.validityOk === false) flags.push("validity_short");
    if (c.checks.moqOk === false) flags.push("moq_unmet");
    if (c.checks.mandatoryOk === false || c.checks.mandatoryOk === "partial") flags.push("mandatory_gap");
    if (missingFields.length) flags.push("missing_fields");
    if (q.normalized.landedCad.total == null) flags.push("not_normalized");

    return {
      itemId: q.itemId,
      supplierId: q.supplierId,
      supplierName: q.supplierName,
      quoted: q.quoted,
      landedCad: q.normalized.landedCad,
      checks: c.checks,
      flags,
      deliveryLateDays: c.deliveryLateDays,
      validityShortDays: c.validityShortDays,
      missingFields,
      assumptions: [...q.normalized.assumptions, ...c.assumptions],
      warnings: q.normalized.warnings,
      blockers: q.normalized.blockers,
    };
  });

  // 排序：有落地总价的按升序；换算不出来的排最后（同组按名称，结果稳定）
  rows.sort((a, b) => {
    const x = a.landedCad.total;
    const y = b.landedCad.total;
    if (x != null && y != null && x !== y) return x - y;
    if (x != null && y == null) return -1;
    if (x == null && y != null) return 1;
    return a.supplierName.localeCompare(b.supplierName);
  });

  const cheapest = rows.find((r) => r.landedCad.total != null) ?? null;
  if (cheapest) cheapest.flags.unshift("cheapest");
  // 推荐 = 最便宜的全合规（四项 checks 全为 true，且能换算出落地价）；绝不自动 isSelected
  const recommended = rows.find((r) => r.landedCad.total != null && r.flags.includes("fully_compliant")) ?? null;

  const base = { rows, cheapestItemId: cheapest?.itemId ?? null, recommendedItemId: recommended?.itemId ?? null };
  return {
    ...base,
    summaryZh: summarizeMatrixZh({ ...base, firstTierQty: tender.firstTierQty }),
    generatedAt: (tender.now ?? new Date()).toISOString(),
  };
}

/* ---------------------------------- 结论（代码拼，≤300 字） ---------------------------------- */

const SUMMARY_MAX = 300;
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const short = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s);

/** 一行为什么不推荐（按严重程度） */
export function rowProblemsZh(r: CompareRow, firstTierQty: number | null): string[] {
  const out: string[] = [];
  if (r.landedCad.total == null) out.push(`未能换算落地价（${r.blockers[0] ?? "参数不全"}）`);
  if (r.checks.deliveryOk === false) out.push(`交期超出交付截止 ${r.deliveryLateDays ?? "?"} 天`);
  if (r.checks.validityOk === false) out.push(`有效期比截标日早 ${r.validityShortDays ?? "?"} 天`);
  if (r.checks.moqOk === false) out.push(`起订量 ${r.quoted.moq} 高于询价数量 ${firstTierQty ?? "?"}`);
  if (r.checks.mandatoryOk === false) out.push("有强制项不满足");
  else if (r.checks.mandatoryOk === "partial") out.push("有强制项未答复");
  const unknown: string[] = [];
  if (r.checks.deliveryOk === "unknown") unknown.push("交期");
  if (r.checks.validityOk === "unknown") unknown.push("有效期");
  if (unknown.length) out.push(`${unknown.join("、")}待确认`);
  return out;
}

export function summarizeMatrixZh(m: {
  rows: CompareRow[];
  cheapestItemId: string | null;
  recommendedItemId: string | null;
  firstTierQty: number | null;
}): string {
  if (m.rows.length === 0) return "还没有报价入表。";
  const byId = new Map(m.rows.map((r) => [r.itemId, r]));
  const cheapest = m.cheapestItemId ? byId.get(m.cheapestItemId)! : null;
  const rec = m.recommendedItemId ? byId.get(m.recommendedItemId)! : null;
  const parts: string[] = [`共 ${m.rows.length} 家报价（落地价，CAD，到目的地含税）。`];

  if (rec) {
    parts.push(`推荐 ${short(rec.supplierName)}：落地价 ${money(rec.landedCad.total!)}，交期、有效期、强制项、起订量检查均通过${rec.checks.moqOk === "unknown" ? "（起订量未注明）" : ""}。`);
    if (cheapest && cheapest.itemId !== rec.itemId) {
      const pct = ((rec.landedCad.total! - cheapest.landedCad.total!) / cheapest.landedCad.total!) * 100;
      const why = rowProblemsZh(cheapest, m.firstTierQty);
      parts.push(`最低价 ${short(cheapest.supplierName)}（${money(cheapest.landedCad.total!)}）未推荐：${why.join("，") || "检查未全部通过"}；${short(rec.supplierName)} 贵 ${pct.toFixed(1)}%。`);
    }
  } else {
    parts.push("没有交期、有效期、强制项、起订量检查均通过的报价，暂不推荐。");
    const listed = m.rows.slice(0, 3).map((r) => `${short(r.supplierName)}${r.landedCad.total != null ? `（${money(r.landedCad.total)}）` : ""}：${rowProblemsZh(r, m.firstTierQty).join("，") || "检查未全部通过"}`);
    parts.push(`${listed.join("；")}。`);
  }

  const notNormalized = m.rows.filter((r) => r.landedCad.total == null);
  if (notNormalized.length && (rec || m.rows.length > 3)) {
    const only = notNormalized.length === 1 ? notNormalized[0] : null;
    parts.push(only
      ? `另有 ${short(only.supplierName)} 未能换算落地价（${only.blockers[0] ?? "参数不全"}）。`
      : `另有 ${notNormalized.length} 家未能换算落地价。`);
  }

  const s = parts.join("");
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

/* ---------------------------------- price_scenario 投影（Muse 脱敏） ---------------------------------- */

export type MuseScenario = { labelZh: string; priceCad: number; ourPriceScore: number; deltaPts: number; belowCostZh?: string };

export type MusePricingView = {
  scenarios: MuseScenario[];
  breakEvenPriceCad: number | null;
  breakEvenNoteZh: string;
  candidate: MuseScenario | null;
  /** 所选供应商的落地价（决定 A：允许出 Muse；毛利率 / 项目估值 / 我方最终报价仍不出） */
  landedCostCad: number | null;
};

/** 以落地价为底的情景：Muse 里统一叫"成本线" */
const COST_LINE_SCENARIOS = new Set(["floor", "cost"]);
export const MUSE_COST_LINE_LABEL = "所选供应商落地价（成本线）";

const fmtCad = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * 只留价格分、总分差、打平价、落地价；显式逐字段拷贝（不展开原对象），marginPct 不可能漏出。
 * noteZh / assumptionsZh 不出（里面有"毛利"字样）。
 * 候选价低于落地价 → candidate.belowCostZh 写明会亏。
 */
export function projectScenariosForMuse(result: PricingResult, candidate: MuseScenario | null, landedCostCad: number | null = null): MusePricingView {
  const cost = landedCostCad != null && Number.isFinite(landedCostCad) && landedCostCad > 0 ? landedCostCad : null;
  const cand: MuseScenario | null = candidate
    ? {
        labelZh: candidate.labelZh,
        priceCad: candidate.priceCad,
        ourPriceScore: candidate.ourPriceScore,
        deltaPts: candidate.deltaPts,
        ...(cost != null && candidate.priceCad < cost ? { belowCostZh: `低于该供应商落地价 ${fmtCad(cost)}，会亏` } : {}),
      }
    : null;
  return {
    scenarios: result.scenarios.map((s) => ({
      labelZh: COST_LINE_SCENARIOS.has(s.key) ? MUSE_COST_LINE_LABEL : s.labelZh,
      priceCad: s.priceCad,
      ourPriceScore: s.ourPriceScore,
      deltaPts: s.deltaPts,
    })),
    breakEvenPriceCad: result.breakEvenPriceCad,
    breakEvenNoteZh: result.breakEvenNoteZh,
    candidate: cand,
    landedCostCad: cost,
  };
}

/** 用户给的候选价 → 价格分 / 总分差（与 buildScenarios 同一套公式；不涉及我方成本） */
export function scoreCandidatePrice(model: ScoringModel, priceCad: number, competitorPriceCad: number): MuseScenario {
  const s = priceScore(model, priceCad, competitorPriceCad);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const ourTotal = round2(s.ours + otherPoints(model, "ours").pts);
  const competitorTotal = round2(s.competitor + otherPoints(model, "competitor").pts);
  return { labelZh: "你给的价", priceCad: round2(priceCad), ourPriceScore: s.ours, deltaPts: round2(ourTotal - competitorTotal) };
}

/* ---------------------------------- /compare/analysis 的 LLM 输入（只给矩阵） ---------------------------------- */

export function buildMatrixInterpretationPrompt(
  matrix: CompareMatrix,
  ctx: { projectName: string; roundNumber: number; closeDate: string | null },
): { systemPrompt: string; userPrompt: string } {
  const rows = matrix.rows.map((r) => ({
    supplier: r.supplierName,
    landedCadTotal: r.landedCad.total,
    landedCadUnit: r.landedCad.unit,
    quotedCurrency: r.quoted.currency,
    incoterm: r.quoted.incoterm,
    deliveryDays: r.quoted.deliveryDays,
    validUntil: r.quoted.validUntil,
    moq: r.quoted.moq,
    checks: r.checks,
    flags: r.flags,
    warnings: r.warnings,
    blockers: r.blockers,
  }));
  const systemPrompt = `你是采购比价助手。下面是青砚已经用代码算好的比价矩阵（落地价 = CAD，货到目的地含关税）。
你的工作只是"解读"：用中文说明价格差异、交期与有效期风险、需要追问供应商的点。

硬规则：
- 不得计算、换算或给出矩阵里没有的任何数字；引用数字时必须与矩阵完全一致。
- 不得改变推荐结论：推荐供应商已由代码确定（见 recommended），你只解释原因。
- 换算不出落地价的供应商（not_normalized），只说明缺什么参数，不要估算。

只输出 JSON：{"priceAnalysis": "...", "deliveryAnalysis": "...", "risks": "...", "recommendation": "..."}`;
  const recommended = matrix.recommendedItemId ? matrix.rows.find((r) => r.itemId === matrix.recommendedItemId)?.supplierName ?? null : null;
  const userPrompt = JSON.stringify(
    {
      project: ctx.projectName,
      round: ctx.roundNumber,
      closeDate: ctx.closeDate,
      recommended,
      summary: matrix.summaryZh,
      rows,
    },
    null,
    1,
  );
  return { systemPrompt, userPrompt };
}
