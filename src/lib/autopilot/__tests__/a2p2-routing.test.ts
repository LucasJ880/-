/**
 * Autopilot A2-P2.0 routing — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-routing.test.ts
 */

import {
  A2P2_DEFAULT_EVALUATION_BUDGET,
  A2P2_PRINCIPLES,
  EVALUATION_RECOVERY_AUTHORITY_MAX,
  automationLevelPolicy,
  type AutonomousEvaluationTaskContract,
  type EvaluationRiskClass,
  type EvaluationVerdictState,
} from "../a2p2-contract";
import { routeEvaluation, type EvaluationRouteInput } from "../a2p2-routing";
import { A2P2_DOMAIN_TEMPLATES, resolveTaskContract } from "../a2p2-templates";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

function plain(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function withPatch(
  contract: AutonomousEvaluationTaskContract,
  patch: Record<string, unknown>,
): AutonomousEvaluationTaskContract {
  return { ...plain(contract), ...patch } as AutonomousEvaluationTaskContract;
}

function input(partial: {
  contract?: AutonomousEvaluationTaskContract;
  risk?: EvaluationRiskClass;
  outcome?: EvaluationRouteInput["evaluationState"]["outcome"];
  verdictState?: EvaluationVerdictState;
  evidence: EvaluationRouteInput["evidenceState"]["status"];
  privacyClass?: EvaluationRouteInput["evidenceState"]["privacyClass"];
  recovery?: EvaluationRouteInput["recoveryState"]["status"];
  cyclesUsed?: number;
  budgetUsed?: Partial<EvaluationRouteInput["budgetState"]>;
  policySignals?: EvaluationRouteInput["policySignals"];
}): EvaluationRouteInput {
  const now = new Date().toISOString();
  let contract = partial.contract ?? A2P2_DOMAIN_TEMPLATES.RESEARCH(now);
  if (partial.risk) contract = withPatch(contract, { riskClass: partial.risk });
  return {
    taskContract: contract,
    evaluationState: {
      outcome: partial.outcome ?? "UNKNOWN",
      verdictState: partial.verdictState,
    },
    evidenceState: {
      status: partial.evidence,
      privacyClass: partial.privacyClass,
    },
    recoveryState: {
      status: partial.recovery ?? "AVAILABLE",
      cyclesUsed: partial.cyclesUsed ?? 0,
    },
    budgetState: {
      judgeCallsUsed: 0,
      recoveryCyclesUsed: 0,
      externalSearchesUsed: 0,
      costUsdUsed: 0,
      ...partial.budgetUsed,
    },
    policySignals: partial.policySignals,
  };
}

console.log("autopilot A2-P2.0 routing");

ok(A2P2_PRINCIPLES.AUTOMATION_FIRST === true, "AUTOMATION_FIRST_DEFAULT");
ok(A2P2_PRINCIPLES.HUMAN_BY_EXCEPTION === true, "HUMAN_BY_EXCEPTION");
ok(
  EVALUATION_RECOVERY_AUTHORITY_MAX === "READ_SEARCH_VERIFY_ONLY",
  "EVALUATION_RECOVERY_AUTHORITY_MAX",
);

const proposedSuccess = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "PROPOSED",
    recovery: "NOT_ATTEMPTED",
  }),
);
ok(
  proposedSuccess.decision !== "AUTO_FINALIZE",
  "PROPOSED_TASK_SUCCESS_NOT_FINALIZED",
);

const proposedPartial = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "PARTIAL_SUCCESS",
    verdictState: "PROPOSED",
  }),
);
ok(
  proposedPartial.decision !== "AUTO_FINALIZE",
  "PROPOSED_PARTIAL_SUCCESS_NOT_FINALIZED",
);

const proposedFailure = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "FAILURE",
    verdictState: "PROPOSED",
  }),
);
ok(
  proposedFailure.decision !== "AUTO_FINALIZE",
  "PROPOSED_FAILURE_NOT_FINALIZED",
);

