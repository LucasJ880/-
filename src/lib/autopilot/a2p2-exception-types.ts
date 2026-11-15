/**
 * Autopilot A2-P2.4 — exception envelope contracts.
 *
 * Pure types and frozen constants. No routing logic, no Judge, no recovery,
 * no approval runtime, no persistence.
 */

import {
  A2P2_ROUTER_VERSION,
  type A2P2DomainId,
  type AutomationLevel,
  type EvaluationEvidenceKind,
  type EvaluationEvidenceStatus,
  type EvaluationOutcomeHint,
  type EvaluationRecoveryActionKind,
  type EvaluationRecoveryStatus,
  type EvaluationRiskClass,
  type EvaluationRouteReasonCode,
  type EvaluationVerdictState,
} from "./a2p2-contract";

export const A2P2_EXCEPTION_SURFACE = "A2_P2_4_EXCEPTION_ENVELOPE" as const;
export const A2P2_EXCEPTION_ENVELOPE_VERSION = "a2p2-exception-envelope-v1" as const;
export const A2P2_EXCEPTION_IDENTITY_VERSION = "a2p2-exception-identity-v1" as const;

export const P2_4_ROUTE_AUTHORITY = "NO" as const;
export const P2_4_ROUTE_LOGIC = 0 as const;
export const P2_4_CANONICAL_ROUTE_VERIFICATION =
  "P2_0_ROUTE_EVALUATION_ONLY" as const;

export const P2_4_HUMAN_ESCALATION_REASON_CODES = [
  "HUMAN_ESCALATION_L0_HUMAN_CONTROLLED",
  "HUMAN_ESCALATION_LEGAL_COMMITMENT",
  "HUMAN_ESCALATION_FINANCIAL_COMMITMENT",
  "HUMAN_ESCALATION_EXTERNAL_SIDE_EFFECT",
  "HUMAN_ESCALATION_IRREVERSIBLE_ACTION",
  "HUMAN_ESCALATION_HIGH_RISK",
  "HUMAN_ESCALATION_CONTRACT_POLICY",
  "HUMAN_ESCALATION_GOAL_AMBIGUOUS",
  "HUMAN_ESCALATION_EVIDENCE_CONFLICT",
  "HUMAN_ESCALATION_RECOVERY_EXHAUSTED",
  "BUDGET_EXHAUSTED",
] as const;
export type P24HumanEscalationReasonCode =
  (typeof P2_4_HUMAN_ESCALATION_REASON_CODES)[number];

export const MAX_REQUIRED_REQUIREMENT_IDS = 16 as const;
export const MAX_PROBLEM_REQUIREMENT_IDS = 16 as const;
export const MAX_SAFE_EVIDENCE_REFS = 32 as const;
export const MAX_RECOVERY_ATTEMPT_KEYS = 16 as const;
export const MAX_SAFE_SUMMARY_CHARS = 160 as const;

export const EXCEPTION_ENVELOPE_KEYS = [
  "version",
  "exceptionId",
  "taskType",
  "semanticContractHash",
  "packetHash",
  "judgeProposalHash",
  "routeDecision",
  "routeReasonCode",
  "routerVersion",
  "riskClass",
  "automationLevel",
  "requiredRequirementCount",
  "requiredRequirementIds",
  "requiredRequirementsTruncated",
  "problemRequirementCount",
  "problemRequirementIds",
  "problemRequirementsTruncated",
  "evidenceStatus",
  "evaluationOutcome",
  "verdictState",
  "recoveryStatus",
  "recoveryCyclesUsed",
  "recoveryAttemptKeys",
  "safeEvidenceRefCount",
  "safeEvidenceRefs",
  "safeEvidenceRefsTruncated",
  "safeSummary",
  "observedAt",
] as const;

export type SafeExceptionEvidenceRef = {
  evidenceRef: string;
  requirementId: string;
  evidenceKind: EvaluationEvidenceKind;
  canonicalFactHash: string;
};

export type A2P2ExceptionEnvelopeV1 = {
  version: typeof A2P2_EXCEPTION_ENVELOPE_VERSION;
  exceptionId: string;
  taskType: A2P2DomainId;
  semanticContractHash: string;
  packetHash: string;
  judgeProposalHash: string | null;
  routeDecision: "HUMAN_ESCALATE";
  routeReasonCode: P24HumanEscalationReasonCode;
  routerVersion: typeof A2P2_ROUTER_VERSION;
  riskClass: EvaluationRiskClass;
  automationLevel: AutomationLevel;
  requiredRequirementCount: number;
  requiredRequirementIds: readonly string[];
  requiredRequirementsTruncated: boolean;
  problemRequirementCount: number;
  problemRequirementIds: readonly string[];
  problemRequirementsTruncated: boolean;
  evidenceStatus: EvaluationEvidenceStatus;
  evaluationOutcome: EvaluationOutcomeHint;
  verdictState: EvaluationVerdictState;
  recoveryStatus: EvaluationRecoveryStatus;
  recoveryCyclesUsed: number;
  recoveryAttemptKeys: readonly string[];
  safeEvidenceRefCount: number;
  safeEvidenceRefs: readonly SafeExceptionEvidenceRef[];
  safeEvidenceRefsTruncated: boolean;
  safeSummary: string;
  observedAt: string | null;
};

export const BUILD_EXCEPTION_ENVELOPE_REASONS = [
  "NOT_HUMAN_ESCALATE",
  "ENVELOPE_INPUT_INVALID",
  "EXPECTED_ROUTE_MISMATCH",
  "MIXED_AUTHORITY_SNAPSHOTS",
] as const;
export type BuildExceptionEnvelopeReason =
  (typeof BUILD_EXCEPTION_ENVELOPE_REASONS)[number];

export type BuildExceptionEnvelopeResult =
  | { ok: true; reason: null; envelope: A2P2ExceptionEnvelopeV1 }
  | {
      ok: false;
      reason: BuildExceptionEnvelopeReason;
      envelope: null;
    };

export type ExceptionIdentityInput = {
  version: typeof A2P2_EXCEPTION_IDENTITY_VERSION;
  routerVersion: string;
  semanticContractHash: string;
  packetHash: string;
  routeReasonCode: EvaluationRouteReasonCode;
  evaluationOutcome: EvaluationOutcomeHint;
  verdictState: EvaluationVerdictState;
  judgeProposalHash: string | null;
  recoveryStatus: EvaluationRecoveryStatus;
};

export type ExpectedRouteShape = {
  routerVersion: string;
  decision: string;
  reasonCode: string;
  allowedNextActions: readonly EvaluationRecoveryActionKind[];
};
