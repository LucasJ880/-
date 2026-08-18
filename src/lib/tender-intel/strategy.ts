/**
 * 情报自动流（包6）— AI 投标策略自动合成（第 7 槽位）
 *
 * 输入 = 本项目分析摘要 + 组织级授标情报七域投影（权威/推断分级已由投影层完成）。
 * 输出 = 中文策略建议（AI_INFERRED 标签，人审语义，绝不自动决策）。
 * 证据纪律与 M2.5 同款：只能基于提供的输入推断；数据不足就明说；
 * 绝不发明历史事实/金额；每条要点标注依据来自哪个情报域。
 */

import { z } from "zod";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import type { deriveAwardIntelligence } from "./award-intelligence";

export const BID_STRATEGY_AUTO_VERSION = "tender-bid-strategy-auto/v1" as const;
export const BID_STRATEGY_PROMPT = { name: "tender-bid-strategy-auto", version: "1" } as const;

const zh = (max: number) =>
  z.preprocess((v) => {
    if (v != null && typeof v === "object") {
      v = (Array.isArray(v) ? v : Object.values(v))
        .filter((x) => typeof x === "string")
        .join(" ");
    }
    return String(v ?? "").slice(0, max);
  }, z.string().min(1));

export const bidStrategyAutoSchema = z.object({
  strategyZh: zh(800),
  keyPoints: z
    .array(
      z.object({
        pointZh: zh(300),
        /** 依据的情报域（historical_awards / competitors / pricing / buyer / cycle / analysis） */
        basedOn: zh(60),
      }),
    )
    .max(6)
    .default([])
    .catch([]),
  dataGapsZh: zh(400),
});
export type BidStrategyAutoLlm = z.infer<typeof bidStrategyAutoSchema>;

export type BidStrategyAutoV1 = BidStrategyAutoLlm & {
  version: typeof BID_STRATEGY_AUTO_VERSION;
  label: "AI_INFERRED";
  generatedAt: string;
  model: string | null;
};

const SYSTEM_PROMPT = `You are a bid strategy analyst for the BIDDER (a Canadian supplier). You receive (a) a summary of the current tender, (b) the organization's award-intelligence projection (historical awards, buyer patterns, competitor signals, pricing — each item graded CONFIRMED/SUPPORTED/INFERRED/UNKNOWN).

TASK: produce a Simplified Chinese bid strategy suggestion the bid manager can read directly.

HARD RULES:
1. Base every point ONLY on the provided inputs. Never invent history, amounts, competitors or win rates.
2. Each keyPoint must name which intelligence domain it is based on (basedOn).
3. Treat UNKNOWN domains as data gaps — list them in dataGapsZh with what action would fill them (e.g. 确认外部候选 / 标记历史结果), do NOT guess around them.
4. This is a suggestion for human review, not a decision. No GO/NO-GO verdicts.
5. Output ONE valid JSON object. All *Zh fields in Simplified Chinese (proper nouns stay original).`;

export async function synthesizeBidStrategyAuto(input: {
  projectOneLiner: string | null;
  analystBriefZh: string | null;
  intelligence: ReturnType<typeof deriveAwardIntelligence>;
  invoker?: LlmInvoker;
}): Promise<{ strategy: BidStrategyAutoV1 | null; errorCode: string | null }> {
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const userPrompt = [
    `CURRENT TENDER: ${input.projectOneLiner ?? "(unknown)"}`,
    input.analystBriefZh ? `ANALYST BRIEF (zh): ${input.analystBriefZh.slice(0, 1200)}` : "",
    "",
    "ORG AWARD INTELLIGENCE PROJECTION:",
    JSON.stringify({
      basis: input.intelligence.basis,
      historicalAwards: {
        status: input.intelligence.historicalAwards.status,
        records: input.intelligence.historicalAwards.records.slice(0, 8),
      },
      buyerPattern: {
        status: input.intelligence.buyerPattern.status,
        buyers: input.intelligence.buyerPattern.buyers.slice(0, 5),
      },
      competitorSignals: input.intelligence.competitorSignals,
      historicalValues: input.intelligence.historicalValues,
      comparablePricing: input.intelligence.comparablePricing,
    }),
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callStructured(
    invoker,
    {
      promptName: BID_STRATEGY_PROMPT.name,
      promptVersion: BID_STRATEGY_PROMPT.version,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 4_000,
      timeoutMs: 120_000,
    },
    bidStrategyAutoSchema,
  );
  if (!res.ok) return { strategy: null, errorCode: res.errorCode };
  return {
    strategy: {
      ...res.value,
      version: BID_STRATEGY_AUTO_VERSION,
      label: "AI_INFERRED",
      generatedAt: new Date().toISOString(),
      model: res.logs.find((l) => l.ok)?.model ?? null,
    },
    errorCode: null,
  };
}
