/**
 * T5-P1.1 §7 —— Workforce 侧 canonical V2 **可续跑**推进（薄编排层）
 *
 * 与 legacy `advanceAndPersistV2` 是同一形状的孪生：语义引擎、游标契约、
 * checkpoint 频率全部复用 #113，唯一差别是**凭什么写**：
 *
 *   legacy     TenderAnalysisRun.leaseOwner 租约 → persistV2Fenced
 *   workforce  AgentRun RunFence + 域归属守卫   → persistV2ForWorkforce
 *
 * 本文件**不**实现抽取/澄清/分析师/映射/canonical 写——一行都没有。
 * 它只做：装载输入 → 解析/新建游标 → 调 advanceV2Analysis → YIELD 或落库。
 *
 * 游标存 `TenderAnalysisRun.workerCursor`（#113 已把该字段定义为 V2 durable cursor），
 * 不新增表/列/第二套 cursor 契约（§8/§55）。
 */

import {
  buildAnalyzerInputForRun,
  loadCoverageForRun,
  isEmptyAnalysisOutcome,
} from "@/lib/tender-auto-analysis/v2-persist";
import {
  advanceV2Analysis,
  fingerprintAnalyzerInput,
} from "@/lib/tender-auto-analysis/v2-resumable";
import {
  createV2Cursor,
  parseV2Cursor,
  type V2CursorState,
  type V2Phase,
} from "@/lib/tender-auto-analysis/v2-cursor";
import type { AnalyzeOptions } from "@/lib/tender-understanding/analyzer";
import type { RunFence } from "@/lib/agent-runtime/lease";
import { db } from "@/lib/db";
import {
  persistV2ForWorkforce,
  saveWorkforceV2Cursor,
  type WorkforceTenderOwnership,
} from "./v2-persist-workforce";
import type { PersistV2Result } from "@/lib/tender-auto-analysis/v2-persist-core";

export type WorkforceV2StepOutcome =
  /** 本次 invocation 预算用尽：成果已 checkpoint，下次从断点继续 */
  | { status: "YIELD"; phase: V2Phase; reason: string; ticks: number }
  /** 全部阶段完成且 canonical 已原子落库 */
  | {
      status: "PERSISTED";
      result: PersistV2Result & { llmCalls: number; llmFailures: number };
      model: string | null;
      ticks: number;
    }
  /** READY 但判定为空壳分析：不落库（§26 只在 READY 后判定） */
  | { status: "EMPTY_ANALYSIS"; llmCalls: number; llmFailures: number };

export async function advanceV2ForWorkforce(input: {
  own: WorkforceTenderOwnership;
  runFence: RunFence;
  /** epoch ms 硬截止（来自 serverless invocation 预算） */
  deadlineAt: number;
  tickBudgetMs: number;
  analysisDate?: string | null;
  opts?: AnalyzeOptions;
  now?: () => number;
}): Promise<WorkforceV2StepOutcome> {
  const now = input.now ?? (() => Date.now());
  const runId = input.own.analysisRunId;

  const analyzerInput = await buildAnalyzerInputForRun(runId);
  if (!analyzerInput) {
    throw new Error(`advanceV2ForWorkforce: no documents/pages for run ${runId}`);
  }

  // §29：指纹由 #113 计算（文档 hash / 页数 / prompt 版本）。任一变化 →
  // 旧 checkpoint 作废、从头开始，绝不拿过期 cursor 继续消费。
  const fingerprint = fingerprintAnalyzerInput(analyzerInput);
  const row = await db.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: runId },
    select: { workerCursor: true },
  });
  const cursor: V2CursorState =
    parseV2Cursor(row.workerCursor, fingerprint) ??
    createV2Cursor({
      fingerprint,
      analysisDate: input.analysisDate ?? new Date(now()).toISOString(),
      now: new Date(now()),
    });

  const coverage = await loadCoverageForRun(analyzerInput.projectId, runId);

  const outcome = await advanceV2Analysis({
    input: analyzerInput,
    coverage,
    cursor,
    deadlineAt: input.deadlineAt,
    tickBudgetMs: input.tickBudgetMs,
    invoker: input.opts?.invoker,
    maxConcurrency: input.opts?.maxConcurrency,
    windowOptions: input.opts?.windowOptions,
    now,
    // §9/§11：每个成功阶段后经 RunFence + 域归属守卫落盘
    saveCursor: (c) =>
      saveWorkforceV2Cursor({
        own: input.own,
        runFence: input.runFence,
        cursor: c,
      }),
  });

  if (outcome.status === "YIELD") {
    return {
      status: "YIELD",
      phase: outcome.phase,
      reason: outcome.reason,
      ticks: outcome.cursor.ticks,
    };
  }

  // §26：空壳判定**只**在 READY 后、落库前做——中间阶段 facts=0 不算空分析
  const { mapped, model, llmCalls, llmFailures } = outcome.inference;
  if (
    isEmptyAnalysisOutcome({
      llmCalls,
      llmFailures,
      factCount: mapped.facts.length,
      requirementCount: mapped.requirements.length,
    })
  ) {
    return { status: "EMPTY_ANALYSIS", llmCalls, llmFailures };
  }

  const persisted = await persistV2ForWorkforce({
    orgId: input.own.orgId,
    projectId: input.own.projectId,
    analysisRunId: runId,
    jobId: input.own.jobId,
    mapped,
    model,
    runFence: input.runFence,
  });

  // §12：canonical 落库成功后**不**立刻清 workerCursor——
  // 若此刻进程死在 Step completed 之前，下一个 worker 需要看到 phase=PERSIST
  // 才能安全地幂等重放，而不是从零重跑整个 t3。
  return {
    status: "PERSISTED",
    result: { ...persisted, llmCalls, llmFailures },
    model,
    ticks: outcome.cursor.ticks,
  };
}
