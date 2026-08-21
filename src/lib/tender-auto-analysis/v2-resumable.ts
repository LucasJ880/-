/**
 * V2 分片续跑执行器（P0）
 *
 * 一个 cron tick 只做"当前预算内能做完并落盘的那一段"，其余留给下一个 tick：
 *
 *   WINDOWS（每批 ≤ concurrency 个窗口，一次 LLM/窗口）
 *     → CLARIFY（逐条歧义解决检查，一次 LLM/条）
 *     → ANALYST_A（PASS A）→ ANALYST_B（PASS B）→ PERSIST（交回调用方做 fenced 写）
 *
 * 硬约束：
 * - 每次 LLM 调用结果**立即检查点**（写 workerCursor），进程被 serverless 硬杀
 *   最多损失一批调用，绝不回到零。
 * - 检查点写入必须过 lease fence（saveCursor 返回 false = 已被接管）→ 抛
 *   TenderV2LeaseLostError，stale worker 零写。
 * - 所有 LLM 调用都在 DB 事务之外（§9 不变）。
 * - 阶段函数全部复用 tender-understanding / tender-analyst 的同一批实现，
 *   与单次编排（analyzeTender / runAnalystSynthesis）**同源**，禁止第二套管线。
 *
 * 本模块不碰 DB：输入（AnalyzerInput / coverage）与检查点写入均由调用方注入，
 * 因此可以做确定性单测（含"同一批 LLM 输出，分片跑 == 单次跑"的 parity 断言）。
 */

import {
  assembleAnalysisResult,
  collectWindowCandidates,
  deriveGroundedState,
  runExtractionWindow,
  DEFAULT_CONCURRENCY,
  type GroundedState,
} from "@/lib/tender-understanding/analyzer";
import {
  assembleClarifications,
  planClarifications,
  resolveClarificationItem,
} from "@/lib/tender-understanding/clarify";
import type {
  AnalysisResultV2,
  AnalyzerInput,
  ExtractionOutputV2,
} from "@/lib/tender-understanding/contract";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { createUnifiedRuntimeInvoker } from "@/lib/tender-understanding/llm";
import {
  buildAllWindows,
  buildDocumentManifest,
  type SectionWindow,
  type WindowOptions,
} from "@/lib/tender-understanding/manifest";
import { PROMPT_EXTRACT, PROMPT_RESOLVE } from "@/lib/tender-understanding/prompts";
import {
  finalizeAnalystSynthesis,
  runAnalystPassA,
  runAnalystPassB,
} from "@/lib/tender-analyst/synthesize";
import {
  ANALYST_PROMPT_VERSION,
  ANALYST_QA_PROMPT_VERSION,
  type AnalystCoverage,
  type TenderAnalystSynthesisV1,
} from "@/lib/tender-analyst/contract";
import { mapV2Result, type V2MappedResult } from "./v2-map";
import { TenderV2LeaseLostError } from "./v2-errors";
import {
  callTimeoutFor,
  canStartPhase,
  computeV2Fingerprint,
  MAX_ANALYST_ATTEMPTS,
  MAX_WINDOW_ATTEMPTS,
  remainingMs,
  type V2CursorState,
  type V2Phase,
} from "./v2-cursor";

export type V2Inference = {
  mapped: V2MappedResult;
  model: string | null;
  llmCalls: number;
  llmFailures: number;
};

export type V2AdvanceOutcome =
  | { status: "READY"; cursor: V2CursorState; inference: V2Inference }
  | { status: "YIELD"; cursor: V2CursorState; phase: V2Phase; reason: string };

export type V2AdvanceArgs = {
  input: AnalyzerInput;
  coverage: AnalystCoverage;
  cursor: V2CursorState;
  /** epoch ms；Infinity = 不限（单次编排/测试） */
  deadlineAt: number;
  /** 本次 cron 调用的完整预算（用于阶段准入退化判定） */
  tickBudgetMs: number;
  invoker?: LlmInvoker;
  maxConcurrency?: number;
  windowOptions?: WindowOptions;
  now?: () => number;
  /** 检查点落盘（fenced）：返回 false = 租约丢失 */
  saveCursor?: (cursor: V2CursorState) => Promise<boolean>;
  /** 心跳判定的提前 fail-closed（权威防线仍是 saveCursor / persist fence） */
  checkLease?: () => boolean;
};

