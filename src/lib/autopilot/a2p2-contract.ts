/**
 * Autopilot A2-P2.0 — autonomous evaluation contracts.
 *
 * Pure types, allowlists, budgets, and validators.
 * Does not call an LLM, execute recovery, write to the database,
 * or attach to the A1/A2-P0/A2-P1 projection runtime.
 */

import { AUTOPILOT_A2_P1_ACTIVATION_BLOCKERS } from "./types";

export const A2P2_SURFACE = "A2_P2_0_AUTONOMOUS_EVAL_CONTRACT" as const;
export const A2P2_TASK_CONTRACT_VERSION = "a2p2-task-contract-v1" as const;
export const A2P2_RESOLVER_VERSION = "a2p2-resolver-v1" as const;
export const A2P2_ROUTER_VERSION = "a2p2-router-v1" as const;

export const A2P2_PRINCIPLES = {
  AUTOMATION_FIRST: true,
  HUMAN_BY_EXCEPTION: true,
} as const;

/** Design targets only. P2.0 does not emit live telemetry. */
export const A2P2_KPI_TARGETS = {
  AUTO_EVALUATION_RATE_TARGET: 0.95,
  HUMAN_ESCALATION_RATE_TARGET: 0.05,
  FALSE_SUCCESS_RATE_TARGET: 0.02,
  FALSE_SUCCESS_RATE_PREFERRED: 0.01,
  PRIVACY_LEAKAGE_TARGET: 0,
  UNBOUNDED_RETRY_TARGET: 0,
  HIGH_RISK_AUTO_ACTION_TARGET: 0,
  AUTO_RECOVERY_SUCCESS_RATE_TARGET: 0.7,
} as const;

export const A2P2_ACTIVATION_BLOCKERS = [
  ...AUTOPILOT_A2_P1_ACTIVATION_BLOCKERS,
] as const;

export const EVALUATION_RISK_CLASSES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "RESTRICTED",
] as const;
export type EvaluationRiskClass = (typeof EVALUATION_RISK_CLASSES)[number];

export const AUTOMATION_LEVELS = [
  "L0_HUMAN_CONTROLLED",
  "L1_AUTO_ANALYZE",
  "L2_AUTO_PREPARE",
  "L3_AUTO_EXECUTE_REVERSIBLE",
  "L4_CONTROLLED_EXTERNAL_ACTION",
  "L5_RESTRICTED",
] as const;
export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];

/**
 * A2 Evaluation may only propose READ / SEARCH / VERIFY recovery.
 * L4/L5 side effects are never authorized by Evaluation alone.
 */
export const EVALUATOR_MAX_AUTOMATION_LEVEL = "L2_AUTO_PREPARE" as const;

export const EVALUATION_EVIDENCE_KINDS = [
  "SOURCE_FACT",
  "TOOL_RESULT",
  "ARTIFACT_FACT",
  "BUSINESS_STATE",
  "RUNTIME_FACT",
] as const;
export type EvaluationEvidenceKind = (typeof EVALUATION_EVIDENCE_KINDS)[number];

export const FORBIDDEN_JUDGE_EVIDENCE_KINDS = [
  "RAW_PROMPT",
  "RAW_OUTPUT",
  "RAW_EMAIL",
  "RAW_TENDER",
  "RAW_CONTRACT",
  "RAW_TOOL_PAYLOAD",
] as const;

export const EVALUATION_PRIVACY_CLASSES = [
  "PUBLIC",
  "INTERNAL",
  "SENSITIVE",
  "PROHIBITED",
] as const;
export type EvaluationPrivacyClass = (typeof EVALUATION_PRIVACY_CLASSES)[number];

export const EVALUATION_RECOVERY_ACTION_KINDS = [
  "READ_EXISTING_DOCUMENT",
  "SEARCH_PROJECT_DOCUMENTS",
  "SEARCH_INTERNAL_FACTS",
  "SEARCH_PUBLIC_WEB",
  "SEARCH_AWARD_HISTORY",
  "REFRESH_SOURCE_FACTS",
  "RECHECK_TOOL_RESULT",
] as const;
export type EvaluationRecoveryActionKind =
  (typeof EVALUATION_RECOVERY_ACTION_KINDS)[number];

export const FORBIDDEN_EVALUATION_SIDE_EFFECT_ACTIONS = [
  "SEND_EMAIL",
  "SUBMIT_BID",
  "APPROVE_QUOTE",
  "CHANGE_PRICE",
  "SIGN_CONTRACT",
  "MAKE_PAYMENT",
  "DELETE_RECORD",
  "CHANGE_RBAC",
  "CHANGE_PRODUCTION_CONFIG",
] as const;

