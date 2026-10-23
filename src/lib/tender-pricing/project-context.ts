/**
 * 报价表助手的项目上下文（从 pricing-helper 路由抽出，供 Muse price_scenario 复用同一份口径）
 *
 * 评分模型：人工覆盖 > 已推导（room.summaryJson.pricingModel）> 即时启发式（分析事实里的评分条款）
 * 对手价：人工填的 pricingInputs.competitorPriceCad > 情报价格带（现任线索 / 联邦合同对标）中位数
 */

import { db } from "@/lib/db";
import { PRICING_MODEL_VERSION, type PricingInputs, type ScoringModel } from "./calc";
import { EVAL_FACT_PATTERN, heuristicScoringModel } from "./derive";

export const PRICING_INPUTS_KEY = "pricingInputs";
export const PRICING_MODEL_KEY = "pricingModel";
export const PRICING_DERIVE_AT_KEY = "pricingDerivedAt";
export const PRICING_DERIVE_RATE_WINDOW_MS = 60_000;

export async function latestPricingRun(projectId: string) {
  return db.tenderAnalysisRun.findFirst({
    where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, summaryJson: true },
  });
}

export async function pricingEvalTexts(runId: string, summaryJson: unknown): Promise<string[]> {
  const facts = await db.tenderAnalysisFact.findMany({
    where: { runId },
    select: { contentOriginal: true, contentZh: true },
    take: 300,
  });
  const out: string[] = [];
  const cf = ((summaryJson as Record<string, unknown> | null)?.criticalFacts ?? {}) as Record<
    string,
    { status?: string; text?: string | null }
  >;
  const ec = cf.evaluation_criteria;
  if (ec && typeof ec === "object" && ec.status === "KNOWN" && ec.text) out.push(ec.text);
  for (const f of facts) {
    const original = f.contentOriginal ?? "";
    const zh = f.contentZh ?? "";
    const text = original || zh;
    if (text && (EVAL_FACT_PATTERN.test(original) || EVAL_FACT_PATTERN.test(zh))) {
      out.push(text);
    }
  }
  return out;
}

export function readPricingBenchmark(sj: Record<string, unknown>) {
  const lead = (sj.incumbentLead ?? null) as {
    vendor?: string;
    priceBandCad?: { low?: number; high?: number; noteZh?: string };
  } | null;
  const vb = (sj.vendorPriceBenchmark ?? null) as {
    vendor?: string;
    median?: number | null;
    min?: number | null;
    max?: number | null;
    sampleSize?: number;
  } | null;
  const low = lead?.priceBandCad?.low ?? vb?.min ?? null;
  const high = lead?.priceBandCad?.high ?? vb?.max ?? null;
  const median = vb?.median ?? (low != null && high != null ? Math.round((low + high) / 2) : null);
  return {
    vendor: lead?.vendor ?? vb?.vendor ?? null,
    low,
    high,
    median,
    sampleSize: vb?.sampleSize ?? null,
    noteZh: lead?.priceBandCad?.noteZh ?? null,
    source: lead ? "incumbent_lead" : vb ? "federal_contracts" : null,
  };
}

export function isScoringModel(x: unknown): x is ScoringModel {
  return (
    !!x &&
    typeof x === "object" &&
    (x as ScoringModel).version === PRICING_MODEL_VERSION &&
    typeof (x as ScoringModel).priceWeightPct === "number"
  );
}

export type PricingBenchmark = ReturnType<typeof readPricingBenchmark>;

export type ProjectPricingContext = {
  runId: string | null;
  model: ScoringModel | null;
  modelOrigin: "HUMAN" | "AI_INFERRED" | "HEURISTIC" | "NONE";
  benchmark: PricingBenchmark;
  /** 已保存的人工输入（未回退） */
  saved: Partial<PricingInputs>;
};

/** 与 pricing-helper GET 同一取数顺序 */
export async function loadProjectPricingContext(projectId: string): Promise<ProjectPricingContext> {
  const run = await latestPricingRun(projectId);
  const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true } });
  const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  let model: ScoringModel | null = isScoringModel(sj[PRICING_MODEL_KEY]) ? (sj[PRICING_MODEL_KEY] as ScoringModel) : null;
  let modelOrigin: ProjectPricingContext["modelOrigin"] = model ? model.source : "NONE";
  if (!model && run) {
    model = heuristicScoringModel(await pricingEvalTexts(run.id, run.summaryJson));
    modelOrigin = model ? "HEURISTIC" : "NONE";
  }
  return {
    runId: run?.id ?? null,
    model,
    modelOrigin,
    benchmark: readPricingBenchmark(sj),
    saved: (sj[PRICING_INPUTS_KEY] ?? {}) as Partial<PricingInputs>,
  };
}
