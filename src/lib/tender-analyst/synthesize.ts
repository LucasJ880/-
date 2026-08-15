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
const ANALYST_TIMEOUT_MS = 240_000;

export type AnalystSynthesisRunResult = {
  synthesis: TenderAnalystSynthesisV1 | null;
  logs: LlmCallLog[];
  llmCalls: number;
  llmFailures: number;
  analystLatencyMs: number;
  reviewLatencyMs: number;
};

export async function runAnalystSynthesis(input: {
  result: AnalysisResultV2;
  coverage: AnalystCoverage;
  invoker?: LlmInvoker;
}): Promise<AnalystSynthesisRunResult> {
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const context = buildTenderAnalystContext(input.result);
  const logs: LlmCallLog[] = [];

  // —— PASS A：Senior Tender Analyst ——
  const t0 = Date.now();
  const passA = await callStructured(
    invoker,
    {
      promptName: ANALYST_PROMPT_NAME,
      promptVersion: ANALYST_PROMPT_VERSION,
      systemPrompt: ANALYST_SYSTEM_PROMPT,
      userPrompt: buildAnalystUserPrompt(context),
      maxTokens: ANALYST_MAX_TOKENS,
      timeoutMs: ANALYST_TIMEOUT_MS,
    },
    analystLlmOutputSchema,
  );
  const analystLatencyMs = Date.now() - t0;
  logs.push(...passA.logs);

  if (!passA.ok) {
    return {
      synthesis: null,
      logs,
      llmCalls: passA.logs.length,
      llmFailures: passA.logs.filter((l) => !l.ok).length,
      analystLatencyMs,
      reviewLatencyMs: 0,
    };
  }

  const draftValidation = validateTenderAnalystSynthesis(passA.value, input.result);

  // —— PASS B：Analyst QA Reviewer（不得引入新事实） ——
  const t1 = Date.now();
  const passB = await callStructured(
    invoker,
    {
      promptName: ANALYST_QA_PROMPT_NAME,
      promptVersion: ANALYST_QA_PROMPT_VERSION,
      systemPrompt: ANALYST_QA_SYSTEM_PROMPT,
      userPrompt: buildAnalystQaUserPrompt(
        context,
        passA.value,
        draftValidation.issues,
      ),
      maxTokens: ANALYST_MAX_TOKENS,
      timeoutMs: ANALYST_TIMEOUT_MS,
    },
    analystQaOutputSchema,
  );
  const reviewLatencyMs = Date.now() - t1;
  logs.push(...passB.logs);

  let finalDraft: AnalystLlmOutput;
  let qaStatus: TenderAnalystSynthesisV1["qa"]["status"];
  let qaIssues: string[];
  let needsHumanReview: boolean;

  if (passB.ok) {
    const qa = passB.value;
    finalDraft = qa.verdict === "REVISED" && qa.revised ? qa.revised : passA.value;
    qaStatus = qa.verdict === "REVISED" ? "REVISED" : "PASS";
    qaIssues = qa.issues;
    needsHumanReview = qa.needsHumanReview;
  } else {
    // QA 不可用：保留 PASS A（仍经硬校验消毒），标记需人工复核
    finalDraft = passA.value;
    qaStatus = "SKIPPED";
    qaIssues = [`QA reviewer 调用失败（${passB.errorCode}），结果未经二次审校`];
    needsHumanReview = true;
  }

  // —— 最终硬校验（QA 修订版同样不得引用不存在实体） ——
  const finalValidation = validateTenderAnalystSynthesis(finalDraft, input.result);
  const sanitized = finalValidation.sanitized;
  if (finalValidation.removedCount > 0) needsHumanReview = true;
  if (qaStatus === "PASS" && !finalValidation.ok) qaStatus = "REVISED";

  const synthesis: TenderAnalystSynthesisV1 = {
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
      analystLatencyMs,
      reviewLatencyMs,
      totalLlmCalls: logs.length,
      llmFailures: logs.filter((l) => !l.ok).length,
      model: logs.find((l) => l.ok)?.model ?? null,
    },
  };

  return {
    synthesis,
    logs,
    llmCalls: logs.length,
    llmFailures: logs.filter((l) => !l.ok).length,
    analystLatencyMs,
    reviewLatencyMs,
  };
}