export const EVALUATION_ESCALATION_REASONS = [
  "HIGH_BUSINESS_RISK",
  "RESTRICTED_ACTION",
  "LEGAL_COMMITMENT",
  "FINANCIAL_COMMITMENT",
  "EXTERNAL_SIDE_EFFECT",
  "IRREVERSIBLE_ACTION",
  "EVIDENCE_CONFLICT",
  "GOAL_AMBIGUOUS",
  "RECOVERY_EXHAUSTED",
  "BUDGET_EXCEEDED",
  "PRIVACY_POLICY_BLOCKED",
  "POLICY_BLOCKED",
] as const;
export type EvaluationEscalationReason =
  (typeof EVALUATION_ESCALATION_REASONS)[number];

export const EVALUATION_ROUTE_DECISIONS = [
  "AUTO_FINALIZE",
  "AUTO_RECOVER",
  "AUTO_ABSTAIN",
  "HUMAN_ESCALATE",
  "POLICY_BLOCKED",
] as const;
export type EvaluationRouteDecisionKind =
  (typeof EVALUATION_ROUTE_DECISIONS)[number];

export const EVALUATION_ROUTE_REASON_CODES = [
  "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
  "AUTO_RECOVERY_MISSING_EVIDENCE",
  "AUTO_RECOVERY_SOURCE_CONFLICT",
  "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE",
  "HUMAN_ESCALATION_HIGH_RISK",
  "HUMAN_ESCALATION_RECOVERY_EXHAUSTED",
  "HUMAN_ESCALATION_EVIDENCE_CONFLICT",
  "POLICY_BLOCKED_PRIVACY",
  "POLICY_BLOCKED_RESTRICTED_ACTION",
  "BUDGET_EXHAUSTED",
] as const;
export type EvaluationRouteReasonCode =
  (typeof EVALUATION_ROUTE_REASON_CODES)[number];

export const EVALUATION_OUTCOMES = [
  "TASK_SUCCESS",
  "PARTIAL_SUCCESS",
  "FAILURE",
  "UNKNOWN",
] as const;
export type EvaluationOutcomeHint = (typeof EVALUATION_OUTCOMES)[number];

export const EVALUATION_EVIDENCE_STATES = [
  "SUFFICIENT",
  "INSUFFICIENT",
  "CONFLICTING",
  "PRIVACY_BLOCKED",
] as const;
export type EvaluationEvidenceStatus =
  (typeof EVALUATION_EVIDENCE_STATES)[number];

export const EVALUATION_RECOVERY_STATES = [
  "NOT_ATTEMPTED",
  "AVAILABLE",
  "IN_PROGRESS",
  "EXHAUSTED",
  "NOT_ALLOWED",
] as const;
export type EvaluationRecoveryStatus =
  (typeof EVALUATION_RECOVERY_STATES)[number];

export const TASK_CONTRACT_SOURCES = [
  "EXPLICIT_CONTRACT",
  "WORKFLOW_TEMPLATE",
  "DOMAIN_TEMPLATE",
  "GENERIC_FALLBACK",
] as const;
export type TaskContractSource = (typeof TASK_CONTRACT_SOURCES)[number];

export const A2P2_DOMAIN_IDS = [
  "TENDER_ANALYSIS",
  "RESEARCH",
  "EMAIL_DRAFT",
  "GENERIC",
] as const;
export type A2P2DomainId = (typeof A2P2_DOMAIN_IDS)[number];

export const FORBIDDEN_CONTRACT_FIELD_NAMES = [
  "rawContent",
  "raw_content",
  "prompt",
  "userPrompt",
  "emailBody",
  "tenderBody",
  "toolPayload",
  "modelOutput",
  "completion",
] as const;

export const A2P2_DEFAULT_EVALUATION_BUDGET = {
  maxJudgeCalls: 2,
  maxRecoveryCycles: 3,
  maxExternalSearches: 5,
  maxCostUsd: 0.25,
} as const;

export const A2P2_DEFAULT_MAX_RECOVERY_CYCLES = 3;

export const DEFAULT_READ_SEARCH_RECOVERY_ACTIONS: readonly EvaluationRecoveryActionKind[] =
  [
    "READ_EXISTING_DOCUMENT",
    "SEARCH_PROJECT_DOCUMENTS",
    "SEARCH_INTERNAL_FACTS",
    "SEARCH_PUBLIC_WEB",
    "SEARCH_AWARD_HISTORY",
    "REFRESH_SOURCE_FACTS",
    "RECHECK_TOOL_RESULT",
  ];

export type EvaluationRequirement = {
  id: string;
  label: string;
  normalizedDescription: string;
  required: boolean;
  evidenceKinds: readonly EvaluationEvidenceKind[];
  minimumEvidenceRefs: number;
  allowUnknown: boolean;
  criticality: "LOW" | "MEDIUM" | "HIGH";
};

export type EvaluationEvidenceRef = {
  evidenceRef: string;
  evidenceKind: EvaluationEvidenceKind;
  sourceType: string;
  sourceId: string;
  contentHash: string;
  extractorVersion: string;
  createdAt: string;
  privacyClass: EvaluationPrivacyClass;
  provenance: string;
};

