/**
 * runAnalystSynthesis — 两段式 GPT-like 工作流（§8）
 *
 *   PASS A（Senior Tender Analyst）→ 校验 → PASS B（Analyst QA Reviewer）
 *   → 再校验/消毒 → hydrate 证据索引。
 *
 * 全部 LLM 调用发生在推理阶段（runV2Inference 内、DB 事务之外，§9）。
 * PASS A 失败 → 返回 null（分析仍可落库，UI fallback legacy 视图）；
 * PASS B 失败 → 保留经校验的 PASS A 结果并标记 qa=SKIPPED + needsHumanReview。
 */

import type { AnalysisResultV2 } from "@/lib/tender-understanding/contract";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmCallLog,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import {
  ANALYST_PROMPT_NAME,
  ANALYST_PROMPT_VERSION,
  ANALYST_QA_PROMPT_NAME,
  ANALYST_QA_PROMPT_VERSION,
  TENDER_ANALYST_SYNTHESIS_VERSION,
  analystLlmOutputSchema,
  analystQaOutputSchema,
  type AnalystCoverage,
  type AnalystLlmOutput,
  type AnalystQaOutput,
  type TenderAnalystSynthesisV1,
} from "./contract";
import { buildTenderAnalystContext } from "./context";
import {
  ANALYST_QA_SYSTEM_PROMPT,
  ANALYST_SYSTEM_PROMPT,
  buildAnalystQaUserPrompt,
  buildAnalystUserPrompt,
} from "./prompts";
import { validateTenderAnalystSynthesis } from "./validate";
import { hydrateEvidenceIndex } from "./hydrate";

const ANALYST_MAX_TOKENS = 20_000;
export const ANALYST_TIMEOUT_MS = 240_000;

export type AnalystSynthesisRunResult = {
  synthesis: TenderAnalystSynthesisV1 | null;
  logs: LlmCallLog[];
  llmCalls: number;
  llmFailures: number;
  analystLatencyMs: number;
  reviewLatencyMs: number;
};

/* ------------------------------ 分片可续跑接缝 ------------------------------ */

export type AnalystPassAResult =
  | { ok: true; value: AnalystLlmOutput; logs: LlmCallLog[]; latencyMs: number }
  | { ok: false; errorCode: string; logs: LlmCallLog[]; latencyMs: number };

export type AnalystPassBResult =
  | {
      ok: true;
      value: AnalystQaOutput;
      logs: LlmCallLog[];
      latencyMs: number;
    }
  | { ok: false; errorCode: string; logs: LlmCallLog[]; latencyMs: number };

/** PASS A：Senior Tender Analyst（一次 LLM）。 */
export async function runAnalystPassA(input: {
  result: AnalysisResultV2;
  invoker: LlmInvoker;
  timeoutMs?: number;
}): Promise<AnalystPassAResult> {
  const context = buildTenderAnalystContext(input.result);
  const t0 = Date.now();
  const call = await callStructured(
    input.invoker,
    {
      promptName: ANALYST_PROMPT_NAME,
      promptVersion: ANALYST_PROMPT_VERSION,
      systemPrompt: ANALYST_SYSTEM_PROMPT,
      userPrompt: buildAnalystUserPrompt(context),
      maxTokens: ANALYST_MAX_TOKENS,
      timeoutMs: clampAnalystTimeout(input.timeoutMs),
    },
    analystLlmOutputSchema,
  );
  const latencyMs = Date.now() - t0;
  return call.ok
    ? { ok: true, value: call.value, logs: call.logs, latencyMs }
    : { ok: false, errorCode: call.errorCode, logs: call.logs, latencyMs };
}

/** PASS B：Analyst QA Reviewer（一次 LLM，不得引入新事实）。 */
export async function runAnalystPassB(input: {
  result: AnalysisResultV2;
  draft: AnalystLlmOutput;
  invoker: LlmInvoker;
  timeoutMs?: number;
}): Promise<AnalystPassBResult> {
  const context = buildTenderAnalystContext(input.result);
  const draftValidation = validateTenderAnalystSynthesis(input.draft, input.result);
  const t1 = Date.now();
  const call = await callStructured(
    input.invoker,
    {
      promptName: ANALYST_QA_PROMPT_NAME,
      promptVersion: ANALYST_QA_PROMPT_VERSION,
      systemPrompt: ANALYST_QA_SYSTEM_PROMPT,
      userPrompt: buildAnalystQaUserPrompt(
        context,
        input.draft,
        draftValidation.issues,
      ),
      maxTokens: ANALYST_MAX_TOKENS,
      timeoutMs: clampAnalystTimeout(input.timeoutMs),
    },
    analystQaOutputSchema,
  );
  const latencyMs = Date.now() - t1;
  return call.ok
    ? { ok: true, value: call.value, logs: call.logs, latencyMs }
    : { ok: false, errorCode: call.errorCode, logs: call.logs, latencyMs };
}

