/**
 * 报价表助手 · 评分模型推导
 *
 * 两层：① 启发式（零模型花费，正则抓「Cost 70%」「lowest cost/other cost」等）；
 * ② LLM 结构化（仅在手动「重新推导」时调用，文档接地：只喂评分/价格相关事实原文，
 *    数字逐字，未知留 null）。人工覆盖（source=HUMAN）永远最高优先。
 * 模型是 AI_INFERRED 人审语义：卡片显式标注，计算层把它写进假设。
 */

import { z } from "zod";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import {
  PRICING_MODEL_VERSION,
  type CostFormula,
  type ScoringCriterion,
  type ScoringModel,
} from "./calc";

export const PRICING_DERIVE_PROMPT = {
  name: "tender-pricing-model-derive",
  version: "1",
} as const;

/** 评分/价格相关事实过滤（英文原文 + 中文译文都扫） */
export const EVAL_FACT_PATTERN =
  /(points?|%|percent|weight|scor|evaluat|lowest|price|cost|评分|权重|分值|最低价|价格)/i;

const nameZhOf = (name: string): string => {
  const n = name.toLowerCase();
  if (/social/.test(n)) return "社会价值";
  if (/performance/.test(n)) return "绩效评估";
  if (/origin|national/.test(n)) return "原产地/国籍";
  if (/technical|quality/.test(n)) return "技术/质量";
  if (/experience|reference/.test(n)) return "经验/业绩";
  if (/schedule|delivery/.test(n)) return "进度/交付";
  return name.trim();
};

const keyOf = (name: string) =>
  name.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "other";

function defaultPcts(nameZh: string, joined: string): Pick<ScoringCriterion, "ourPct" | "competitorPct" | "basisZh"> {
  if (nameZh === "绩效评估") {
    const m = joined.match(/(\d{1,3})\s*%\s*of the available points/i);
    const dflt = m ? Number(m[1]) : null;
    return {
      ourPct: dflt,
      competitorPct: null,
      basisZh: dflt != null ? `无历史绩效评估的新供应商按 ${dflt}% 计（文件）` : undefined,
    };
  }
  if (nameZh === "原产地/国籍") {
    return { ourPct: 100, competitorPct: null, basisZh: "假设我方为加拿大供应商（满分）；对手国籍未知" };
  }
  return { ourPct: null, competitorPct: null };
}