const acceptedSuccess = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    recovery: "NOT_ATTEMPTED",
  }),
);
const acceptedUnknown = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "UNKNOWN",
    verdictState: "ACCEPTED",
  }),
);
ok(
  acceptedUnknown.decision === "POLICY_BLOCKED" &&
    acceptedUnknown.reasonCode === "POLICY_BLOCKED_INVALID_EVALUATION_STATE",
  "ACCEPTED_UNKNOWN_REJECTED",
);

const abstainedSuccess = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ABSTAINED",
  }),
);
ok(
  abstainedSuccess.decision === "POLICY_BLOCKED" &&
    abstainedSuccess.reasonCode === "POLICY_BLOCKED_INVALID_EVALUATION_STATE",
  "ABSTAINED_SUCCESS_REJECTED",
);

const abstainedFailure = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "FAILURE",
    verdictState: "ABSTAINED",
  }),
);
ok(
  abstainedFailure.decision === "POLICY_BLOCKED" &&
    abstainedFailure.reasonCode === "POLICY_BLOCKED_INVALID_EVALUATION_STATE",
  "ABSTAINED_FAILURE_REJECTED",
);

const notEvaluatedSuccess = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "NOT_EVALUATED",
  }),
);
ok(
  notEvaluatedSuccess.decision === "POLICY_BLOCKED" &&
    notEvaluatedSuccess.reasonCode === "POLICY_BLOCKED_INVALID_EVALUATION_STATE",
  "NOT_EVALUATED_SUCCESS_REJECTED",
);

ok(
  acceptedSuccess.decision === "AUTO_FINALIZE" &&
    acceptedSuccess.reasonCode === "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
  "ACCEPTED_TASK_SUCCESS_CAN_FINALIZE",
);
ok(
  acceptedSuccess.decision === "AUTO_FINALIZE",
  "ACCEPTED_TASK_SUCCESS_VALID",
);

const acceptedPartial = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "PARTIAL_SUCCESS",
    verdictState: "ACCEPTED",
    recovery: "NOT_ATTEMPTED",
  }),
);
ok(
  acceptedPartial.decision === "AUTO_FINALIZE" &&
    acceptedPartial.reasonCode === "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
  "ACCEPTED_PARTIAL_SUCCESS_VALID",
);

const acceptedFailure = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "FAILURE",
    verdictState: "ACCEPTED",
    recovery: "NOT_ATTEMPTED",
  }),
);
ok(
  acceptedFailure.decision === "AUTO_FINALIZE" &&
    acceptedFailure.reasonCode === "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
  "ACCEPTED_FAILURE_VALID",
);

const legacyFinal = routeEvaluation({
  ...input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "PROPOSED",
    recovery: "NOT_ATTEMPTED",
  }),
  evaluationState: {
    outcome: "TASK_SUCCESS",
    verdictState: "PROPOSED",
    final: true,
  } as EvaluationRouteInput["evaluationState"] & { final: boolean },
});
ok(
  legacyFinal.decision !== "AUTO_FINALIZE",
  "FINAL_BOOLEAN_CANNOT_GRANT_AUTHORITY",
);

const unknownAbstention = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "UNKNOWN",
    verdictState: "ABSTAINED",
    recovery: "EXHAUSTED",
    cyclesUsed: 3,
  }),
);
ok(
  unknownAbstention.decision === "AUTO_ABSTAIN" &&
    unknownAbstention.decision !== "AUTO_FINALIZE",
  "UNKNOWN_ABSTENTION_NOT_SUCCESS",
);
ok(
  unknownAbstention.decision === "AUTO_ABSTAIN" &&
    unknownAbstention.reasonCode !== "POLICY_BLOCKED_INVALID_EVALUATION_STATE",
  "ABSTAINED_UNKNOWN_VALID",
);

const l0Finalize = routeEvaluation(
  input({
    contract: withPatch(A2P2_DOMAIN_TEMPLATES.RESEARCH(new Date().toISOString()), {
      automationLevel: "L0_HUMAN_CONTROLLED",
    }),
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
  }),
);
ok(
  l0Finalize.decision === "HUMAN_ESCALATE" &&
    l0Finalize.reasonCode === "HUMAN_ESCALATION_L0_HUMAN_CONTROLLED",
  "L0_NEVER_AUTO_FINALIZES",
);