/** prompt 版本进入指纹：prompt 升版 = 旧检查点作废，避免混版结果。 */
export function v2PromptVersions(): string[] {
  return [
    `${PROMPT_EXTRACT.name}@${PROMPT_EXTRACT.version}`,
    `${PROMPT_RESOLVE.name}@${PROMPT_RESOLVE.version}`,
    `analyst@${ANALYST_PROMPT_VERSION}`,
    `analyst-qa@${ANALYST_QA_PROMPT_VERSION}`,
  ];
}

export function fingerprintAnalyzerInput(input: AnalyzerInput): string {
  return computeV2Fingerprint({
    documents: input.documents.map((d) => ({
      documentId: d.documentId,
      contentHash: d.contentHash ?? null,
      pageCount: d.pages.length,
    })),
    promptVersions: v2PromptVersions(),
  });
}

/**
 * 推进一个 tick。返回 READY 时 inference 已就绪（调用方做 lease-fenced 落库）；
 * 返回 YIELD 时检查点已落盘，下个 tick 从同一位置继续。
 */
export async function advanceV2Analysis(
  args: V2AdvanceArgs,
): Promise<V2AdvanceOutcome> {
  const now = args.now ?? (() => Date.now());
  const invoker = args.invoker ?? createUnifiedRuntimeInvoker();
  const cursor = args.cursor;
  const windows = buildAllWindows(args.input, args.windowOptions);
  const concurrency = Math.max(1, args.maxConcurrency ?? DEFAULT_CONCURRENCY);

  cursor.ticks += 1;

  const ensureLease = (): void => {
    if (args.checkLease && args.checkLease() === false) {
      throw new TenderV2LeaseLostError(args.input.projectId);
    }
  };

  const checkpoint = async (): Promise<void> => {
    cursor.progressAt = new Date(now()).toISOString();
    if (!args.saveCursor) return;
    const ok = await args.saveCursor(cursor);
    if (!ok) throw new TenderV2LeaseLostError(args.input.projectId);
  };

  // grounded 派生是纯函数但有一定开销：窗口集不变时同 tick 内复用
  let groundedMemo: GroundedState | null = null;
  const grounded = (): GroundedState => {
    if (!groundedMemo) {
      groundedMemo = deriveGroundedState(
        args.input,
        collectWindowCandidates(orderedOutputs(windows, cursor)),
      );
    }
    return groundedMemo;
  };

  const buildResult = (): AnalysisResultV2 =>
    assembleAnalysisResult({
      input: args.input,
      manifest: buildDocumentManifest(args.input),
      grounded: grounded(),
      ...assembleClarifyForCursor(args.input, grounded(), cursor),
      logs: cursor.logs,
      failedWindows: exhaustedWindows(windows, cursor),
      windowCount: windows.length,
      startedAt: new Date(cursor.startedAt),
      finishedAt: new Date(now()),
      analysisDate: cursor.analysisDate,
    });

  for (;;) {
    ensureLease();
    const remaining = remainingMs(args.deadlineAt, now());

    if (cursor.phase === "WINDOWS") {
      const pending = windows.filter((w) => isWindowPending(w, cursor));
      if (pending.length === 0) {
        cursor.phase = "CLARIFY";
        await checkpoint();
        continue;
      }
      if (!canStartPhase("WINDOWS", remaining, args.tickBudgetMs)) {
        return yieldNow(cursor, "WINDOWS", `budget_remaining_ms=${remaining}`);
      }

      const batch = pending.slice(0, concurrency);
      const timeoutMs = callTimeoutFor(remaining);
      const results = await Promise.all(
        batch.map((w) => runExtractionWindow(invoker, w, { timeoutMs })),
      );
      batch.forEach((w, i) => {
        const res = results[i]!;
        cursor.logs.push(...res.logs);
        if (res.ok) {
          cursor.windows.outputs[w.windowId] = res.value;
          delete cursor.windows.failures[w.windowId];
        } else {
          const prev = cursor.windows.failures[w.windowId]?.attempts ?? 0;
          cursor.windows.failures[w.windowId] = {
            attempts: prev + 1,
            lastErrorCode: res.errorCode,
          };
        }
      });
      groundedMemo = null;
      await checkpoint();
      continue;
    }

    if (cursor.phase === "CLARIFY") {
      const plan = planClarifications(args.input, grounded().ambiguities);
      const next = plan.find(
        (item) => !(item.key in cursor.clarify.resolutions),
      );
      if (!next) {
        cursor.phase = "ANALYST_A";
        await checkpoint();
        continue;
      }
      if (!canStartPhase("CLARIFY", remaining, args.tickBudgetMs)) {
        return yieldNow(cursor, "CLARIFY", `budget_remaining_ms=${remaining}`);
      }

      const res = await resolveClarificationItem(next, invoker, {
        timeoutMs: callTimeoutFor(remaining),
      });
      cursor.logs.push(...res.logs);
      cursor.clarify.resolutions[next.key] = res.resolution;
      await checkpoint();
      continue;
    }

    if (cursor.phase === "ANALYST_A") {
      if (cursor.analyst.passA) {
        cursor.phase = "ANALYST_B";
        await checkpoint();
        continue;
      }
      if (cursor.analyst.passAAttempts >= MAX_ANALYST_ATTEMPTS) {
        // PASS A 用尽 → 无中文综合层（analysis 仍落库，UI fallback legacy 视图）
        cursor.phase = "PERSIST";
        await checkpoint();
        continue;
      }
      if (!canStartPhase("ANALYST_A", remaining, args.tickBudgetMs)) {
        return yieldNow(cursor, "ANALYST_A", `budget_remaining_ms=${remaining}`);
      }

      cursor.analyst.passAAttempts += 1;
      try {
        const passA = await runAnalystPassA({
          result: buildResult(),
          invoker,
          timeoutMs: callTimeoutFor(remaining),
        });
        cursor.analyst.logs.push(...passA.logs);
        cursor.analyst.analystLatencyMs = passA.latencyMs;
        if (passA.ok) {
          cursor.analyst.passA = passA.value;
          cursor.analyst.passAErrorCode = null;
          cursor.phase = "ANALYST_B";
        } else {
          cursor.analyst.passAErrorCode = passA.errorCode;
        }
      } catch (e) {
        // Analyst 是增强层：异常绝不阻断 grounding 结果落库
        cursor.analyst.passAErrorCode = analystExceptionCode(e);
      }
      await checkpoint();
      continue;
    }

    if (cursor.phase === "ANALYST_B") {
      const draft = cursor.analyst.passA;
      if (!draft) {
        cursor.phase = "PERSIST";
        await checkpoint();
        continue;
      }
      if (cursor.analyst.passB || cursor.analyst.passBAttempts >= MAX_ANALYST_ATTEMPTS) {
        cursor.phase = "PERSIST";
        await checkpoint();
        continue;
      }
      if (!canStartPhase("ANALYST_B", remaining, args.tickBudgetMs)) {
        return yieldNow(cursor, "ANALYST_B", `budget_remaining_ms=${remaining}`);
      }

      cursor.analyst.passBAttempts += 1;
      try {
        const passB = await runAnalystPassB({
          result: buildResult(),
          draft,
          invoker,
          timeoutMs: callTimeoutFor(remaining),
        });
        cursor.analyst.logs.push(...passB.logs);
        cursor.analyst.reviewLatencyMs = passB.latencyMs;
        if (passB.ok) {
          cursor.analyst.passB = passB.value;
          cursor.analyst.passBErrorCode = null;
          cursor.phase = "PERSIST";
        } else {
          cursor.analyst.passBErrorCode = passB.errorCode;
        }
      } catch (e) {
        cursor.analyst.passBErrorCode = analystExceptionCode(e);
      }
      await checkpoint();
      continue;
    }

    // PERSIST：纯组装，交回调用方做 lease-fenced canonical 写
    if (!canStartPhase("PERSIST", remaining, args.tickBudgetMs)) {
      return yieldNow(cursor, "PERSIST", `budget_remaining_ms=${remaining}`);
    }
    ensureLease();
    const inference = buildInference(args, cursor, buildResult());
    // 要求中文化 pass（矩阵可用性批次）：租约内、canonical 事务外。
    // 失败/超时回退英文原样（服务内部吞错），绝不阻塞终态化；
    // 若本 tick 让出后重入会重翻一次（幂等，多花一次调用可接受）。
    try {
      const { translateAnalysisZh } = await import("./requirement-translate");
      // 全分析中文化：要求 + 事实 claim + 关键事实槽（下一阶段 Lane 1：事实层也曾全英文）
      const outcome = await translateAnalysisZh(
        {
          requirements: inference.mapped.requirements,
          facts: inference.mapped.facts,
          criticalFacts: inference.mapped.summaryJson.criticalFacts as
            | Record<string, { status?: string; text?: string | null }>
            | undefined,
        },
        {
          // 与抽取/analyst 同一注入面：测试 fake invoker 可观测翻译调用
          invoker: args.invoker,
          timeoutMs: Math.min(240_000, Math.max(10_000, remaining - 5_000)),
        },
      );
      inference.llmCalls += outcome.llmCalls;
      inference.llmFailures += outcome.llmCalls > 0 && outcome.translated === 0 ? 1 : 0;
    } catch {
      // 回退英文（与既有行为一致）
    }
    return {
      status: "READY",
      cursor,
      inference,
    };
  }
}

