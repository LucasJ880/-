/**
 * Tender Understanding V2 — 编排器
 *
 * Documents → Manifest → Page/Section Windows → LLM Structured Extraction →
 * Evidence Verification → Normalize/Dedupe → Mandatory/Precedence/Conflict →
 * Risk → Clarification（语料解决检查后） → Synthesis。
 *
 * - LLM 经显式注入的 LlmInvoker（生产 = Unified Model Runtime；单测 = 脚本化）。
 * - 有界并发；单窗口失败不拖垮整体（记入 limitations）。
 * - 不读取 V1 抽取结果；不 import tender-eval。
 */

import type {
  AmbiguityCandidateV2,
  AnalysisResultV2,
  AnalyzerInput,
  FactCandidateV2,
  RequirementCandidateV2,
  RiskCandidateV2,
} from "./contract";
import { extractionOutputSchema, TENDER_UNDERSTANDING_VERSION } from "./contract";
import { generateClarifications } from "./clarify";
import { dedupeFacts, dedupeRequirements } from "./dedupe";
import type { LlmCallLog, LlmInvoker } from "./llm";
import { callStructured, createUnifiedRuntimeInvoker } from "./llm";
import { buildAllWindows, buildDocumentManifest, type SectionWindow } from "./manifest";
import { applyAddendumPrecedence, detectFactConflicts } from "./precedence";
import { deriveRisks } from "./risks";
import { assembleCriticalFacts, assembleResult } from "./synthesize";
import { tallyRejections, verifyCandidates } from "./verify";
import {
  buildExtractUserPrompt,
  EXTRACT_SYSTEM_PROMPT,
  PROMPT_EXTRACT,
} from "./prompts";

const EXTRACT_MAX_TOKENS = 14_000;
const EXTRACT_TIMEOUT_MS = 180_000;
const DEFAULT_CONCURRENCY = 3;

export type AnalyzeOptions = {
  /** 显式注入 LLM 调用器；缺省 = Unified Model Runtime */
  invoker?: LlmInvoker;
  maxConcurrency?: number;
  /** 提供时启用截止临近类风险（benchmark 不传以保持确定性） */
  analysisDate?: string | null;
  windowOptions?: { maxCharsPerWindow?: number; maxPagesPerWindow?: number };
};

export type AnalyzeRunLog = {
  logs: LlmCallLog[];
  failedWindows: { windowId: string; errorCode: string }[];
};

