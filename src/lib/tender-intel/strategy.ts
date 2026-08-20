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


/* ══════════════ 批次一 · 投标策略备忘录 v2（文档接地深读） ══════════════
 * 对标 2026-08-20 用户提供的人工分析样本（HRM-2026-0395）：在组织投影之外
 * 接入本单 canonical 事实/强制要求/综合层/现任供应商线索，产出投标人视角的
 * 策略推理：评分演算（权重事实在场才做数学，缺席如实列缺口）、竞争格局、
 * 风险门矩阵、报价策略、策略级 RFI、teaming 建议。
 * 纪律不变：AI_INFERRED 人审语义；绝不输出整体 GO/NO-GO 裁决；
 * 不发明事实；数据缺口显式列出。 */

export const BID_STRATEGY_MEMO_VERSION = "tender-bid-strategy-memo/v2" as const;
export const BID_STRATEGY_MEMO_PROMPT = { name: "tender-bid-strategy-memo", version: "2" } as const;

const gateStatus = z.preprocess((v) => {
  const raw = String(v ?? "").trim();
  if (/满足|GREEN|OK|PASS/i.test(raw)) return "已满足";
  if (/高风险|RED|BLOCK/i.test(raw)) return "高风险";
  return "需解决";
}, z.enum(["已满足", "需解决", "高风险"]));

export const bidStrategyMemoSchema = z.object({
  summaryZh: zh(600),
  scoringAnalysisZh: zh(900),
  competitiveLandscapeZh: zh(700),
  // 逐项过滤坏条目（数组层 catch 会把形状漂移整组吞掉——E2E 实测教训）
  riskGates: z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v
            .filter((g) => String((g as { gateZh?: unknown })?.gateZh ?? "").trim())
            .slice(0, 8)
        : [],
    z.array(
      z.object({
        gateZh: zh(120),
        statusZh: gateStatus,
        basisZh: zh(300).catch("依据未给出"),
      }),
    ).default([]),
  ),
  pricingStrategyZh: zh(700),
  strategicRfis: z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v
            .filter((q) => String((q as { questionZh?: unknown })?.questionZh ?? "").trim())
            .slice(0, 8)
        : [],
    z.array(
      z.object({ questionZh: zh(300), whyZh: zh(200).catch("理由未给出") }),
    ).default([]),
  ),
  teamingAdviceZh: zh(500),
  dataGapsZh: zh(500),
});
export type BidStrategyMemoLlm = z.infer<typeof bidStrategyMemoSchema>;

export type BidStrategyMemoV2 = BidStrategyMemoLlm & {
  version: typeof BID_STRATEGY_MEMO_VERSION;
  label: "AI_INFERRED";
  generatedAt: string;
  model: string | null;
};

const MEMO_SYSTEM_PROMPT = `You are a senior bid strategist advising the BIDDER on a Canadian public-sector tender. You receive: (a) project hard facts, (b) canonical extracted facts and mandatory requirements from the tender documents, (c) the analyst synthesis, (d) org-level award intelligence, (e) an incumbent-supplier lead with evidence and a price band (may be absent).

TASK: produce a Simplified Chinese bid strategy memo a bid manager can act on.

HARD RULES:
1. Ground every claim ONLY in the provided inputs. Never invent weights, incumbents, prices or history. If evaluation weights/incumbent/price data are absent, say so in dataGapsZh instead of guessing.
2. scoringAnalysisZh: if scoring weights appear in the inputs, do the real math (e.g. price-gap needed to offset other scoring differences). If absent, state what to extract and how it would change strategy.
3. competitiveLandscapeZh: use the incumbent lead and its confidence level verbatim-honestly (e.g. 疑似, 未100%确认); cite the evidence briefly.
4. riskGates: qualification/compliance gates (references, insurance, WCB, data residency, IP, delivery SLA...) each with statusZh ∈ 已满足/需解决/高风险 and basis. These are assessments, NOT a final verdict.
5. NEVER output an overall GO/NO-GO decision — the human decides.
6. strategicRfis: sharp, submission-worthy clarification questions not already covered by the provided clarifications.
7. Output ONE valid JSON object with EXACTLY these keys: summaryZh, scoringAnalysisZh, competitiveLandscapeZh, riskGates (array of {gateZh, statusZh, basisZh}), pricingStrategyZh, strategicRfis (array of {questionZh, whyZh}), teamingAdviceZh, dataGapsZh. riskGates and strategicRfis MUST be non-empty. All *Zh fields in Simplified Chinese (proper nouns stay original).`;

export async function synthesizeBidStrategyMemo(input: {
  project: {
    nameZh: string;
    buyer: string | null;
    closeDate: string | null;
    estimatedValue: number | null;
    currency: string | null;
  };
  facts: Array<{ kind: string; contentZh: string }>;
  mandatoryRequirements: string[];
  analystBrief: unknown;
  intelligence: ReturnType<typeof deriveAwardIntelligence>;
  incumbentLead: unknown | null;
  existingClarifications: string[];
  invoker?: LlmInvoker;
}): Promise<{ memo: BidStrategyMemoV2 | null; errorCode: string | null }> {
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const userPrompt = [
    `PROJECT: ${JSON.stringify(input.project)}`,
    `CANONICAL FACTS (${input.facts.length}):`,
    JSON.stringify(input.facts.slice(0, 70)),
    `MANDATORY REQUIREMENTS (${input.mandatoryRequirements.length}):`,
    JSON.stringify(input.mandatoryRequirements.slice(0, 40)),
    "ANALYST SYNTHESIS (excerpt):",
    JSON.stringify(input.analystBrief).slice(0, 4000),
    "ORG AWARD INTELLIGENCE:",
    JSON.stringify({
      basis: input.intelligence.basis,
      competitorSignals: input.intelligence.competitorSignals,
      comparablePricing: input.intelligence.comparablePricing,
    }),
    "INCUMBENT LEAD (may be null):",
    JSON.stringify(input.incumbentLead),
    "CLARIFICATIONS ALREADY DRAFTED:",
    JSON.stringify(input.existingClarifications.slice(0, 12)),
  ].join("\n");

  const res = await callStructured(
    invoker,
    {
      promptName: BID_STRATEGY_MEMO_PROMPT.name,
      promptVersion: BID_STRATEGY_MEMO_PROMPT.version,
      systemPrompt: MEMO_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 6_000,
      timeoutMs: 150_000,
    },
    bidStrategyMemoSchema,
  );
  if (!res.ok) return { memo: null, errorCode: res.errorCode };
  return {
    memo: {
      ...res.value,
      version: BID_STRATEGY_MEMO_VERSION,
      label: "AI_INFERRED",
      generatedAt: new Date().toISOString(),
      model: res.logs.find((l) => l.ok)?.model ?? null,
    },
    errorCode: null,
  };
}