const l0Recover = routeEvaluation(
  input({
    contract: withPatch(A2P2_DOMAIN_TEMPLATES.RESEARCH(new Date().toISOString()), {
      automationLevel: "L0_HUMAN_CONTROLLED",
    }),
    evidence: "INSUFFICIENT",
    outcome: "UNKNOWN",
    recovery: "AVAILABLE",
  }),
);
ok(
  l0Recover.decision === "HUMAN_ESCALATE" && l0Recover.allowedNextActions.length === 0,
  "L0_NEVER_AUTO_RECOVERS",
);

const l4Inspect = routeEvaluation(
  input({
    contract: withPatch(A2P2_DOMAIN_TEMPLATES.RESEARCH(new Date().toISOString()), {
      automationLevel: "L4_CONTROLLED_EXTERNAL_ACTION",
    }),
    evidence: "INSUFFICIENT",
    recovery: "AVAILABLE",
  }),
);
ok(
  automationLevelPolicy("L4_CONTROLLED_EXTERNAL_ACTION")
    .evaluationMayAuthorizeExternalAction === false &&
    l4Inspect.decision === "AUTO_RECOVER" &&
    !l4Inspect.allowedNextActions.includes("SEND_EMAIL" as never) &&
    l4Inspect.allowedNextActions.every(
      (action) =>
        action === "READ_EXISTING_DOCUMENT" ||
        action === "SEARCH_PROJECT_DOCUMENTS" ||
        action === "SEARCH_INTERNAL_FACTS" ||
        action === "SEARCH_PUBLIC_WEB" ||
        action === "SEARCH_AWARD_HISTORY" ||
        action === "REFRESH_SOURCE_FACTS" ||
        action === "RECHECK_TOOL_RESULT",
    ),
  "L4_EXTERNAL_ACTION_NOT_AUTHORIZED_BY_EVALUATION",
);

const l5Blocked = routeEvaluation(
  input({
    contract: withPatch(resolveTaskContract({}), {
      automationLevel: "L5_RESTRICTED",
      riskClass: "RESTRICTED",
    }),
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
  }),
);
ok(
  l5Blocked.decision === "POLICY_BLOCKED" &&
    l5Blocked.reasonCode === "POLICY_BLOCKED_L5_RESTRICTED",
  "L5_RESTRICTED_FAILS_CLOSED",
);

const mediumPolicy = routeEvaluation(
  input({
    contract: withPatch(A2P2_DOMAIN_TEMPLATES.EMAIL_DRAFT(new Date().toISOString()), {
      escalationPolicy: {
        requireHumanForRisk: ["MEDIUM", "HIGH", "RESTRICTED"],
        reasons: A2P2_DOMAIN_TEMPLATES.EMAIL_DRAFT(new Date().toISOString())
          .escalationPolicy.reasons,
      },
    }),
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
  }),
);
ok(
  mediumPolicy.decision === "HUMAN_ESCALATE" &&
    mediumPolicy.reasonCode === "HUMAN_ESCALATION_CONTRACT_POLICY",
  "CONTRACT_MEDIUM_HUMAN_POLICY_ENFORCED",
);
ok(
  mediumPolicy.decision === "HUMAN_ESCALATE",
  "MEDIUM_ADDED_TO_POLICY_ESCALATES",
);

const mediumCanAutomate = routeEvaluation(
  input({
    contract: A2P2_DOMAIN_TEMPLATES.EMAIL_DRAFT(new Date().toISOString()),
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    recovery: "NOT_ATTEMPTED",
  }),
);
ok(
  mediumCanAutomate.decision === "AUTO_FINALIZE",
  "MEDIUM_NOT_IN_POLICY_CAN_STILL_AUTOMATE",
);

const legal = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    policySignals: { legalCommitment: true },
  }),
);
ok(
  legal.decision === "HUMAN_ESCALATE" &&
    legal.reasonCode === "HUMAN_ESCALATION_LEGAL_COMMITMENT",
  "LEGAL_COMMITMENT_ESCALATES",
);

