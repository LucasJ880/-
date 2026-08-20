/**
 * Autopilot A2-P0 deterministic evaluation.
 *
 * Answers WAS IT GOOD? with explicit rules only.
 * Completed ≠ TASK_SUCCESS.
 * HUMAN_OVERRIDE / HUMAN_EDIT / RE_ASK ≠ AI_WRONG / HALLUCINATION.
 * Does not call an LLM Judge.
 */

import { mapDeterministicFailureType, mapDeterministicOutcome } from "./outcome";
import type {
  AutopilotEvaluateRuleId,
  AutopilotFailureSource,
  AutopilotFailureType,
  AutopilotOutcome,
} from "./types";
import {
  AUTOPILOT_EVALUATOR_KIND,
  AUTOPILOT_EVALUATOR_VERSION,
} from "./types";

export const A2_P0_NEVER_ASSIGNED_OUTCOMES = [
  "TASK_SUCCESS",
  "PARTIAL_SUCCESS",
] as const;

export const A2_P0_NEVER_ASSIGNED_FAILURES = [
  "INTENT_ERROR",
  "CONTEXT_MISSING",
  "WRONG_TOOL",
  "REASONING_ERROR",
  "HALLUCINATION",
  "USER_INPUT_AMBIGUOUS",
] as const;

export type DeterministicEvaluateInput = {
  status?: string | null;
  errorCode?: string | null;
  humanOverride?: boolean;
  humanEdit?: boolean;
  reAsk?: boolean;
  cancelled?: boolean;
};

export type DeterministicEvaluation = {
  evaluatorKind: typeof AUTOPILOT_EVALUATOR_KIND;
  evaluatorVersion: typeof AUTOPILOT_EVALUATOR_VERSION;
  outcome: AutopilotOutcome;
  failureType: AutopilotFailureType | null;
  failureSource: AutopilotFailureSource;
  judged: boolean;
  ruleId: AutopilotEvaluateRuleId;
  evidence: {
    status: string | null;
    errorCode: string | null;
    humanOverride: boolean;
    humanEdit: boolean;
    reAsk: boolean;
  };
};

function normalizeStatus(status?: string | null): string | null {
  const value = (status ?? "").trim().toLowerCase();
  return value || null;
}

export function evaluateDeterministicRun(
  input: DeterministicEvaluateInput,
): DeterministicEvaluation {
  const status = normalizeStatus(input.status);
  const humanOverride = input.humanOverride === true;
  const humanEdit = input.humanEdit === true;
  const reAsk = input.reAsk === true;
  const errorCode = input.errorCode?.trim() || null;
  const evidence = {
    status,
    errorCode,
    humanOverride,
    humanEdit,
    reAsk,
  };

  const outcome = mapDeterministicOutcome({
    status,
    errorCode,
    humanOverride,
    cancelled: input.cancelled,
  });

  if (outcome === "HUMAN_OVERRIDE") {
    return {
      evaluatorKind: AUTOPILOT_EVALUATOR_KIND,
      evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      outcome,
      failureType: null,
      failureSource: "human_signal",
      judged: true,
      ruleId: "HUMAN_OVERRIDE_PRESENT",
      evidence,
    };
  }

  if (outcome === "FAILURE") {
    const failure = mapDeterministicFailureType(errorCode);
    return {
      evaluatorKind: AUTOPILOT_EVALUATOR_KIND,
      evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      outcome,
      failureType: failure?.failureType ?? "UNKNOWN",
      failureSource: "system",
      judged: true,
      ruleId: "RUNTIME_FAILED",
      evidence,
    };
  }

  if (outcome === "ABANDONED") {
    return {
      evaluatorKind: AUTOPILOT_EVALUATOR_KIND,
      evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      outcome,
      failureType: null,
      failureSource: "system",
      judged: true,
      ruleId: "RUNTIME_CANCELLED",
      evidence,
    };
  }

  return {
    evaluatorKind: AUTOPILOT_EVALUATOR_KIND,
    evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
    outcome: "UNKNOWN",
    failureType: null,
    failureSource: null,
    judged: false,
    ruleId: "NOT_JUDGED",
    evidence,
  };
}

export function a2p0AssignsTaskSuccess(): boolean {
  return false;
}

export function humanSignalMapsToHallucination(): boolean {
  return false;
}

export function isForbiddenA2P0FailureType(
  failureType: AutopilotFailureType | null,
): boolean {
  if (!failureType) return false;
  return (A2_P0_NEVER_ASSIGNED_FAILURES as readonly string[]).includes(
    failureType,
  );
}

export function isKnownAutopilotOutcome(value: string): value is AutopilotOutcome {
  return (
    value === "TASK_SUCCESS" ||
    value === "PARTIAL_SUCCESS" ||
    value === "FAILURE" ||
    value === "ABANDONED" ||
    value === "HUMAN_OVERRIDE" ||
    value === "UNKNOWN"
  );
}
