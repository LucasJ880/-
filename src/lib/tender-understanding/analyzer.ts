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
 *
 * 阶段边界（P0 分片续跑）：本文件把管线拆成 3 个可独立调用的纯/半纯阶段——
 * `runExtractionWindow`（每窗一次 LLM）、`deriveGroundedState`（纯）、
 * `assembleAnalysisResult`（纯）。`analyzeTender` 是这些阶段的单次编排（语义不变，
 * benchmark/eval 继续走这里）；生产 worker 走 tender-auto-analysis/v2-resumable.ts
 * 的跨 tick 编排，复用同一批阶段函数——单一事实源，禁止第二套管线。
 */

import type {
  AmbiguityCandidateV2,
  AnalysisResultV2,
  AnalyzerInput,
  ExtractionOutputV2,
  FactCandidateV2,
  RequirementCandidateV2,
  RiskCandidateV2,
  TenderRequirementV2,
  CriticalFactSlotV2,
  CriticalFactType,
  ConflictV2,
  DocumentFactV2,
  AddendumChangeV2,
  ClarificationV2,
  DocumentManifest,
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

const EXTRACT_MAX_TOKENS = 20_000;
export const EXTRACT_TIMEOUT_MS = 180_000;
export const DEFAULT_CONCURRENCY = 3;

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
  // 按窗口下标定位结果：抽取顺序与并发完成顺序解耦，下游 dedupe（first-wins）
  // 因此对并发调度不敏感——同一批 LLM 输出恒produce同一结果（分片续跑的 parity 前提）。
  const outputs: (ExtractionOutputV2 | null)[] = new Array(windows.length).fill(null);

  const concurrency = Math.max(1, opts.maxConcurrency ?? DEFAULT_CONCURRENCY);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < windows.length) {
      const index = cursor;
      const window = windows[index]!;
      cursor += 1;
      const res = await runExtractionWindow(invoker, window);
      logs.push(...res.logs);
      if (!res.ok) {
        failedWindows.push({ windowId: window.windowId, errorCode: res.errorCode });
        continue;
      }
      outputs[index] = res.value;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(windows.length, 1)) }, () =>
      worker(),
    ),
  );

  const grounded = deriveGroundedState(
    input,
    collectWindowCandidates(outputs.filter((o): o is ExtractionOutputV2 => o !== null)),
  );

  // ── Clarifications（全语料解决检查后生成；无数量目标） ──
  const clarify = await generateClarifications({
    input,
    ambiguities: grounded.ambiguities,
    requirements: grounded.requirements,
    criticalFacts: grounded.criticalFacts,
    invoker,
  });
  logs.push(...clarify.logs);

  const result = assembleAnalysisResult({
    input,
    manifest,
    grounded,
    clarifications: clarify.clarifications,
    resolvedAmbiguities: clarify.resolvedAmbiguities,
    logs,
    failedWindows,
    windowCount: windows.length,
    startedAt,
    finishedAt: new Date(),
    analysisDate: opts.analysisDate ?? null,
  });

  return { result, run: { logs, failedWindows } };
}

/* ------------------------------ 阶段 1：单窗抽取（LLM） ------------------------------ */

export type WindowExtractionResult =
  | { ok: true; value: ExtractionOutputV2; logs: LlmCallLog[] }
  | { ok: false; errorCode: string; logs: LlmCallLog[] };

/**
 * 单窗口结构化抽取。timeoutMs 可被调用方收紧（分片续跑按剩余预算裁剪，
 * 防止一次调用把 serverless 函数拖到硬超时后整片工作丢失）。
 */
export async function runExtractionWindow(
  invoker: LlmInvoker,
  window: SectionWindow,
  opts: { timeoutMs?: number } = {},
): Promise<WindowExtractionResult> {
  const call = await callStructured(
    invoker,
    {
      promptName: PROMPT_EXTRACT.name,
      promptVersion: PROMPT_EXTRACT.version,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      userPrompt: buildExtractUserPrompt(window),
      maxTokens: EXTRACT_MAX_TOKENS,
      timeoutMs: Math.max(1_000, Math.min(opts.timeoutMs ?? EXTRACT_TIMEOUT_MS, EXTRACT_TIMEOUT_MS)),
    },
    extractionOutputSchema,
  );
  if (call.ok) return { ok: true, value: call.value, logs: call.logs };
  return { ok: false, errorCode: call.errorCode, logs: call.logs };
}

export type WindowCandidates = {
  facts: FactCandidateV2[];
  requirements: RequirementCandidateV2[];
  risks: RiskCandidateV2[];
  ambiguities: AmbiguityCandidateV2[];
};

/** 把窗口抽取输出按窗口顺序摊平成候选集（纯）。 */
export function collectWindowCandidates(
  outputs: ExtractionOutputV2[],
): WindowCandidates {
  const candidates: WindowCandidates = {
    facts: [],
    requirements: [],
    risks: [],
    ambiguities: [],
  };
  for (const out of outputs) {
    candidates.facts.push(...out.facts);
    candidates.requirements.push(...out.requirements);
    candidates.risks.push(...out.potentialRisks);
    candidates.ambiguities.push(...out.ambiguities);
  }
  return candidates;
}

