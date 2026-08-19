/**
 * Persist A2-P1 LLM Judge after deterministic evaluation.
 * Never throws to Observe projection. Flag default OFF. No Evaluator Agent.
 */

import { db } from "@/lib/db";
import {
  acceptLlmJudgeVerdict,
  buildLlmJudgePacket,
  isLlmJudgeEligible,
  LLM_JUDGE_SYSTEM_PROMPT,
  llmJudgeUnavailable,
  llmJudgeUserPrompt,
  shouldReuseExistingLlmJudge,
  type LlmJudgeEventCounts,
} from "./evaluate-judge";
import { evaluateDeterministicRun } from "./evaluate";
import { isAutopilotLlmJudgeEnabled, type AutopilotFlagEnv } from "./flags";
import { upsertAutopilotEvaluation } from "./repository";
import type { AutopilotTraceEventType } from "./types";
import { AUTOPILOT_LLM_EVALUATOR_KIND, AUTOPILOT_LLM_EVALUATOR_VERSION } from "./types";

export type LlmJudgePort = {
  complete: (input: {
    systemPrompt: string;
    userPrompt: string;
  }) => Promise<string>;
};

async function defaultLlmJudgePort(): Promise<LlmJudgePort> {
  const { createCompletion } = await import("@/lib/ai/client");
  return {
    complete: async ({ systemPrompt, userPrompt }) =>
      createCompletion({
        systemPrompt,
        userPrompt,
        mode: "fast",
        maxTokens: 400,
        timeoutMs: 15_000,
        // Do not pass agentRunId: judge must not write model.* onto the observed run.
      }),
  };
}

async function loadEventCounts(
  orgId: string,
  autopilotRunId: string,
): Promise<LlmJudgeEventCounts> {
  const groups = await db.autopilotRunEvent.groupBy({
    by: ["eventType"],
    where: { orgId, runId: autopilotRunId },
    _count: { _all: true },
  });
  const counts: LlmJudgeEventCounts = {};
  for (const row of groups) {
    counts[row.eventType as AutopilotTraceEventType] = row._count._all;
  }
  return counts;
}

export async function persistLlmJudgeEvaluation(input: {
  orgId: string;
  agentRunId: string;
  autopilotRunId: string;
  status?: string | null;
  errorCode?: string | null;
  humanOverride?: boolean;
  humanEdit?: boolean;
  reAskStatus?: string | null;
  env?: AutopilotFlagEnv;
  judge?: LlmJudgePort;
}): Promise<void> {
  const env = input.env ?? process.env;
  if (!isAutopilotLlmJudgeEnabled(env)) return;

  const reAsk =
    input.reAskStatus === "CONFIRMED" || input.reAskStatus === "CANDIDATE";
  const deterministic = evaluateDeterministicRun({
    status: input.status,
    errorCode: input.errorCode,
    humanOverride: input.humanOverride,
    humanEdit: input.humanEdit,
    reAsk,
  });
  if (
    !isLlmJudgeEligible({
      status: input.status,
      deterministicOutcome: deterministic.outcome,
    })
  ) {
    return;
  }

  const eventCounts = await loadEventCounts(input.orgId, input.autopilotRunId);
  const packet = buildLlmJudgePacket({
    status: input.status,
    errorCode: input.errorCode,
    humanOverride: input.humanOverride,
    humanEdit: input.humanEdit,
    reAsk,
    eventCounts,
  });

  const existing = await db.autopilotEvaluation.findFirst({
    where: {
      orgId: input.orgId,
      agentRunId: input.agentRunId,
      evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
    },
    select: { ruleId: true, evidence: true },
  });
  if (shouldReuseExistingLlmJudge(existing, packet)) return;

  let verdict = llmJudgeUnavailable(packet);
  try {
    const port = input.judge ?? (await defaultLlmJudgePort());
    const raw = await port.complete({
      systemPrompt: LLM_JUDGE_SYSTEM_PROMPT,
      userPrompt: llmJudgeUserPrompt(packet),
    });
    verdict = acceptLlmJudgeVerdict(packet, raw);
  } catch {
    verdict = llmJudgeUnavailable(packet);
  }

  await upsertAutopilotEvaluation({
    orgId: input.orgId,
    agentRunId: input.agentRunId,
    autopilotRunId: input.autopilotRunId,
    evaluatorKind: AUTOPILOT_LLM_EVALUATOR_KIND,
    evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
    outcome: verdict.outcome,
    failureType: verdict.failureType,
    failureSource: verdict.failureSource,
    judged: verdict.judged,
    ruleId: verdict.ruleId,
    evidence: verdict.evidence,
  });
}