const financial = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    policySignals: { financialCommitment: true },
  }),
);
ok(
  financial.decision === "HUMAN_ESCALATE" &&
    financial.reasonCode === "HUMAN_ESCALATION_FINANCIAL_COMMITMENT",
  "FINANCIAL_COMMITMENT_ESCALATES",
);

const external = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    policySignals: { externalSideEffect: true },
  }),
);
ok(
  external.decision === "HUMAN_ESCALATE" &&
    external.reasonCode === "HUMAN_ESCALATION_EXTERNAL_SIDE_EFFECT",
  "EXTERNAL_SIDE_EFFECT_ESCALATES",
);

const irreversible = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    policySignals: { irreversibleAction: true },
  }),
);
ok(
  irreversible.decision === "HUMAN_ESCALATE" &&
    irreversible.reasonCode === "HUMAN_ESCALATION_IRREVERSIBLE_ACTION",
  "IRREVERSIBLE_ACTION_ESCALATES",
);

const ambiguousRecover = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    recovery: "AVAILABLE",
    policySignals: { goalAmbiguous: true },
  }),
);
ok(
  ambiguousRecover.decision === "AUTO_RECOVER" &&
    ambiguousRecover.reasonCode === "AUTO_RECOVERY_GOAL_AMBIGUOUS" &&
    ambiguousRecover.allowedNextActions.length > 0,
  "GOAL_AMBIGUOUS_RECOVERY_AVAILABLE",
);
ok(
  ambiguousRecover.decision !== "HUMAN_ESCALATE",
  "GOAL_AMBIGUOUS_DOES_NOT_DEFAULT_TO_HUMAN",
);

const ambiguousWait = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    recovery: "IN_PROGRESS",
    policySignals: { goalAmbiguous: true },
  }),
);
ok(
  ambiguousWait.decision === "AUTO_WAIT" &&
    ambiguousWait.reasonCode === "AUTO_WAIT_RECOVERY_IN_PROGRESS" &&
    ambiguousWait.allowedNextActions.length === 0,
  "GOAL_AMBIGUOUS_RECOVERY_IN_PROGRESS",
);

const ambiguousExhausted = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    recovery: "EXHAUSTED",
    cyclesUsed: 3,
    policySignals: { goalAmbiguous: true },
  }),
);
ok(
  ambiguousExhausted.decision === "HUMAN_ESCALATE" &&
    ambiguousExhausted.reasonCode === "HUMAN_ESCALATION_GOAL_AMBIGUOUS",
  "GOAL_AMBIGUOUS_RECOVERY_EXHAUSTED",
);

const unvalidated = routeEvaluation(
  input({
    contract: { extraField: true, outcome: "TASK_SUCCESS" } as never,
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
  }),
);
ok(
  unvalidated.decision === "POLICY_BLOCKED" &&
    unvalidated.reasonCode === "POLICY_BLOCKED_UNVALIDATED_CONTRACT" &&
    unvalidated.decision !== "AUTO_FINALIZE",
  "UNVALIDATED_CONTRACT_CANNOT_AUTO_FINALIZE",
);

const noExternalWeb = routeEvaluation(
  input({
    contract: A2P2_DOMAIN_TEMPLATES.EMAIL_DRAFT(new Date().toISOString()),
    evidence: "INSUFFICIENT",
    recovery: "AVAILABLE",
  }),
);
ok(
  noExternalWeb.decision === "AUTO_RECOVER" &&
    !noExternalWeb.allowedNextActions.includes("SEARCH_PUBLIC_WEB"),
  "EXTERNAL_RESEARCH_FALSE_BLOCKS_PUBLIC_WEB",
);
ok(
  !noExternalWeb.allowedNextActions.includes("SEARCH_AWARD_HISTORY"),
  "EXTERNAL_RESEARCH_FALSE_BLOCKS_AWARD_HISTORY",
);

const inProgress = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    recovery: "IN_PROGRESS",
    cyclesUsed: 1,
  }),
);
ok(
  inProgress.decision === "AUTO_WAIT" &&
    inProgress.reasonCode === "AUTO_WAIT_RECOVERY_IN_PROGRESS" &&
    inProgress.allowedNextActions.length === 0,
  "RECOVERY_IN_PROGRESS_NO_DUPLICATE_SCHEDULE",
);