/* ------------------------------ 阶段 2：grounded 派生（纯） ------------------------------ */

export type GroundedState = {
  /** 通过证据硬门的歧义候选（clarification 的唯一来源） */
  ambiguities: AmbiguityCandidateV2[];
  verifiedRisks: RiskCandidateV2[];
  requirements: TenderRequirementV2[];
  facts: DocumentFactV2[];
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>;
  conflicts: ConflictV2[];
  addendumChanges: AddendumChangeV2[];
  rejectedTally: { reasonCode: string; count: number }[];
  /** 单元归属纠正条数（可观测性：prompt 改好后应下降） */
  reattributed: number;
};

/**
 * Evidence Verification（硬门）→ Normalize/Dedupe → Addendum Precedence →
 * 矛盾检测 → Critical Facts。全程纯函数，无 LLM、无 IO：可在任意 tick 重算。
 */
export function deriveGroundedState(
  input: AnalyzerInput,
  candidates: WindowCandidates,
): GroundedState {
  const verified = verifyCandidates(input, {
    facts: candidates.facts,
    requirements: candidates.requirements,
    risks: candidates.risks,
    ambiguities: candidates.ambiguities,
  });
  const rejectedTally = tallyRejections(verified.rejected);

  const mergedRequirements = dedupeRequirements(input, verified.requirements);
  const facts = dedupeFacts(input, verified.facts);

  const precedence = applyAddendumPrecedence(input, mergedRequirements);
  const factConflicts = detectFactConflicts(
    input,
    facts,
    precedence.conflicts.length,
  );
  const conflicts = [...precedence.conflicts, ...factConflicts.conflicts];

  return {
    ambiguities: verified.ambiguities,
    verifiedRisks: verified.risks,
    requirements: precedence.requirements,
    facts: factConflicts.facts,
    criticalFacts: assembleCriticalFacts(factConflicts.facts),
    conflicts,
    addendumChanges: precedence.addendumChanges,
    rejectedTally,
    reattributed: verified.reattributed,
  };
}

/* ------------------------------ 阶段 3：结果组装（纯） ------------------------------ */

/** Risks 派生 + limitations + metadata + assembleResult。纯函数。 */
export function assembleAnalysisResult(parts: {
  input: AnalyzerInput;
  manifest: DocumentManifest;
  grounded: GroundedState;
  clarifications: ClarificationV2[];
  resolvedAmbiguities: AnalysisResultV2["resolvedAmbiguities"];
  logs: LlmCallLog[];
  failedWindows: { windowId: string; errorCode: string }[];
  windowCount: number;
  startedAt: Date;
  finishedAt: Date;
  analysisDate?: string | null;
}): AnalysisResultV2 {
  const { input, grounded, logs, failedWindows } = parts;

  const risks = deriveRisks({
    verifiedRiskCandidates: grounded.verifiedRisks,
    requirements: grounded.requirements,
    facts: grounded.facts,
    criticalFacts: grounded.criticalFacts,
    conflicts: grounded.conflicts,
    clarifications: parts.clarifications,
    rejectedTally: grounded.rejectedTally,
    analysisDate: parts.analysisDate ?? null,
  });

  const limitations: string[] = [];
  if (failedWindows.length > 0) {
    limitations.push(
      `${failedWindows.length}/${parts.windowCount} 个窗口 LLM 抽取失败（${failedWindows
        .map((w) => w.errorCode)
        .join("，")}），对应页面内容未纳入结果。`,
    );
  }
  if (grounded.rejectedTally.length > 0) {
    limitations.push(
      `证据验证拒收：${grounded.rejectedTally
        .map((r) => `${r.reasonCode}×${r.count}`)
        .join("，")}。`,
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

  return assembleResult({
    manifest: parts.manifest,
    facts: grounded.facts,
    requirements: grounded.requirements,
    risks,
    clarifications: parts.clarifications,
    resolvedAmbiguities: parts.resolvedAmbiguities,
    addendumChanges: grounded.addendumChanges,
    conflicts: grounded.conflicts,
    limitations,
    metadata: {
      analyzerVersion: TENDER_UNDERSTANDING_VERSION,
      resultVersion: "tender-analysis-result/v2",
      projectId: input.projectId,
      startedAt: parts.startedAt.toISOString(),
      finishedAt: parts.finishedAt.toISOString(),
      wallTimeMs: parts.finishedAt.getTime() - parts.startedAt.getTime(),
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
      windows: parts.windowCount,
      rejectedCandidates: grounded.rejectedTally,
      evidenceReattributed: grounded.reattributed,
      inputChars: logs.reduce((a, l) => a + l.inputChars, 0),
      outputChars: logs.reduce((a, l) => a + l.outputChars, 0),
    },
  });
}