export type EvaluationBudget = {
  maxJudgeCalls: number;
  maxRecoveryCycles: number;
  maxExternalSearches: number;
  maxCostUsd: number;
};

export type EvaluationRecoveryPolicy = {
  enabled: boolean;
  allowedActions: readonly EvaluationRecoveryActionKind[];
  maxRecoveryCycles: number;
  allowExternalResearch: boolean;
};

export type EvaluationEscalationPolicy = {
  requireHumanForRisk: readonly EvaluationRiskClass[];
  reasons: readonly EvaluationEscalationReason[];
};

export type TaskContractProvenance = {
  contractVersion: typeof A2P2_TASK_CONTRACT_VERSION;
  source: TaskContractSource;
  sourceId?: string;
  resolverVersion: typeof A2P2_RESOLVER_VERSION;
  createdAt: string;
};

export type AutonomousEvaluationTaskContract = {
  version: typeof A2P2_TASK_CONTRACT_VERSION;
  taskType: A2P2DomainId;
  goalSummary: string;
  requirements: readonly EvaluationRequirement[];
  riskClass: EvaluationRiskClass;
  automationLevel: AutomationLevel;
  recoveryPolicy: EvaluationRecoveryPolicy;
  escalationPolicy: EvaluationEscalationPolicy;
  evaluationBudget: EvaluationBudget;
  provenance: TaskContractProvenance;
};

const GOAL_SUMMARY_MAX = 240;

export function isEvaluationRecoveryActionKind(
  value: string,
): value is EvaluationRecoveryActionKind {
  return (EVALUATION_RECOVERY_ACTION_KINDS as readonly string[]).includes(
    value,
  );
}

export function isForbiddenSideEffectAction(value: string): boolean {
  return (FORBIDDEN_EVALUATION_SIDE_EFFECT_ACTIONS as readonly string[]).includes(
    value,
  );
}

export function isJudgeEligiblePrivacyClass(
  privacyClass: EvaluationPrivacyClass,
): boolean {
  return privacyClass !== "PROHIBITED";
}

export function isJudgeEligibleEvidenceKind(
  kind: string,
): kind is EvaluationEvidenceKind {
  return (EVALUATION_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

export function sanitizeGoalSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, GOAL_SUMMARY_MAX);
}

export function hasForbiddenContractFields(
  value: Record<string, unknown>,
): boolean {
  return FORBIDDEN_CONTRACT_FIELD_NAMES.some((key) => key in value);
}

export function assertFiniteBudget(budget: EvaluationBudget): EvaluationBudget {
  const fields: Array<keyof EvaluationBudget> = [
    "maxJudgeCalls",
    "maxRecoveryCycles",
    "maxExternalSearches",
    "maxCostUsd",
  ];
  for (const field of fields) {
    const n = budget[field];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      throw new Error(`A2-P2.0 budget ${field} must be a finite number >= 0`);
    }
  }
  return budget;
}

export function defaultEvaluationBudget(): EvaluationBudget {
  return assertFiniteBudget({ ...A2P2_DEFAULT_EVALUATION_BUDGET });
}

export function defaultRecoveryPolicy(input?: {
  enabled?: boolean;
  allowedActions?: readonly EvaluationRecoveryActionKind[];
  maxRecoveryCycles?: number;
  allowExternalResearch?: boolean;
}): EvaluationRecoveryPolicy {
  const allowedActions = (input?.allowedActions ??
    DEFAULT_READ_SEARCH_RECOVERY_ACTIONS).filter(
    (action) =>
      isEvaluationRecoveryActionKind(action) &&
      !isForbiddenSideEffectAction(action),
  );
  const maxRecoveryCycles = input?.maxRecoveryCycles ?? A2P2_DEFAULT_MAX_RECOVERY_CYCLES;
  if (!Number.isFinite(maxRecoveryCycles) || maxRecoveryCycles < 0) {
    throw new Error("maxRecoveryCycles must be finite and >= 0");
  }
  return {
    enabled: input?.enabled ?? true,
    allowedActions,
    maxRecoveryCycles,
    allowExternalResearch: input?.allowExternalResearch ?? true,
  };
}

export function defaultEscalationPolicy(): EvaluationEscalationPolicy {
  return {
    requireHumanForRisk: ["HIGH", "RESTRICTED"],
    reasons: EVALUATION_ESCALATION_REASONS,
  };
}

export function rejectUnknownRecoveryAction(
  action: string,
): EvaluationRecoveryActionKind {
  if (isForbiddenSideEffectAction(action)) {
    throw new Error(`FORBIDDEN_SIDE_EFFECT_RECOVERY: ${action}`);
  }
  if (!isEvaluationRecoveryActionKind(action)) {
    throw new Error(`UNKNOWN_RECOVERY_ACTION: ${action}`);
  }
  return action;
}

export function assertRecoveryAllowlist(
  actions: readonly string[],
): readonly EvaluationRecoveryActionKind[] {
  return actions.map(rejectUnknownRecoveryAction);
}