const judgeBudgetLocal = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    outcome: "UNKNOWN",
    recovery: "AVAILABLE",
    budgetUsed: {
      judgeCallsUsed: A2P2_DEFAULT_EVALUATION_BUDGET.maxJudgeCalls,
    },
  }),
);
ok(
  judgeBudgetLocal.decision === "AUTO_RECOVER" &&
    judgeBudgetLocal.allowedNextActions.includes("READ_EXISTING_DOCUMENT") &&
    judgeBudgetLocal.allowedNextActions.includes("SEARCH_PROJECT_DOCUMENTS") &&
    judgeBudgetLocal.allowedNextActions.includes("SEARCH_INTERNAL_FACTS"),
  "JUDGE_BUDGET_EXHAUSTED_LOCAL_RECOVERY_STILL_ALLOWED",
);

const externalBudgetInternal = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    recovery: "AVAILABLE",
    budgetUsed: {
      externalSearchesUsed: A2P2_DEFAULT_EVALUATION_BUDGET.maxExternalSearches,
    },
  }),
);
ok(
  externalBudgetInternal.decision === "AUTO_RECOVER" &&
    !externalBudgetInternal.allowedNextActions.includes("SEARCH_PUBLIC_WEB") &&
    !externalBudgetInternal.allowedNextActions.includes("SEARCH_AWARD_HISTORY") &&
    externalBudgetInternal.allowedNextActions.includes("SEARCH_INTERNAL_FACTS"),
  "EXTERNAL_SEARCH_BUDGET_EXHAUSTED_INTERNAL_RECOVERY_ALLOWED",
);

const cycleCap = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    recovery: "AVAILABLE",
    cyclesUsed: 3,
    budgetUsed: { recoveryCyclesUsed: 3 },
  }),
);
ok(
  cycleCap.decision !== "AUTO_RECOVER",
  "RECOVERY_CYCLE_CAP_STOPS_RECOVERY",
);

const costCap = routeEvaluation(
  input({
    contract: resolveTaskContract({ domainHint: "GENERIC" }),
    evidence: "INSUFFICIENT",
    outcome: "UNKNOWN",
    recovery: "AVAILABLE",
    budgetUsed: {
      costUsdUsed: A2P2_DEFAULT_EVALUATION_BUDGET.maxCostUsd,
    },
  }),
);
ok(
  costCap.decision !== "AUTO_RECOVER" &&
    costCap.reasonCode === "BUDGET_EXHAUSTED",
  "GLOBAL_COST_CAP_STOPS_RECOVERY",
);

const lowSuccess = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    recovery: "NOT_ATTEMPTED",
  }),
);
ok(
  lowSuccess.decision === "AUTO_FINALIZE" &&
    lowSuccess.reasonCode === "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
  "LOW + sufficient + accepted → AUTO_FINALIZE",
);

const lowRecover = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    outcome: "UNKNOWN",
    recovery: "AVAILABLE",
  }),
);
ok(
  lowRecover.decision === "AUTO_RECOVER" &&
    lowRecover.reasonCode === "AUTO_RECOVERY_MISSING_EVIDENCE",
  "UNKNOWN_AUTO_RECOVERY_BEFORE_HUMAN",
);
ok(
  lowSuccess.decision === "AUTO_FINALIZE" &&
    lowRecover.decision === "AUTO_RECOVER",
  "LOW_AUTOMATION_FIRST_PRESERVED",
);

const lowAbstain = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    outcome: "UNKNOWN",
    recovery: "EXHAUSTED",
    cyclesUsed: 3,
  }),
);
ok(
  lowAbstain.decision === "AUTO_ABSTAIN" &&
    (lowAbstain.reasonCode === "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE" ||
      lowAbstain.reasonCode === "AUTO_FINALIZED_ABSTENTION" ||
      lowAbstain.reasonCode === "BUDGET_EXHAUSTED"),
  "LOW_RISK_UNKNOWN_CAN_AUTO_ABSTAIN",
);