export async function analyzeTender(
  input: AnalyzerInput,
  opts: AnalyzeOptions = {},
): Promise<{ result: AnalysisResultV2; run: AnalyzeRunLog }> {
  const startedAt = new Date();
  const invoker = opts.invoker ?? createUnifiedRuntimeInvoker();
  const manifest = buildDocumentManifest(input);
  const windows = buildAllWindows(input, opts.windowOptions);

  // ── Pass 1：分窗抽取（有界并发） ──
  const logs: LlmCallLog[] = [];
  const failedWindows: { windowId: string; errorCode: string }[] = [];
  const factCandidates: FactCandidateV2[] = [];
  const requirementCandidates: RequirementCandidateV2[] = [];
  const riskCandidates: RiskCandidateV2[] = [];
  const ambiguityCandidates: AmbiguityCandidateV2[] = [];

  const concurrency = Math.max(1, opts.maxConcurrency ?? DEFAULT_CONCURRENCY);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < windows.length) {
      const window = windows[cursor]!;
      cursor += 1;
      const res = await extractWindow(invoker, window);
      logs.push(...res.logs);
      if (!res.ok) {
        failedWindows.push({ windowId: window.windowId, errorCode: res.errorCode });
        continue;
      }
      factCandidates.push(...res.value.facts);
      requirementCandidates.push(...res.value.requirements);
      riskCandidates.push(...res.value.potentialRisks);
      ambiguityCandidates.push(...res.value.ambiguities);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(windows.length, 1)) }, () =>
      worker(),
    ),
  );

  // ── Evidence Verification（硬门） ──
  const verified = verifyCandidates(input, {
    facts: factCandidates,
    requirements: requirementCandidates,
    risks: riskCandidates,
    ambiguities: ambiguityCandidates,
  });
  const rejectedTally = tallyRejections(verified.rejected);

  // ── Normalize / Dedupe ──
  const mergedRequirements = dedupeRequirements(input, verified.requirements);
  const facts = dedupeFacts(input, verified.facts);

  // ── Addendum Precedence + Contradiction ──
  const precedence = applyAddendumPrecedence(input, mergedRequirements);
  const factConflicts = detectFactConflicts(
    input,
    facts,
    precedence.conflicts.length,
  );
  const conflicts = [...precedence.conflicts, ...factConflicts.conflicts];

  // ── Critical Facts（含 UNKNOWN 槽位） ──
  const criticalFacts = assembleCriticalFacts(factConflicts.facts);

  // ── Clarifications（全语料解决检查后生成；无数量目标） ──
  const clarify = await generateClarifications({
    input,
    ambiguities: verified.ambiguities,
    requirements: precedence.requirements,
    criticalFacts,
    invoker,
  });
  logs.push(...clarify.logs);

  // ── Risks（零模板派生） ──
  const risks = deriveRisks({
    verifiedRiskCandidates: verified.risks,
    requirements: precedence.requirements,
    facts: factConflicts.facts,
    criticalFacts,
    conflicts,
    clarifications: clarify.clarifications,
    rejectedTally,
    analysisDate: opts.analysisDate ?? null,
  });

  // ── Synthesis ──
  const finishedAt = new Date();
  const limitations: string[] = [];
  if (failedWindows.length > 0) {
    limitations.push(
      `${failedWindows.length}/${windows.length} 个窗口 LLM 抽取失败（${failedWindows
        .map((w) => w.errorCode)
        .join("，")}），对应页面内容未纳入结果。`,
    );
  }
  if (rejectedTally.length > 0) {
    limitations.push(
      `证据验证拒收：${rejectedTally.map((r) => `${r.reasonCode}×${r.count}`).join("，")}。`,
    );
  }
  const emptyPages = input.documents
    .flatMap((d) => d.pages)
    .filter((p) => p.contentText.trim().length < 16).length;
  if (emptyPages > 0) {
    limitations.push(`${emptyPages} 页近乎无文本（可能需 OCR），未参与理解。`);
  }

  const models = Array.from(
    new Set(logs.filter((l) => l.model !== "unknown").map((l) => l.model)),
  );
  const promptUsageMap = new Map<string, { promptVersion: string; calls: number }>();
  for (const l of logs) {
    const cur = promptUsageMap.get(l.promptName) ?? {
      promptVersion: l.promptVersion,
      calls: 0,
    };
    cur.calls += 1;
    promptUsageMap.set(l.promptName, cur);
  }

  const result = assembleResult({
    manifest,
    facts: factConflicts.facts,
    requirements: precedence.requirements,
    risks,
    clarifications: clarify.clarifications,
    resolvedAmbiguities: clarify.resolvedAmbiguities,
    addendumChanges: precedence.addendumChanges,
    conflicts,
    limitations,
    metadata: {
      analyzerVersion: TENDER_UNDERSTANDING_VERSION,
      resultVersion: "tender-analysis-result/v2",
      projectId: input.projectId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      wallTimeMs: finishedAt.getTime() - startedAt.getTime(),
      llmCalls: logs.length,
      llmFailures: logs.filter((l) => !l.ok).length,
      models,
      promptUsages: Array.from(promptUsageMap.entries()).map(
        ([promptName, v]) => ({
          promptName,
          promptVersion: v.promptVersion,
          calls: v.calls,
        }),
      ),
      pages: input.documents.reduce((a, d) => a + d.pages.length, 0),
      windows: windows.length,
      rejectedCandidates: rejectedTally,
      inputChars: logs.reduce((a, l) => a + l.inputChars, 0),
      outputChars: logs.reduce((a, l) => a + l.outputChars, 0),
    },
  });

  return { result, run: { logs, failedWindows } };
}

async function extractWindow(
  invoker: LlmInvoker,
  window: SectionWindow,
): Promise<
  | { ok: true; value: import("./contract").ExtractionOutputV2; logs: LlmCallLog[] }
  | { ok: false; errorCode: string; logs: LlmCallLog[] }
> {
  const call = await callStructured(
    invoker,
    {
      promptName: PROMPT_EXTRACT.name,
      promptVersion: PROMPT_EXTRACT.version,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      userPrompt: buildExtractUserPrompt(window),
      maxTokens: EXTRACT_MAX_TOKENS,
      timeoutMs: EXTRACT_TIMEOUT_MS,
    },
    extractionOutputSchema,
  );
  if (call.ok) return { ok: true, value: call.value, logs: call.logs };
  return { ok: false, errorCode: call.errorCode, logs: call.logs };
}
