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
  "AUTO_WAIT",
  "AUTO_ABSTAIN",
  "HUMAN_ESCALATE",
  "POLICY_BLOCKED",
] as const;
export type EvaluationRouteDecisionKind =
  (typeof EVALUATION_ROUTE_DECISIONS)[number];

export const EVALUATION_ROUTE_REASON_CODES = [
  "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
  "AUTO_FINALIZED_ABSTENTION",
  "AUTO_RECOVERY_MISSING_EVIDENCE",
  "AUTO_RECOVERY_SOURCE_CONFLICT",
  "AUTO_WAIT_RECOVERY_IN_PROGRESS",
  "AUTO_ABSTAINED_INSUFFICIENT_EVIDENCE",
  "HUMAN_ESCALATION_HIGH_RISK",
  "HUMAN_ESCALATION_RECOVERY_EXHAUSTED",
  "HUMAN_ESCALATION_EVIDENCE_CONFLICT",
  "HUMAN_ESCALATION_LEGAL_COMMITMENT",
  "HUMAN_ESCALATION_FINANCIAL_COMMITMENT",
  "HUMAN_ESCALATION_EXTERNAL_SIDE_EFFECT",
  "HUMAN_ESCALATION_IRREVERSIBLE_ACTION",
  "HUMAN_ESCALATION_GOAL_AMBIGUOUS",
  "HUMAN_ESCALATION_CONTRACT_POLICY",
  "HUMAN_ESCALATION_L0_HUMAN_CONTROLLED",
  "POLICY_BLOCKED_PRIVACY",
  "POLICY_BLOCKED_RESTRICTED_ACTION",
  "POLICY_BLOCKED_L5_RESTRICTED",
  "POLICY_BLOCKED_UNVALIDATED_CONTRACT",
  "BUDGET_EXHAUSTED",
] as const;
export type EvaluationRouteReasonCode =
  (typeof EVALUATION_ROUTE_REASON_CODES)[number];

export const EVALUATION_VERDICT_STATES = [
  "NOT_EVALUATED",
  "PROPOSED",
  "ACCEPTED",
  "ABSTAINED",
] as const;
export type EvaluationVerdictState = (typeof EVALUATION_VERDICT_STATES)[number];

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
  "INVALID_EXPLICIT_CONTRACT",
  "INVALID_WORKFLOW_CONTRACT",
] as const;
export type TaskContractSource = (typeof TASK_CONTRACT_SOURCES)[number];

export const REQUIREMENT_CRITICALITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type RequirementCriticality = (typeof REQUIREMENT_CRITICALITIES)[number];

export const EXTERNAL_RESEARCH_ACTIONS = [
  "SEARCH_PUBLIC_WEB",
  "SEARCH_AWARD_HISTORY",
] as const;

export const EVALUATION_RECOVERY_AUTHORITY_MAX = "READ_SEARCH_VERIFY_ONLY" as const;

export const A2P2_DOMAIN_IDS = [
  "TENDER_ANALYSIS",
  "RESEARCH",
  "EMAIL_DRAFT",
  "GENERIC",
] as const;
export type A2P2DomainId = (typeof A2P2_DOMAIN_IDS)[number];

export const TASK_CONTRACT_TOP_LEVEL_KEYS = [
  "version",
  "taskType",
  "goalSummary",
  "requirements",
  "riskClass",
  "automationLevel",
  "recoveryPolicy",
  "escalationPolicy",
  "evaluationBudget",
  "provenance",
] as const;

export const REQUIREMENT_KEYS = [
  "id",
  "label",
  "normalizedDescription",
  "required",
  "evidenceKinds",
  "minimumEvidenceRefs",
  "allowUnknown",
  "criticality",
] as const;

export const RECOVERY_POLICY_KEYS = [
  "enabled",
  "allowedActions",
  "maxRecoveryCycles",
  "allowExternalResearch",
] as const;

export const ESCALATION_POLICY_KEYS = ["requireHumanForRisk", "reasons"] as const;

export const BUDGET_KEYS = [
  "maxJudgeCalls",
  "maxRecoveryCycles",
  "maxExternalSearches",
  "maxCostUsd",
] as const;