function clampAnalystTimeout(timeoutMs?: number): number {
  return Math.max(1_000, Math.min(timeoutMs ?? ANALYST_TIMEOUT_MS, ANALYST_TIMEOUT_MS));
}

/**
 * 两遍结果 → 最终硬校验 + 消毒 + 证据索引（纯函数，零 LLM）。
 * passB=null 表示 QA 未获得有效输出（调用失败或本 tick 未执行完）。
 */
export function finalizeAnalystSynthesis(input: {
  result: AnalysisResultV2;
  coverage: AnalystCoverage;
  passA: AnalystLlmOutput;
  passB: AnalystQaOutput | null;
  passBErrorCode: string | null;
  logs: LlmCallLog[];
  analystLatencyMs: number;
  reviewLatencyMs: number;
}): TenderAnalystSynthesisV1 {
  let finalDraft: AnalystLlmOutput;
  let qaStatus: TenderAnalystSynthesisV1["qa"]["status"];
  let qaIssues: string[];
  let needsHumanReview: boolean;

  if (input.passB) {
    const qa = input.passB;
    finalDraft = qa.verdict === "REVISED" && qa.revised ? qa.revised : input.passA;
    qaStatus = qa.verdict === "REVISED" ? "REVISED" : "PASS";
    qaIssues = qa.issues;
    needsHumanReview = qa.needsHumanReview;
  } else {
    // QA 不可用：保留 PASS A（仍经硬校验消毒），标记需人工复核
    finalDraft = input.passA;
    qaStatus = "SKIPPED";
    qaIssues = [
      `QA reviewer 调用失败（${input.passBErrorCode ?? "UNKNOWN"}），结果未经二次审校`,
    ];
    needsHumanReview = true;
  }

  // —— 最终硬校验（QA 修订版同样不得引用不存在实体） ——
  const finalValidation = validateTenderAnalystSynthesis(finalDraft, input.result);
  const sanitized = finalValidation.sanitized;
  if (finalValidation.removedCount > 0) needsHumanReview = true;
  if (qaStatus === "PASS" && !finalValidation.ok) qaStatus = "REVISED";

  return {
    ...sanitized,
    version: TENDER_ANALYST_SYNTHESIS_VERSION,
    language: "zh-CN",
    coverage: input.coverage,
    qa: {
      status: needsHumanReview ? "NEEDS_HUMAN_REVIEW" : qaStatus,
      issues: [...qaIssues, ...finalValidation.issues].slice(0, 40),
      needsHumanReview,
    },
    evidenceIndex: hydrateEvidenceIndex(sanitized, input.result),
    telemetry: {
      analystLatencyMs: input.analystLatencyMs,
      reviewLatencyMs: input.reviewLatencyMs,
      totalLlmCalls: input.logs.length,
      llmFailures: input.logs.filter((l) => !l.ok).length,
      model: input.logs.find((l) => l.ok)?.model ?? null,
    },
  };
}

/** 单次编排（eval/benchmark 与非分片路径）：PASS A → PASS B → finalize。 */
export async function runAnalystSynthesis(input: {
  result: AnalysisResultV2;
  coverage: AnalystCoverage;
  invoker?: LlmInvoker;
}): Promise<AnalystSynthesisRunResult> {
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const logs: LlmCallLog[] = [];

  const passA = await runAnalystPassA({ result: input.result, invoker });
  logs.push(...passA.logs);

  if (!passA.ok) {
    return {
      synthesis: null,
      logs,
      llmCalls: passA.logs.length,
      llmFailures: passA.logs.filter((l) => !l.ok).length,
      analystLatencyMs: passA.latencyMs,
      reviewLatencyMs: 0,
    };
  }

  const passB = await runAnalystPassB({
    result: input.result,
    draft: passA.value,
    invoker,
  });
  logs.push(...passB.logs);

  const synthesis = finalizeAnalystSynthesis({
    result: input.result,
    coverage: input.coverage,
    passA: passA.value,
    passB: passB.ok ? passB.value : null,
    passBErrorCode: passB.ok ? null : passB.errorCode,
    logs,
    analystLatencyMs: passA.latencyMs,
    reviewLatencyMs: passB.latencyMs,
  });

  return {
    synthesis,
    logs,
    llmCalls: logs.length,
    llmFailures: logs.filter((l) => !l.ok).length,
    analystLatencyMs: passA.latencyMs,
    reviewLatencyMs: passB.latencyMs,
  };
}
