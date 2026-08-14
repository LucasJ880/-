/**
 * M2.5 — 外部情报 AI 分析师
 *
 * 检索结果（授标候选 + Web findings）不再裸展示：一次结构化 LLM 调用产出
 * 中文结论进「八个调查模块」。证据纪律：只能基于提供的检索结果推断，结论必须
 * 引用来源域名；确定不了就明说「未能从现有来源确定」；绝不发明中标方/金额。
 * 输出为 AI 初步调查（AI_RESEARCHED），人工确认后才升级为 READY 事实。
 */

import { z } from "zod";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import type { RankedAwardCandidate } from "./canadabuys";
import type { RankedWebCandidate } from "./websearch";

export const EXTERNAL_ANALYSIS_VERSION = "tender-external-analysis/v1" as const;
export const EXTERNAL_ANALYSIS_PROMPT = { name: "tender-external-analysis", version: "1" } as const;

// 长度越界一律截断而非拒绝（外部情报是增强层，稳出结果优先）
const zh = (max: number) =>
  z.preprocess((v) => {
    // 模型偶发输出对象/数组：取其中的字符串值拼接，绝不落 "[object Object]"
    if (v != null && typeof v === "object") {
      v = (Array.isArray(v) ? v : Object.values(v))
        .filter((x) => typeof x === "string")
        .join(" ");
    }
    return String(v ?? "").slice(0, max);
  }, z.string().min(1));
const clipStr = (max: number) =>
  z.preprocess(
    (v) => (v == null ? null : String(v).slice(0, max) || null),
    z.string().nullable(),
  );

const confidenceSchema = z.preprocess((v) => {
  const raw = String(v ?? "LOW").trim().toUpperCase();
  if (raw.includes("高") || raw === "HIGH") return "HIGH";
  if (raw.includes("中") || raw === "MEDIUM" || raw === "MED") return "MEDIUM";
  if (raw.includes("低") || raw === "LOW") return "LOW";
  return "LOW";
}, z.enum(["LOW", "MEDIUM", "HIGH"]));
const conclusionSchema = z.object({
  conclusionZh: zh(500),
  confidence: confidenceSchema,
  sourceDomains: z.array(clipStr(120).pipe(z.string())).max(12).default([]).catch([]),
});

export const externalAnalysisSchema = z.object({
  previousWinner: conclusionSchema.extend({
    candidateName: clipStr(160).optional().transform((v) => v ?? null),
  }),
  historicalValue: conclusionSchema,
  possiblyRecurring: conclusionSchema,
  competitors: z.preprocess(
    // 无名条目直接丢弃（模型偶发输出空 name），不让单条坏数据拒掉整包结论
    (v) =>
      Array.isArray(v)
        ? v.filter((c) => String((c as { name?: unknown })?.name ?? "").trim()).slice(0, 6)
        : [],
    z
      .array(
        z.object({
          name: zh(120),
          reasonZh: zh(240),
          url: clipStr(400).optional().transform((v) => v ?? null),
        }),
      )
      .default([]),
  ),
  marketSummaryZh: zh(900),
});
export type ExternalAnalysisLlm = z.infer<typeof externalAnalysisSchema>;

export type ExternalAnalysisV1 = ExternalAnalysisLlm & {
  version: typeof EXTERNAL_ANALYSIS_VERSION;
  generatedAt: string;
  model: string | null;
};

const SYSTEM_PROMPT = `You are a bid-intelligence analyst for the BIDDER. You receive (a) a one-line description of the current tender, (b) award-history candidates from official Canadian contract disclosure, (c) web search findings (domains + titles + snippets).

TASK: produce Simplified Chinese conclusions a bid manager can read directly — do NOT just relist links.

HARD RULES:
1. Base every conclusion ONLY on the provided findings. If the findings do not support a determination, say 未能从现有来源确定 and set confidence LOW. Never invent winners, amounts or facts.
2. Every non-empty conclusion must cite sourceDomains drawn from the provided findings.
3. previousWinner: judge whether any candidate plausibly won a PREVIOUS similar tender (same buyer/product). candidateName only when the findings actually indicate it.
4. historicalValue: state amount range only if findings contain it.
5. possiblyRecurring: judge from history (same buyer repeatedly procuring similar goods).
6. competitors: companies (not portals/news sites) that appear to sell/deliver similar products — likely rival bidders. Give a one-line reason each.
7. marketSummaryZh: 3-5 sentence synthesis: what the external evidence tells us, and what to verify next.
8. Output ONE valid JSON object. All *Zh fields in Simplified Chinese (proper nouns stay original).`;

export async function analyzeExternalIntel(input: {
  projectOneLiner: string | null;
  awardCandidates: RankedAwardCandidate[];
  webCandidates: RankedWebCandidate[];
  invoker?: LlmInvoker;
}): Promise<{ analysis: ExternalAnalysisV1 | null; errorCode: string | null }> {
  if (input.awardCandidates.length === 0 && input.webCandidates.length === 0) {
    return { analysis: null, errorCode: "NO_FINDINGS" };
  }
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const userPrompt = [
    `CURRENT TENDER: ${input.projectOneLiner ?? "(unknown)"}`,
    "",
    "AWARD-HISTORY CANDIDATES (official contract disclosure):",
    JSON.stringify(
      input.awardCandidates.slice(0, 8).map((c) => ({
        vendor: c.vendorName,
        hitQueries: c.hitQueries,
        value: c.bestFinding.contractValue,
        date: c.bestFinding.contractDate,
        buyer: c.bestFinding.buyerName ?? c.bestFinding.ownerOrg,
        description: c.bestFinding.descriptionEn,
      })),
    ),
    "",
    "WEB FINDINGS:",
    JSON.stringify(
      input.webCandidates.slice(0, 8).map((c) => ({
        domain: c.domain,
        hitQueries: c.hitQueries,
        items: c.findings.map((f) => ({ title: f.title, url: f.url, snippet: f.snippet })),
      })),
    ),
  ].join("\n");

  const res = await callStructured(
    invoker,
    {
      promptName: EXTERNAL_ANALYSIS_PROMPT.name,
      promptVersion: EXTERNAL_ANALYSIS_PROMPT.version,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 4_000,
      timeoutMs: 120_000,
    },
    externalAnalysisSchema,
  );
  if (!res.ok) return { analysis: null, errorCode: res.errorCode };
  return {
    analysis: {
      ...res.value,
      version: EXTERNAL_ANALYSIS_VERSION,
      generatedAt: new Date().toISOString(),
      model: res.logs.find((l) => l.ok)?.model ?? null,
    },
    errorCode: null,
  };
}

export function readExternalAnalysis(summaryJson: unknown): ExternalAnalysisV1 | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const raw = (summaryJson as Record<string, unknown>).externalAnalysis;
  if (!raw || typeof raw !== "object") return null;
  if ((raw as Record<string, unknown>).version !== EXTERNAL_ANALYSIS_VERSION) return null;
  return raw as ExternalAnalysisV1;
}