export const PROVENANCE_KEYS = [
  "contractVersion",
  "source",
  "sourceId",
  "resolverVersion",
  "createdAt",
] as const;

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
  criticality: RequirementCriticality;
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

const METADATA_MAX = 240;
const ID_MAX = 80;

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

export function isExternalResearchAction(
  value: string,
): value is (typeof EXTERNAL_RESEARCH_ACTIONS)[number] {
  return (EXTERNAL_RESEARCH_ACTIONS as readonly string[]).includes(value);
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
  return value.replace(/\s+/g, " ").trim().slice(0, METADATA_MAX);
}

export function findForbiddenContractField(
  value: unknown,
  path = "$",
): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const nested = findForbiddenContractField(value[i], `${path}[${i}]`);
      if (nested) return nested;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_CONTRACT_FIELD_NAMES as readonly string[]).includes(key)) {
      return `${path}.${key}`;
    }
    const nested = findForbiddenContractField(child, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

export function hasForbiddenContractFields(value: Record<string, unknown>): boolean {
  return findForbiddenContractField(value) != null;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

export function assertFiniteBudget(budget: EvaluationBudget): EvaluationBudget {
  if (!isNonNegInt(budget.maxJudgeCalls)) {
    throw new Error("maxJudgeCalls must be a finite integer >= 0");
  }
  if (!isNonNegInt(budget.maxRecoveryCycles)) {
    throw new Error("maxRecoveryCycles must be a finite integer >= 0");
  }
  if (!isNonNegInt(budget.maxExternalSearches)) {
    throw new Error("maxExternalSearches must be a finite integer >= 0");
  }
  if (!isNonNegFinite(budget.maxCostUsd)) {
    throw new Error("maxCostUsd must be a finite number >= 0");
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
  const allowExternalResearch = input?.allowExternalResearch ?? true;
  const allowedActions = (input?.allowedActions ?? DEFAULT_READ_SEARCH_RECOVERY_ACTIONS)
    .filter(
      (action) =>
        isEvaluationRecoveryActionKind(action) &&
        !isForbiddenSideEffectAction(action) &&
        (allowExternalResearch || !isExternalResearchAction(action)),
    );
  const maxRecoveryCycles = input?.maxRecoveryCycles ?? A2P2_DEFAULT_MAX_RECOVERY_CYCLES;
  if (!isNonNegInt(maxRecoveryCycles)) {
    throw new Error("maxRecoveryCycles must be a finite integer >= 0");
  }
  return {
    enabled: input?.enabled ?? true,
    allowedActions,
    maxRecoveryCycles,
    allowExternalResearch,
  };
}

export function defaultEscalationPolicy(
  requireHumanForRisk: readonly EvaluationRiskClass[] = ["HIGH", "RESTRICTED"],
): EvaluationEscalationPolicy {
  return {
    requireHumanForRisk,
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

export type AutomationLevelPolicy = {
  mayAutoFinalize: boolean;
  mayAutoRecover: boolean;
  evaluationMayInspect: boolean;
  evaluationMayAuthorizeExternalAction: boolean;
  failClosedDecision: EvaluationRouteDecisionKind | null;
  failClosedReason: EvaluationRouteReasonCode | null;
};

export function automationLevelPolicy(
  level: AutomationLevel,
): AutomationLevelPolicy {
  if (level === "L0_HUMAN_CONTROLLED") {
    return {
      mayAutoFinalize: false,
      mayAutoRecover: false,
      evaluationMayInspect: true,
      evaluationMayAuthorizeExternalAction: false,
      failClosedDecision: "HUMAN_ESCALATE",
      failClosedReason: "HUMAN_ESCALATION_L0_HUMAN_CONTROLLED",
    };
  }
  if (level === "L5_RESTRICTED") {
    return {
      mayAutoFinalize: false,
      mayAutoRecover: false,
      evaluationMayInspect: true,
      evaluationMayAuthorizeExternalAction: false,
      failClosedDecision: "POLICY_BLOCKED",
      failClosedReason: "POLICY_BLOCKED_L5_RESTRICTED",
    };
  }
  return {
    mayAutoFinalize: true,
    mayAutoRecover: true,
    evaluationMayInspect: true,
    evaluationMayAuthorizeExternalAction: false,
    failClosedDecision: null,
    failClosedReason: null,
  };
}

export const VALIDATED_TASK_CONTRACT_BRAND: unique symbol = Symbol(
  "ValidatedTaskContract",
);

export type ValidatedTaskContract = AutonomousEvaluationTaskContract & {
  readonly [VALIDATED_TASK_CONTRACT_BRAND]: true;
};

export type ParseTaskContractResult =
  | { ok: true; contract: ValidatedTaskContract }
  | { ok: false; reason: string };

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = sanitizeGoalSummary(value);
  if (!trimmed || trimmed.length > max) return null;
  return trimmed.slice(0, max);
}

function parseRequirement(value: unknown): EvaluationRequirement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (unknownKeys(row, REQUIREMENT_KEYS).length > 0) return null;
  const id = boundedString(row.id, ID_MAX);
  const label = boundedString(row.label, METADATA_MAX);
  const normalizedDescription = boundedString(row.normalizedDescription, METADATA_MAX);
  if (!id || !label || !normalizedDescription) return null;
  if (typeof row.required !== "boolean" || typeof row.allowUnknown !== "boolean") {
    return null;
  }
  if (!Array.isArray(row.evidenceKinds) || row.evidenceKinds.length === 0) return null;
  if (
    !row.evidenceKinds.every(
      (kind) => typeof kind === "string" && isJudgeEligibleEvidenceKind(kind),
    )
  ) {
    return null;
  }
  if (!isNonNegInt(row.minimumEvidenceRefs)) return null;
  if (
    typeof row.criticality !== "string" ||
    !(REQUIREMENT_CRITICALITIES as readonly string[]).includes(row.criticality)
  ) {
    return null;
  }
  return {
    id,
    label,
    normalizedDescription,
    required: row.required,
    evidenceKinds: row.evidenceKinds as EvaluationEvidenceKind[],
    minimumEvidenceRefs: row.minimumEvidenceRefs,
    allowUnknown: row.allowUnknown,
    criticality: row.criticality as RequirementCriticality,
  };
}

function brandContract(
  contract: AutonomousEvaluationTaskContract,
): ValidatedTaskContract {
  return Object.freeze({
    ...contract,
    requirements: Object.freeze([...contract.requirements]),
    recoveryPolicy: Object.freeze({
      ...contract.recoveryPolicy,
      allowedActions: Object.freeze([...contract.recoveryPolicy.allowedActions]),
    }),
    escalationPolicy: Object.freeze({
      ...contract.escalationPolicy,
      requireHumanForRisk: Object.freeze([
        ...contract.escalationPolicy.requireHumanForRisk,
      ]),
      reasons: Object.freeze([...contract.escalationPolicy.reasons]),
    }),
    evaluationBudget: Object.freeze({ ...contract.evaluationBudget }),
    provenance: Object.freeze({ ...contract.provenance }),
    [VALIDATED_TASK_CONTRACT_BRAND]: true as const,
  });
}

export function parseTaskContract(
  value: unknown,
  meta?: { source?: TaskContractSource; createdAt?: string },
): ParseTaskContractResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "CONTRACT_NOT_OBJECT" };
  }
  const raw = value as Record<string, unknown>;
  const forbidden = findForbiddenContractField(raw);
  if (forbidden) {
    return { ok: false, reason: `FORBIDDEN_FIELD:${forbidden}` };
  }
  const extra = unknownKeys(raw, TASK_CONTRACT_TOP_LEVEL_KEYS);
  if (extra.length > 0) {
    return { ok: false, reason: `UNKNOWN_TOP_LEVEL_FIELD:${extra[0]}` };
  }
  if (raw.version !== A2P2_TASK_CONTRACT_VERSION) {
    return { ok: false, reason: "INVALID_VERSION" };
  }
  if (
    typeof raw.taskType !== "string" ||
    !(A2P2_DOMAIN_IDS as readonly string[]).includes(raw.taskType)
  ) {
    return { ok: false, reason: "INVALID_TASK_TYPE" };
  }
  if (
    typeof raw.riskClass !== "string" ||
    !(EVALUATION_RISK_CLASSES as readonly string[]).includes(raw.riskClass)
  ) {
    return { ok: false, reason: "INVALID_RISK_CLASS" };
  }
  if (
    typeof raw.automationLevel !== "string" ||
    !(AUTOMATION_LEVELS as readonly string[]).includes(raw.automationLevel)
  ) {
    return { ok: false, reason: "INVALID_AUTOMATION_LEVEL" };
  }
  const goalSummary = boundedString(raw.goalSummary, METADATA_MAX);
  if (!goalSummary) return { ok: false, reason: "INVALID_GOAL_SUMMARY" };
  if (!Array.isArray(raw.requirements)) {
    return { ok: false, reason: "INVALID_REQUIREMENTS" };
  }
  const requirements: EvaluationRequirement[] = [];
  for (const item of raw.requirements) {
    const parsed = parseRequirement(item);
    if (!parsed) return { ok: false, reason: "INVALID_REQUIREMENT" };
    requirements.push(parsed);
  }

  if (!raw.recoveryPolicy || typeof raw.recoveryPolicy !== "object") {
    return { ok: false, reason: "INVALID_RECOVERY_POLICY" };
  }
  const recoveryRaw = raw.recoveryPolicy as Record<string, unknown>;
  if (unknownKeys(recoveryRaw, RECOVERY_POLICY_KEYS).length > 0) {
    return { ok: false, reason: "UNKNOWN_RECOVERY_POLICY_FIELD" };
  }
  if (
    typeof recoveryRaw.enabled !== "boolean" ||
    typeof recoveryRaw.allowExternalResearch !== "boolean" ||
    !Array.isArray(recoveryRaw.allowedActions)
  ) {
    return { ok: false, reason: "INVALID_RECOVERY_POLICY" };
  }
  if (!isNonNegInt(recoveryRaw.maxRecoveryCycles)) {
    return { ok: false, reason: "INVALID_RECOVERY_CYCLES" };
  }
  let allowedActions: EvaluationRecoveryActionKind[];
  try {
    allowedActions = [
      ...assertRecoveryAllowlist(recoveryRaw.allowedActions as string[]),
    ];
  } catch {
    return { ok: false, reason: "INVALID_RECOVERY_ACTION" };
  }
  if (
    recoveryRaw.allowExternalResearch === false &&
    allowedActions.some((action) => isExternalResearchAction(action))
  ) {
    return { ok: false, reason: "EXTERNAL_RESEARCH_POLICY_INCONSISTENT" };
  }

  if (!raw.escalationPolicy || typeof raw.escalationPolicy !== "object") {
    return { ok: false, reason: "INVALID_ESCALATION_POLICY" };
  }
  const escalationRaw = raw.escalationPolicy as Record<string, unknown>;
  if (unknownKeys(escalationRaw, ESCALATION_POLICY_KEYS).length > 0) {
    return { ok: false, reason: "UNKNOWN_ESCALATION_POLICY_FIELD" };
  }
  if (
    !Array.isArray(escalationRaw.requireHumanForRisk) ||
    !escalationRaw.requireHumanForRisk.every(
      (item) =>
        typeof item === "string" &&
        (EVALUATION_RISK_CLASSES as readonly string[]).includes(item),
    )
  ) {
    return { ok: false, reason: "INVALID_REQUIRE_HUMAN_FOR_RISK" };
  }
  if (
    !Array.isArray(escalationRaw.reasons) ||
    !escalationRaw.reasons.every(
      (item) =>
        typeof item === "string" &&
        (EVALUATION_ESCALATION_REASONS as readonly string[]).includes(item),
    )
  ) {
    return { ok: false, reason: "INVALID_ESCALATION_REASONS" };
  }

  if (!raw.evaluationBudget || typeof raw.evaluationBudget !== "object") {
    return { ok: false, reason: "INVALID_BUDGET" };
  }
  const budgetRaw = raw.evaluationBudget as Record<string, unknown>;
  if (unknownKeys(budgetRaw, BUDGET_KEYS).length > 0) {
    return { ok: false, reason: "UNKNOWN_BUDGET_FIELD" };
  }
  let evaluationBudget: EvaluationBudget;
  try {
    evaluationBudget = assertFiniteBudget({
      maxJudgeCalls: budgetRaw.maxJudgeCalls as number,
      maxRecoveryCycles: budgetRaw.maxRecoveryCycles as number,
      maxExternalSearches: budgetRaw.maxExternalSearches as number,
      maxCostUsd: budgetRaw.maxCostUsd as number,
    });
  } catch {
    return { ok: false, reason: "INVALID_BUDGET" };
  }

  if (!raw.provenance || typeof raw.provenance !== "object") {
    return { ok: false, reason: "INVALID_PROVENANCE" };
  }
  const provenanceRaw = raw.provenance as Record<string, unknown>;
  if (unknownKeys(provenanceRaw, PROVENANCE_KEYS).length > 0) {
    return { ok: false, reason: "UNKNOWN_PROVENANCE_FIELD" };
  }
  if (
    provenanceRaw.contractVersion != null &&
    provenanceRaw.contractVersion !== A2P2_TASK_CONTRACT_VERSION
  ) {
    return { ok: false, reason: "INVALID_PROVENANCE_VERSION" };
  }
  const source =
    meta?.source ??
    (typeof provenanceRaw.source === "string" &&
    (TASK_CONTRACT_SOURCES as readonly string[]).includes(provenanceRaw.source)
      ? (provenanceRaw.source as TaskContractSource)
      : null);
  if (!source) return { ok: false, reason: "INVALID_PROVENANCE_SOURCE" };
  const createdAt =
    meta?.createdAt ??
    (typeof provenanceRaw.createdAt === "string" ? provenanceRaw.createdAt : "");
  if (!createdAt) return { ok: false, reason: "INVALID_PROVENANCE_CREATED_AT" };
  const sourceId =
    provenanceRaw.sourceId === undefined
      ? undefined
      : boundedString(provenanceRaw.sourceId, ID_MAX) ?? undefined;
  if (provenanceRaw.sourceId !== undefined && !sourceId) {
    return { ok: false, reason: "INVALID_PROVENANCE_SOURCE_ID" };
  }

  const contract: AutonomousEvaluationTaskContract = {
    version: A2P2_TASK_CONTRACT_VERSION,
    taskType: raw.taskType as A2P2DomainId,
    goalSummary,
    requirements,
    riskClass: raw.riskClass as EvaluationRiskClass,
    automationLevel: raw.automationLevel as AutomationLevel,
    recoveryPolicy: {
      enabled: recoveryRaw.enabled,
      allowedActions,
      maxRecoveryCycles: recoveryRaw.maxRecoveryCycles,
      allowExternalResearch: recoveryRaw.allowExternalResearch,
    },
    escalationPolicy: {
      requireHumanForRisk: escalationRaw.requireHumanForRisk as EvaluationRiskClass[],
      reasons: escalationRaw.reasons as EvaluationEscalationReason[],
    },
    evaluationBudget,
    provenance: {
      contractVersion: A2P2_TASK_CONTRACT_VERSION,
      source,
      sourceId,
      resolverVersion: A2P2_RESOLVER_VERSION,
      createdAt,
    },
  };
  return { ok: true, contract: brandContract(contract) };
}

export function failClosedTaskContract(
  source: "INVALID_EXPLICIT_CONTRACT" | "INVALID_WORKFLOW_CONTRACT",
  createdAt: string,
): ValidatedTaskContract {
  return brandContract({
    version: A2P2_TASK_CONTRACT_VERSION,
    taskType: "GENERIC",
    goalSummary: "invalid contract fail-closed",
    requirements: [],
    riskClass: "RESTRICTED",
    automationLevel: "L0_HUMAN_CONTROLLED",
    recoveryPolicy: defaultRecoveryPolicy({
      enabled: false,
      allowedActions: [],
      maxRecoveryCycles: 0,
      allowExternalResearch: false,
    }),
    escalationPolicy: defaultEscalationPolicy(["HIGH", "RESTRICTED"]),
    evaluationBudget: defaultEvaluationBudget(),
    provenance: {
      contractVersion: A2P2_TASK_CONTRACT_VERSION,
      source,
      resolverVersion: A2P2_RESOLVER_VERSION,
      createdAt,
    },
  });
}

