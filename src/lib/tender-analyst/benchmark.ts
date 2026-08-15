/**
 * FB-13 — 历史项目对标（Tender Benchmark）
 *
 * 输入：当前项目与历史项目各自的 analystSynthesis（同一 Grounding+Analyst 管线产物）
 *       + 历史项目真实结果（中标方/中标价，用户人工录入——AI 不发明商业数据）。
 * 输出：多维对比（要求/体量/时间/技术/商务）+ 推荐目标价区间（基于历史中标价
 *       按已记录差异调整，给理由与置信度；参考建议，非最终报价）。
 * 存储：当前项目最新 run summaryJson.benchmark（SCHEMA=NONE）。
 */

import { z } from "zod";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import type { TenderAnalystSynthesisV1 } from "./contract";

export const TENDER_BENCHMARK_VERSION = "tender-benchmark/v1" as const;
export const BENCHMARK_PROMPT = { name: "tender-benchmark", version: "1" } as const;

const zh = (max: number) => z.string().min(1).max(max);

export const benchmarkLlmSchema = z.object({
  similaritySummaryZh: zh(500),
  dimensions: z
    .array(
      z.object({
        dimensionZh: zh(40),
        currentZh: zh(300),
        historicalZh: zh(300),
        differenceZh: zh(300),
        pricingImpactZh: zh(200),
      }),
    )
    .min(3)
    .max(10),
  keyDifferences: z.array(zh(240)).max(8).default([]),
  pricingInsight: z.object({
    adjustmentsZh: z.array(zh(240)).max(8).default([]),
    recommendedTargetPriceLow: z.number().nullable(),
    recommendedTargetPriceHigh: z.number().nullable(),
    rationaleZh: zh(600),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  }),
  caveatsZh: z.array(zh(240)).max(6).default([]),
});
export type BenchmarkLlmOutput = z.infer<typeof benchmarkLlmSchema>;

export type HistoricalOutcome = {
  projectName: string;
  winnerName: string | null;
  winningBidPrice: number | null;
  ourBidPrice: number | null;
  currency: string | null;
  awardDate: string | null;
  tenderStatus: string | null;
};

export type TenderBenchmarkV1 = BenchmarkLlmOutput & {
  version: typeof TENDER_BENCHMARK_VERSION;
  historicalProjectId: string;
  outcome: HistoricalOutcome;
  generatedAt: string;
  model: string | null;
};

const SYSTEM_PROMPT = `You are a senior bid manager comparing the CURRENT tender with ONE historical tender the bidder tracked (with its real award outcome, entered by the user).

RULES:
1. Output Simplified Chinese for all *Zh fields (proper nouns / tender numbers / standards keep original).
2. Compare ONLY from the provided analyses and outcome data. If a dimension cannot be compared from the data, say 无法从现有资料比较 — never guess.
3. Cover at least: 项目要求 (scope/requirements), 体量 (volume/quantities), 时间 (schedule/term), 技术门槛, 商务条款. Add more dimensions when the data supports them.
4. pricingInsight: start from the historical winning price (in outcome), adjust for the DOCUMENTED differences (volume, scope, term, technical burden, delivery). Give a recommended target price RANGE (same currency as historical outcome) with explicit adjustment reasoning. If the historical price or the data is insufficient for a defensible number, set both numbers to null and explain why in rationaleZh.
5. This is 参考建议 (reference guidance), not a final quote — reflect that in caveatsZh (e.g. 未包含企业内部成本/汇率/供应链因素).
6. Output ONE valid JSON object only.`;

function compact(syn: TenderAnalystSynthesisV1): Record<string, unknown> {
  return {
    executiveBrief: syn.executiveBrief,
    scope: syn.scope,
    keyRequirements: syn.keyRequirements.map((k) => ({
      titleZh: k.titleZh,
      impact: k.impact,
      phase: k.phase,
    })),
    technicalRequirements: syn.technicalRequirements.map((k) => k.titleZh),
    commercialAndDelivery: syn.commercialAndDelivery.map((k) => k.titleZh),
    risks: syn.risksAndGaps.map((r) => `${r.severity}:${r.titleZh}`),
    assessment: syn.currentAssessment,
  };
}

export async function runTenderBenchmark(input: {
  current: TenderAnalystSynthesisV1;
  historical: TenderAnalystSynthesisV1;
  historicalProjectId: string;
  outcome: HistoricalOutcome;
  invoker?: LlmInvoker;
}): Promise<{ benchmark: TenderBenchmarkV1 | null; errorCode: string | null }> {
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const userPrompt = [
    "CURRENT TENDER ANALYSIS:",
    JSON.stringify(compact(input.current)),
    "",
    "HISTORICAL TENDER ANALYSIS:",
    JSON.stringify(compact(input.historical)),
    "",
    "HISTORICAL OUTCOME (user-entered, authoritative):",
    JSON.stringify(input.outcome),
  ].join("\n");
  const res = await callStructured(
    invoker,
    {
      promptName: BENCHMARK_PROMPT.name,
      promptVersion: BENCHMARK_PROMPT.version,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 8_000,
      timeoutMs: 180_000,
    },
    benchmarkLlmSchema,
  );
  if (!res.ok) return { benchmark: null, errorCode: res.errorCode };
  return {
    benchmark: {
      ...res.value,
      version: TENDER_BENCHMARK_VERSION,
      historicalProjectId: input.historicalProjectId,
      outcome: input.outcome,
      generatedAt: new Date().toISOString(),
      model: res.logs.find((l) => l.ok)?.model ?? null,
    },
    errorCode: null,
  };
}

export function readTenderBenchmark(summaryJson: unknown): TenderBenchmarkV1 | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const raw = (summaryJson as Record<string, unknown>).benchmark;
  if (!raw || typeof raw !== "object") return null;
  if ((raw as Record<string, unknown>).version !== TENDER_BENCHMARK_VERSION) return null;
  return raw as TenderBenchmarkV1;
}