/* ------------------------------ 内部纯helpers ------------------------------ */

function analystExceptionCode(e: unknown): string {
  return `ANALYST_EXCEPTION:${e instanceof Error ? e.name : "unknown"}`;
}

function isWindowPending(w: SectionWindow, cursor: V2CursorState): boolean {
  if (cursor.windows.outputs[w.windowId]) return false;
  const attempts = cursor.windows.failures[w.windowId]?.attempts ?? 0;
  return attempts < MAX_WINDOW_ATTEMPTS;
}

function orderedOutputs(
  windows: SectionWindow[],
  cursor: V2CursorState,
): ExtractionOutputV2[] {
  const out: ExtractionOutputV2[] = [];
  for (const w of windows) {
    const o = cursor.windows.outputs[w.windowId];
    if (o) out.push(o);
  }
  return out;
}

function exhaustedWindows(
  windows: SectionWindow[],
  cursor: V2CursorState,
): { windowId: string; errorCode: string }[] {
  const failed: { windowId: string; errorCode: string }[] = [];
  for (const w of windows) {
    const f = cursor.windows.failures[w.windowId];
    if (f && f.attempts >= MAX_WINDOW_ATTEMPTS) {
      failed.push({ windowId: w.windowId, errorCode: f.lastErrorCode });
    }
  }
  return failed;
}

