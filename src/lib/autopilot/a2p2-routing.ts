/**
 * Autopilot A2-P2.0 — deterministic evaluation router.
 *
 * Automation First, Human by Exception.
 * AUTO_FINALIZE finalizes the evaluation record; it does not execute
 * an external business action.
 *
 * Not wired to the processor, Judge, or any recovery worker.
 */

import {
  A2P2_ROUTER_VERSION,
  isForbiddenSideEffectAction,
  isJudgeEligiblePrivacyClass,
  type AutonomousEvaluationTaskContract,
  type EvaluationEvidenceStatus,
  type EvaluationOutcomeHint,
  type EvaluationPrivacyClass,
  type EvaluationRecoveryActionKind,
  type EvaluationRecoveryStatus,
  type EvaluationRouteDecisionKind,
  type EvaluationRouteReasonCode,
} from "./a2p2-contract";

export type EvaluationRouteInput = {
  taskContract: AutonomousEvaluationTaskContract;
  evaluationState: {
    outcome?: EvaluationOutcomeHint;
    final?: boolean;
  };
  evidenceState: {
    status: EvaluationEvidenceStatus;
    privacyClass?: EvaluationPrivacyClass;
  };
  recoveryState: {
    status: EvaluationRecoveryStatus;
    cyclesUsed?: number;
  };
  budgetState: {
    judgeCallsUsed: number;
    recoveryCyclesUsed: number;
    externalSearchesUsed: number;
    costUsdUsed: number;
  };
  policySignals?: {
    privacyBlocked?: boolean;
    restrictedAction?: boolean;
  };
};

export type EvaluationRouteDecision = {
  routerVersion: typeof A2P2_ROUTER_VERSION;
  decision: EvaluationRouteDecisionKind;
  reasonCode: EvaluationRouteReasonCode;
  allowedNextActions: readonly EvaluationRecoveryActionKind[];
};

const TERMINAL_OUTCOMES: readonly EvaluationOutcomeHint[] = [
  "TASK_SUCCESS",
  "PARTIAL_SUCCESS",
  "FAILURE",
];

function decided(
  decision: EvaluationRouteDecisionKind,
  reasonCode: EvaluationRouteReasonCode,
  allowedNextActions: readonly EvaluationRecoveryActionKind[] = [],
): EvaluationRouteDecision {
  return {
    routerVersion: A2P2_ROUTER_VERSION,
    decision,
    reasonCode,
    allowedNextActions,
  };
}

function isEvaluationFinal(input: EvaluationRouteInput): boolean {
  if (input.evaluationState.final === true) return true;
  const outcome = input.evaluationState.outcome;
  return outcome != null && TERMINAL_OUTCOMES.includes(outcome);
}

function budgetExhausted(input: EvaluationRouteInput): boolean {
  const budget = input.taskContract.evaluationBudget;
  const used = input.budgetState;
  return (
    used.judgeCallsUsed >= budget.maxJudgeCalls ||
    used.recoveryCyclesUsed >= budget.maxRecoveryCycles ||
    used.externalSearchesUsed >= budget.maxExternalSearches ||
    used.costUsdUsed >= budget.maxCostUsd
  );
}

function recoveryBudgetRemaining(input: EvaluationRouteInput): boolean {
  const policy = input.taskContract.recoveryPolicy;
  const cyclesUsed = Math.max(
    input.recoveryState.cyclesUsed ?? 0,
    input.budgetState.recoveryCyclesUsed,
  );
  return (
    policy.enabled &&
    policy.maxRecoveryCycles > 0 &&
    cyclesUsed < policy.maxRecoveryCycles &&
    cyclesUsed < input.taskContract.evaluationBudget.maxRecoveryCycles
  );
}

function canAutoRecover(input: EvaluationRouteInput): boolean {
  if (budgetExhausted(input)) return false;
  if (!recoveryBudgetRemaining(input)) return false;
  if (input.recoveryState.status === "NOT_ALLOWED") return false;
  if (input.recoveryState.status === "EXHAUSTED") return false;
  if (input.taskContract.recoveryPolicy.allowedActions.length === 0) return false;
  if (
    input.recoveryState.status === "AVAILABLE" ||
    input.recoveryState.status === "NOT_ATTEMPTED" ||
    input.recoveryState.status === "IN_PROGRESS"
  ) {
    return true;
  }
  return false;
}

function recoveryActions(
  input: EvaluationRouteInput,
): readonly EvaluationRecoveryActionKind[] {
  return input.taskContract.recoveryPolicy.allowedActions.filter(
    (action) => !isForbiddenSideEffectAction(action),
  );
}

/**
 * Precedence:
 * 1. policy / privacy hard block
 * 2. restricted / high-risk human gate
 * 3. insufficient evidence + safe recovery + budget
 * 4. conflicting evidence
 * 5. low-risk UNKNOWN with no useful recovery
 * 6. sufficient evidence + final + policy allows
 *
 * UNKNOWN never defaults to HUMAN_ESCALATE.
 */
export function routeEvaluation(
  input: EvaluationRouteInput,
): EvaluationRouteDecision {
  const risk = input.taskContract.riskClass;
  const evidence = input.evidenceState.status;
  const outcome = input.evaluationState.outcome ?? "UNKNOWN";
  const final = isEvaluationFinal(input);
  const actions = recoveryActions(input);
  const recover = canAutoRecover(input);

  if (
    evidence === "PRIVACY_BLOCKED" ||
    input.policySignals?.privacyBlocked === true ||
    (input.evidenceState.privacyClass != null &&
      !isJudgeEligiblePrivacyClass(input.evidenceState.privacyClass))
  ) {
    return decided("POLICY_BLOCKED", "POLICY_BLOCKED_PRIVACY");
  }

  if (input.policySignals?.restrictedAction === true) {
    return decided("POLICY_BLOCKED", "POLICY_BLOCKED_RESTRICTED_ACTION");
  }

  if (risk === "RESTRICTED") {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_HIGH_RISK");
  }
  if (risk === "HIGH") {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_HIGH_RISK");
  }

  if (budgetExhausted(input)) {
    if (evidence === "SUFFICIENT" && final) {
      return decided("AUTO_FINALIZE", "AUTO_FINALIZED_SUFFICIENT_EVIDENCE");
    }
    if (risk === "LOW") {
      return decided("AUTO_ABSTAIN", "BUDGET_EXHAUSTED");
    }
    return decided("HUMAN_ESCALATE", "BUDGET_EXHAUSTED");
  }

  if (evidence === "INSUFFICIENT" && recover) {
    return decided("AUTO_RECOVER", "AUTO_RECOVERY_MISSING_EVIDENCE", actions);
  }

  if (evidence === "CONFLICTING") {
    if (recover) {
      return decided("AUTO_RECOVER", "AUTO_RECOVERY_SOURCE_CONFLICT", actions);
    }
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_EVIDENCE_CONFLICT");
  }

  if (
    risk === "LOW" &&
    (outcome === "UNKNOWN" || evidence === "INSUFFICIENT") &&
    !recover
  ) {
    return decided("AUTO_ABSTAIN", "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE");
  }

  if (risk === "MEDIUM" && evidence !== "SUFFICIENT" && !recover) {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_RECOVERY_EXHAUSTED");
  }

  if (evidence === "SUFFICIENT" && final) {
    return decided("AUTO_FINALIZE", "AUTO_FINALIZED_SUFFICIENT_EVIDENCE");
  }

  if (risk === "LOW") {
    return decided("AUTO_ABSTAIN", "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE");
  }
  return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_RECOVERY_EXHAUSTED");
}