const mediumExhausted = routeEvaluation(
  input({
    contract: A2P2_DOMAIN_TEMPLATES.EMAIL_DRAFT(new Date().toISOString()),
    evidence: "INSUFFICIENT",
    outcome: "UNKNOWN",
    recovery: "EXHAUSTED",
    cyclesUsed: 3,
  }),
);
ok(
  mediumExhausted.decision === "HUMAN_ESCALATE" &&
    (mediumExhausted.reasonCode === "HUMAN_ESCALATION_RECOVERY_EXHAUSTED" ||
      mediumExhausted.reasonCode === "BUDGET_EXHAUSTED"),
  "MEDIUM + unresolved + exhausted → HUMAN_ESCALATE",
);

const high = routeEvaluation(
  input({
    risk: "HIGH",
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
    recovery: "AVAILABLE",
  }),
);
ok(
  high.decision === "HUMAN_ESCALATE" &&
    high.reasonCode === "HUMAN_ESCALATION_HIGH_RISK",
  "HIGH_RISK_REQUIRES_HUMAN",
);
ok(
  high.decision === "HUMAN_ESCALATE" && high.decision !== "AUTO_FINALIZE",
  "HIGH_ACCEPTED_SUFFICIENT_STILL_HUMAN",
);

const restricted = routeEvaluation(
  input({
    risk: "RESTRICTED",
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
  }),
);
ok(
  restricted.decision === "HUMAN_ESCALATE",
  "RESTRICTED_NEVER_AUTO_EXECUTES",
);
ok(
  restricted.decision === "HUMAN_ESCALATE" &&
    restricted.decision !== "AUTO_FINALIZE",
  "RESTRICTED_ACCEPTED_SUFFICIENT_STILL_HUMAN",
);

const restrictedPolicy = routeEvaluation(
  input({
    risk: "RESTRICTED",
    evidence: "INSUFFICIENT",
    policySignals: { restrictedAction: true },
  }),
);
ok(
  restrictedPolicy.decision === "POLICY_BLOCKED" &&
    restrictedPolicy.reasonCode === "POLICY_BLOCKED_RESTRICTED_ACTION",
  "RESTRICTED action signal → POLICY_BLOCKED",
);

const privacy = routeEvaluation(
  input({
    evidence: "PRIVACY_BLOCKED",
    privacyClass: "PROHIBITED",
  }),
);
ok(
  privacy.decision === "POLICY_BLOCKED" &&
    privacy.reasonCode === "POLICY_BLOCKED_PRIVACY",
  "PRIVACY_BLOCK_FAIL_CLOSED",
);

const prohibitedClass = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    privacyClass: "PROHIBITED",
    outcome: "TASK_SUCCESS",
    verdictState: "ACCEPTED",
  }),
);
ok(
  prohibitedClass.decision === "POLICY_BLOCKED",
  "PROHIBITED privacy is never Judge-eligible",
);

const conflictRecover = routeEvaluation(
  input({
    evidence: "CONFLICTING",
    recovery: "AVAILABLE",
  }),
);
ok(
  conflictRecover.decision === "AUTO_RECOVER" &&
    conflictRecover.reasonCode === "AUTO_RECOVERY_SOURCE_CONFLICT",
  "EVIDENCE_CONFLICT_ROUTING recovery available",
);

const conflictHuman = routeEvaluation(
  input({
    evidence: "CONFLICTING",
    recovery: "EXHAUSTED",
    cyclesUsed: 3,
  }),
);
ok(
  conflictHuman.decision === "HUMAN_ESCALATE" &&
    conflictHuman.reasonCode === "HUMAN_ESCALATION_EVIDENCE_CONFLICT",
  "EVIDENCE_CONFLICT_ROUTING recovery exhausted",
);

ok(
  lowRecover.allowedNextActions.length > 0 &&
    !lowRecover.allowedNextActions.includes("SEND_EMAIL" as never),
  "AUTO_RECOVER only copies allowlisted actions",
);

ok(
  lowAbstain.decision !== "HUMAN_ESCALATE",
  "UNKNOWN_DOES_NOT_IMPLY_HUMAN",
);

ok(
  lowRecover.decision !== "HUMAN_ESCALATE",
  "UNKNOWN_DEFAULTS_TO_HUMAN = NO",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
