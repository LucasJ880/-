/**
 * Autopilot A2-P2.0 routing — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-routing.test.ts
 */

import {
  A2P2_DEFAULT_EVALUATION_BUDGET,
  A2P2_PRINCIPLES,
  type AutonomousEvaluationTaskContract,
  type EvaluationRiskClass,
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

function withRisk(
  contract: AutonomousEvaluationTaskContract,
  riskClass: EvaluationRiskClass,
): AutonomousEvaluationTaskContract {
  return { ...contract, riskClass };
}

function input(partial: {
  contract?: AutonomousEvaluationTaskContract;
  risk?: EvaluationRiskClass;
  outcome?: EvaluationRouteInput["evaluationState"]["outcome"];
  final?: boolean;
  evidence: EvaluationRouteInput["evidenceState"]["status"];
  privacyClass?: EvaluationRouteInput["evidenceState"]["privacyClass"];
  recovery?: EvaluationRouteInput["recoveryState"]["status"];
  cyclesUsed?: number;
  budgetUsed?: Partial<EvaluationRouteInput["budgetState"]>;
  policySignals?: EvaluationRouteInput["policySignals"];
}): EvaluationRouteInput {
  const now = new Date().toISOString();
  let contract = partial.contract ?? A2P2_DOMAIN_TEMPLATES.RESEARCH(now);
  if (partial.risk) contract = withRisk(contract, partial.risk);
  return {
    taskContract: contract,
    evaluationState: {
      outcome: partial.outcome ?? "UNKNOWN",
      final: partial.final,
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

const lowSuccess = routeEvaluation(
  input({
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    final: true,
    recovery: "NOT_ATTEMPTED",
  }),
);
ok(
  lowSuccess.decision === "AUTO_FINALIZE" &&
    lowSuccess.reasonCode === "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
  "LOW + sufficient + final → AUTO_FINALIZE",
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
    lowAbstain.reasonCode === "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE",
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
    mediumExhausted.reasonCode === "HUMAN_ESCALATION_RECOVERY_EXHAUSTED",
  "MEDIUM + unresolved + exhausted → HUMAN_ESCALATE",
);

const high = routeEvaluation(
  input({
    risk: "HIGH",
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    final: true,
    recovery: "AVAILABLE",
  }),
);
ok(
  high.decision === "HUMAN_ESCALATE" &&
    high.reasonCode === "HUMAN_ESCALATION_HIGH_RISK",
  "HIGH_RISK_REQUIRES_HUMAN",
);

const restricted = routeEvaluation(
  input({
    risk: "RESTRICTED",
    evidence: "SUFFICIENT",
    outcome: "TASK_SUCCESS",
    final: true,
  }),
);
ok(
  restricted.decision === "HUMAN_ESCALATE",
  "RESTRICTED_NEVER_AUTO_EXECUTES",
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
    final: true,
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

const budgetLow = routeEvaluation(
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
  budgetLow.decision === "AUTO_ABSTAIN" && budgetLow.reasonCode === "BUDGET_EXHAUSTED",
  "BUDGET exhausted + low-risk → AUTO_ABSTAIN",
);

const budgetMedium = routeEvaluation(
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
  budgetMedium.decision === "HUMAN_ESCALATE" &&
    budgetMedium.reasonCode === "BUDGET_EXHAUSTED",
  "BUDGET exhausted + medium unresolved → HUMAN_ESCALATE",
);

const maxCycles = routeEvaluation(
  input({
    evidence: "INSUFFICIENT",
    recovery: "AVAILABLE",
    cyclesUsed: 3,
    budgetUsed: { recoveryCyclesUsed: 3 },
  }),
);
ok(
  maxCycles.decision !== "AUTO_RECOVER",
  "recovery cycle at max → no additional AUTO_RECOVER",
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
