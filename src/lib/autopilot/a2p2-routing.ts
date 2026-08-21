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
  automationLevelPolicy,
  isExternalResearchAction,
  isForbiddenSideEffectAction,
  isJudgeEligiblePrivacyClass,
  parseTaskContract,
  type AutonomousEvaluationTaskContract,
  type EvaluationEvidenceStatus,
  type EvaluationOutcomeHint,
  type EvaluationPrivacyClass,
  type EvaluationRecoveryActionKind,
  type EvaluationRecoveryStatus,
  type EvaluationRouteDecisionKind,
  type EvaluationRouteReasonCode,
  type EvaluationVerdictState,
  type ValidatedTaskContract,
} from "./a2p2-contract";

export type EvaluationPolicySignals = {
  privacyBlocked?: boolean;
  restrictedAction?: boolean;
  legalCommitment?: boolean;
  financialCommitment?: boolean;
  externalSideEffect?: boolean;
  irreversibleAction?: boolean;
  goalAmbiguous?: boolean;
};

export type EvaluationRouteInput = {
  taskContract: ValidatedTaskContract | AutonomousEvaluationTaskContract | unknown;
  evaluationState: {
    outcome?: EvaluationOutcomeHint;
    verdictState?: EvaluationVerdictState;
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
  policySignals?: EvaluationPolicySignals;
};

export type EvaluationRouteDecision = {
  routerVersion: typeof A2P2_ROUTER_VERSION;
  decision: EvaluationRouteDecisionKind;
  reasonCode: EvaluationRouteReasonCode;
  allowedNextActions: readonly EvaluationRecoveryActionKind[];
};

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

function verdictStateOf(
  input: EvaluationRouteInput,
): EvaluationVerdictState {
  if (input.evaluationState.verdictState) return input.evaluationState.verdictState;
  const outcome = input.evaluationState.outcome;
  if (
    outcome === "TASK_SUCCESS" ||
    outcome === "PARTIAL_SUCCESS" ||
    outcome === "FAILURE"
  ) {
    return "PROPOSED";
  }
  return "NOT_EVALUATED";
}

function globalRecoveryStopped(input: EvaluationRouteInput, contract: ValidatedTaskContract): boolean {
  const used = input.budgetState;
  const cyclesUsed = Math.max(
    input.recoveryState.cyclesUsed ?? 0,
    used.recoveryCyclesUsed,
  );
  return (
    used.costUsdUsed >= contract.evaluationBudget.maxCostUsd ||
    cyclesUsed >= contract.recoveryPolicy.maxRecoveryCycles ||
    cyclesUsed >= contract.evaluationBudget.maxRecoveryCycles
  );
}

function filterRecoveryActions(
  input: EvaluationRouteInput,
  contract: ValidatedTaskContract,
): readonly EvaluationRecoveryActionKind[] {
  const policy = contract.recoveryPolicy;
  if (!policy.enabled) return [];
  if (input.recoveryState.status === "NOT_ALLOWED") return [];
  if (input.recoveryState.status === "EXHAUSTED") return [];
  if (globalRecoveryStopped(input, contract)) return [];
  const externalSearchExhausted =
    input.budgetState.externalSearchesUsed >= contract.evaluationBudget.maxExternalSearches;
  return policy.allowedActions.filter((action) => {
    if (isForbiddenSideEffectAction(action)) return false;
    if (!policy.allowExternalResearch && isExternalResearchAction(action)) return false;
    if (externalSearchExhausted && isExternalResearchAction(action)) return false;
    return true;
  });
}

/**
 * Precedence:
 * 1. unvalidated / privacy / restricted hard block
 * 2. L5 restricted automation
 * 3. legal / financial / external / irreversible
 * 4. contract requireHumanForRisk / L0
 * 5. goalAmbiguous
 * 6. recovery already IN_PROGRESS → AUTO_WAIT
 * 7. insufficient / conflicting + remaining safe recovery
 * 8. ACCEPTED + sufficient → AUTO_FINALIZE
 * 9. low-risk unresolved → AUTO_ABSTAIN
 *
 * UNKNOWN never defaults to HUMAN_ESCALATE.
 * Outcome values never imply finality. Only ACCEPTED may AUTO_FINALIZE.
 */
export function routeEvaluation(
  input: EvaluationRouteInput,
): EvaluationRouteDecision {
  const parsed = parseTaskContract(input.taskContract);
  if (!parsed.ok) {
    return decided("POLICY_BLOCKED", "POLICY_BLOCKED_UNVALIDATED_CONTRACT");
  }
  const contract = parsed.contract;
  const risk = contract.riskClass;
  const evidence = input.evidenceState.status;
  const outcome = input.evaluationState.outcome ?? "UNKNOWN";
  const verdictState = verdictStateOf(input);
  const autoPolicy = automationLevelPolicy(contract.automationLevel);

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

  if (autoPolicy.failClosedDecision && autoPolicy.failClosedReason) {
    return decided(autoPolicy.failClosedDecision, autoPolicy.failClosedReason);
  }

  if (input.policySignals?.legalCommitment === true) {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_LEGAL_COMMITMENT");
  }
  if (input.policySignals?.financialCommitment === true) {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_FINANCIAL_COMMITMENT");
  }
  if (input.policySignals?.externalSideEffect === true) {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_EXTERNAL_SIDE_EFFECT");
  }
  if (input.policySignals?.irreversibleAction === true) {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_IRREVERSIBLE_ACTION");
  }

  if (contract.escalationPolicy.requireHumanForRisk.includes(risk)) {
    return decided(
      "HUMAN_ESCALATE",
      risk === "MEDIUM"
        ? "HUMAN_ESCALATION_CONTRACT_POLICY"
        : "HUMAN_ESCALATION_HIGH_RISK",
    );
  }

  if (input.policySignals?.goalAmbiguous === true) {
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_GOAL_AMBIGUOUS");
  }

  if (input.recoveryState.status === "IN_PROGRESS") {
    return decided("AUTO_WAIT", "AUTO_WAIT_RECOVERY_IN_PROGRESS");
  }

  const actions = autoPolicy.mayAutoRecover
    ? filterRecoveryActions(input, contract)
    : [];
  const recover = actions.length > 0;

  if (evidence === "INSUFFICIENT" && recover) {
    return decided("AUTO_RECOVER", "AUTO_RECOVERY_MISSING_EVIDENCE", actions);
  }

  if (evidence === "CONFLICTING") {
    if (recover) {
      return decided("AUTO_RECOVER", "AUTO_RECOVERY_SOURCE_CONFLICT", actions);
    }
    return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_EVIDENCE_CONFLICT");
  }

  const acceptedFinal =
    autoPolicy.mayAutoFinalize &&
    verdictState === "ACCEPTED" &&
    evidence === "SUFFICIENT";

  if (acceptedFinal) {
    return decided("AUTO_FINALIZE", "AUTO_FINALIZED_SUFFICIENT_EVIDENCE");
  }

  if (globalRecoveryStopped(input, contract) && !recover) {
    if (risk === "LOW") {
      return decided("AUTO_ABSTAIN", "BUDGET_EXHAUSTED");
    }
    return decided("HUMAN_ESCALATE", "BUDGET_EXHAUSTED");
  }

  if (verdictState === "ABSTAINED") {
    return decided("AUTO_ABSTAIN", "AUTO_FINALIZED_ABSTENTION");
  }

  if (
    risk === "LOW" &&
    (outcome === "UNKNOWN" || evidence === "INSUFFICIENT") &&
    !recover
  ) {
    return decided("AUTO_ABSTAIN", "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE");
  }

  if (risk === "LOW") {
    return decided("AUTO_ABSTAIN", "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE");
  }
  return decided("HUMAN_ESCALATE", "HUMAN_ESCALATION_RECOVERY_EXHAUSTED");
}