function assembleClarifyForCursor(
  input: AnalyzerInput,
  grounded: GroundedState,
  cursor: V2CursorState,
) {
  const plan = planClarifications(input, grounded.ambiguities);
  const assembled = assembleClarifications({
    input,
    plan,
    resolutions: cursor.clarify.resolutions,
    requirements: grounded.requirements,
    criticalFacts: grounded.criticalFacts,
  });
  return {
    clarifications: assembled.clarifications,
    resolvedAmbiguities: assembled.resolvedAmbiguities,
  };
}

function yieldNow(
  cursor: V2CursorState,
  phase: V2Phase,
  reason: string,
): V2AdvanceOutcome {
  return { status: "YIELD", cursor, phase, reason };
}

/** 由 AnalyzerInput 建 (documentId, 单元序号) → 单元标签 的解析器（PDF 返回 null）。 */
export function buildUnitLabelResolver(input: AnalyzerInput) {
  const labels = new Map<string, string>();
  for (const doc of input.documents) {
    for (const page of doc.pages) {
      if (page.unitLabel) {
        labels.set(`${doc.documentId}#${page.pageNumber}`, page.unitLabel);
      }
    }
  }
  return (documentId: string, pageNumber: number | null): string | null =>
    pageNumber == null ? null : (labels.get(`${documentId}#${pageNumber}`) ?? null);
}