/** 启发式：从事实文本推导评分模型；抓不到价格权重 → null */
export function heuristicScoringModel(texts: readonly string[]): ScoringModel | null {
  const joined = texts.join("\n");
  const criteria: { name: string; pct: number }[] = [];
  // 权重表述：「<准则名> NN%」；负向前瞻排除「60% of the available points」
  // 「10% of the total bid score」这类非权重百分比（真实 HRM 措辞实测）
  const re = /([A-Z][A-Za-z\/&' ]{1,60}?)\s*[:\-]?\s*(\d{1,3})\s*%(?!\s*of\s+(?:the|total|available))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    const name = m[1]!
      .replace(/\b(?:and|of the|available|receive|will|shall|who|that)\b.*$/i, "")
      .trim();
    const pct = Number(m[2]);
    if (!name || name.split(/\s+/).length > 6 || pct <= 0 || pct > 100) continue;
    if (!criteria.some((c) => c.name.toLowerCase() === name.toLowerCase())) criteria.push({ name, pct });
  }
  const priceC = criteria.find((c) => /\b(cost|price|pricing|financial)\b/i.test(c.name));
  if (!priceC) return null;
  const others = criteria.filter((c) => c !== priceC && c.pct < 100);
  const sumOthers = others.reduce((s, c) => s + c.pct, 0);
  // 权重合理性：其它项之和 ≈ 100 − 价格权重（容差 5），否则只保留价格权重
  const consistent = Math.abs(sumOthers - (100 - priceC.pct)) <= 5;
  const costFormula: CostFormula = /lowest\s*cost\s*\/\s*other\s*cost|lowest\s*(?:bid|price|cost)\s*\/|prorat/i.test(joined)
    ? "lowest_over_bid"
    : /\(\s*1\s*-|minus the|difference between/i.test(joined)
      ? "linear_gap"
      : "unknown";
  const evidenceZh = texts.filter((t) => /%/.test(t) || /lowest|prorat/i.test(t)).slice(0, 6).map((t) => t.slice(0, 200));
  return {
    version: PRICING_MODEL_VERSION,
    priceWeightPct: priceC.pct,
    costFormula,
    otherCriteria: (consistent ? others : []).map((c) => {
      const nameZh = nameZhOf(c.name);
      return { key: keyOf(c.name), nameZh, weightPct: c.pct, ...defaultPcts(nameZh, joined) };
    }),
    source: "HEURISTIC",
    evidenceZh,
    derivedAt: new Date().toISOString(),
  };
}

const derivedSchema = z.object({
  priceWeightPct: z.number().min(0).max(100).nullable(),
  costFormula: z.enum(["lowest_over_bid", "linear_gap", "unknown"]),
  otherCriteria: z
    .array(
      z.object({
        name: z.string().min(1),
        weightPct: z.number().min(0).max(100),
        newSupplierDefaultPct: z.number().min(0).max(100).nullable(),
      }),
    )
    .catch([]),
  evidence: z.array(z.string()).catch([]),
});

const SYSTEM_PROMPT = `You extract the bid SCORING MODEL from tender document facts for a pricing calculator.
Rules:
- Use ONLY the provided facts. Numbers must be copied verbatim. If the price/cost weight is not stated, priceWeightPct = null.
- costFormula: "lowest_over_bid" when points = max × (lowest cost / bid cost) or "prorated against the lowest"; "linear_gap" when points decrease linearly with the % above the lowest; otherwise "unknown".
- otherCriteria: every NON-price scored criterion with its weight %. newSupplierDefaultPct = the default score % given to suppliers without prior performance history if the facts state one (e.g. "60% of the available points"), else null.
- evidence: short verbatim quotes (max 6) supporting the numbers.
Output strict JSON: {"priceWeightPct":number|null,"costFormula":"lowest_over_bid"|"linear_gap"|"unknown","otherCriteria":[{"name":string,"weightPct":number,"newSupplierDefaultPct":number|null}],"evidence":string[]}`;

export async function deriveScoringModel(
  texts: readonly string[],
  opts: { invoker?: LlmInvoker; timeoutMs?: number } = {},
): Promise<{ model: ScoringModel | null; llmCalls: number; via: "AI_INFERRED" | "HEURISTIC" | "NONE" }> {
  const relevant = texts.filter((t) => EVAL_FACT_PATTERN.test(t)).slice(0, 40);
  const heuristic = heuristicScoringModel(relevant);
  if (relevant.length === 0) return { model: null, llmCalls: 0, via: "NONE" };
  try {
    const invoker = opts.invoker ?? createUnifiedRuntimeInvoker();
    const res = await callStructured(
      invoker,
      {
        promptName: PRICING_DERIVE_PROMPT.name,
        promptVersion: PRICING_DERIVE_PROMPT.version,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: JSON.stringify({ facts: relevant.map((t) => t.slice(0, 400)) }),
        maxTokens: 6000,
        timeoutMs: opts.timeoutMs ?? 60_000,
      },
      derivedSchema,
    );
    const pw = res.ok ? res.value.priceWeightPct : null;
    if (!res.ok || pw == null) {
      return { model: heuristic, llmCalls: res.logs.length, via: heuristic ? "HEURISTIC" : "NONE" };
    }
    const v = res.value;
    const joined = relevant.join("\n");
    const model: ScoringModel = {
      version: PRICING_MODEL_VERSION,
      priceWeightPct: pw,
      costFormula: v.costFormula,
      otherCriteria: v.otherCriteria.map((c) => {
        const nameZh = nameZhOf(c.name);
        const d = defaultPcts(nameZh, joined);
        return {
          key: keyOf(c.name),
          nameZh,
          weightPct: c.weightPct,
          ourPct: c.newSupplierDefaultPct ?? d.ourPct,
          competitorPct: d.competitorPct,
          basisZh:
            c.newSupplierDefaultPct != null
              ? `无历史绩效的新供应商按 ${c.newSupplierDefaultPct}% 计（文件）`
              : d.basisZh,
        };
      }),
      source: "AI_INFERRED",
      evidenceZh: v.evidence.slice(0, 6).map((e) => e.slice(0, 200)),
      derivedAt: new Date().toISOString(),
    };
    return { model, llmCalls: res.logs.length, via: "AI_INFERRED" };
  } catch {
    return { model: heuristic, llmCalls: 1, via: heuristic ? "HEURISTIC" : "NONE" };
  }
}