function buildInference(
  args: V2AdvanceArgs,
  cursor: V2CursorState,
  result: AnalysisResultV2,
): V2Inference {
  const mapped = mapV2Result(result, {
    unitLabelOf: buildUnitLabelResolver(args.input),
  });

  if (cursor.analyst.passA) {
    try {
      const synthesis = finalizeAnalystSynthesis({
        result,
        coverage: args.coverage,
        passA: cursor.analyst.passA,
        passB: cursor.analyst.passB,
        passBErrorCode: cursor.analyst.passBErrorCode,
        logs: cursor.analyst.logs,
        analystLatencyMs: cursor.analyst.analystLatencyMs,
        reviewLatencyMs: cursor.analyst.reviewLatencyMs,
        unitLabelOf: buildUnitLabelResolver(args.input),
      });
      applyAnalystSynthesisToMapped(mapped, synthesis, {
        analystLatencyMs: cursor.analyst.analystLatencyMs,
        reviewLatencyMs: cursor.analyst.reviewLatencyMs,
        analystLlmCalls: cursor.analyst.logs.length,
        analystLlmFailures: cursor.analyst.logs.filter((l) => !l.ok).length,
      });
    } catch (e) {
      // 增强层组装失败不阻断 canonical grounding 结果
      console.warn(
        "[tender-analyst] finalize failed (non-blocking): " + analystExceptionCode(e),
      );
    }
  }
  const analystCalls = cursor.analyst.logs.length;
  const analystFailures = cursor.analyst.logs.filter((l) => !l.ok).length;

  return {
    mapped,
    model: result.metadata.models[0] ?? null,
    // 真实 telemetry：grounding + analyst 两层合并（与单次编排口径一致）
    llmCalls: result.metadata.llmCalls + analystCalls,
    llmFailures: result.metadata.llmFailures + analystFailures,
  };
}

/**
 * 把 Analyst 中文综合结论并入 mapped（summaryJson.analystSynthesis + 30 秒看懂 brief）。
 * 纯函数（原地修改 mapped）；单次编排与分片编排共用，防两条路径漂移。
 */
export function applyAnalystSynthesisToMapped(
  mapped: V2MappedResult,
  synthesis: TenderAnalystSynthesisV1,
  telemetry: {
    analystLatencyMs: number;
    reviewLatencyMs: number;
    analystLlmCalls: number;
    analystLlmFailures: number;
  },
): void {
  mapped.summaryJson.analystSynthesis = synthesis;

  // 30 秒看懂 brief 全面采用 Analyst 中文结论（FB-16：情报卡不得吐英文引擎串/内部细节）
  const brief = mapped.summaryJson.brief as Record<string, unknown> | undefined;
  if (brief && typeof brief === "object") {
    brief.oneLiner = synthesis.executiveBrief.oneLinerZh;
    brief.product = synthesis.executiveBrief.whatIsBeingBoughtZh; // FB-17.3
    brief.recommendation = synthesis.currentAssessment.summaryZh;
    brief.nextActions = [...synthesis.nextActions]
      .sort((a, b) => a.order - b.order)
      .slice(0, 5)
      .map((n) => n.actionZh);
    const fatalTitles = [
      ...synthesis.keyRequirements,
      ...synthesis.technicalRequirements,
      ...synthesis.commercialAndDelivery,
    ]
      .filter((k) => k.impact === "BID_FATAL")
      .map((k) => `废标风险：${k.titleZh}`);
    const riskTitles = synthesis.risksAndGaps
      .filter((r) => r.severity === "CRITICAL" || r.severity === "HIGH")
      .map((r) => r.titleZh);
    brief.blockers = [...fatalTitles, ...riskTitles].slice(0, 6);
  }

  const meta = mapped.summaryJson.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta === "object") {
    meta.analystLatencyMs = telemetry.analystLatencyMs;
    meta.reviewLatencyMs = telemetry.reviewLatencyMs;
    meta.analystLlmCalls = telemetry.analystLlmCalls;
    meta.analystLlmFailures = telemetry.analystLlmFailures;
  }
}
