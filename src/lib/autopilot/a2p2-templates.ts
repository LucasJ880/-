/**
 * Autopilot A2-P2.0 — domain task-contract templates and resolver.
 *
 * Deterministic metadata only. Does not parse prompts, emails, or tenders.
 */

import {
  A2P2_DOMAIN_IDS,
  A2P2_RESOLVER_VERSION,
  A2P2_TASK_CONTRACT_VERSION,
  assertFiniteBudget,
  assertRecoveryAllowlist,
  defaultEscalationPolicy,
  defaultEvaluationBudget,
  defaultRecoveryPolicy,
  hasForbiddenContractFields,
  sanitizeGoalSummary,
  type A2P2DomainId,
  type AutonomousEvaluationTaskContract,
  type EvaluationRequirement,
  type TaskContractSource,
} from "./a2p2-contract";

function requirement(
  input: Omit<EvaluationRequirement, "normalizedDescription"> & {
    normalizedDescription?: string;
  },
): EvaluationRequirement {
  return {
    ...input,
    normalizedDescription:
      input.normalizedDescription ?? sanitizeGoalSummary(input.label),
  };
}

const TENDER_REQUIREMENTS: readonly EvaluationRequirement[] = [
  requirement({
    id: "submission_deadline",
    label: "submission deadline",
    required: true,
    evidenceKinds: ["SOURCE_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: false,
    criticality: "HIGH",
  }),
  requirement({
    id: "submission_method",
    label: "submission method",
    required: false,
    evidenceKinds: ["SOURCE_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: true,
    criticality: "MEDIUM",
  }),
  requirement({
    id: "mandatory_requirements",
    label: "mandatory requirements",
    required: true,
    evidenceKinds: ["SOURCE_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: false,
    criticality: "HIGH",
  }),
  requirement({
    id: "pricing_requirements",
    label: "pricing requirements",
    required: false,
    evidenceKinds: ["SOURCE_FACT", "BUSINESS_STATE"],
    minimumEvidenceRefs: 1,
    allowUnknown: true,
    criticality: "MEDIUM",
  }),
  requirement({
    id: "evaluation_criteria",
    label: "evaluation criteria",
    required: false,
    evidenceKinds: ["SOURCE_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: true,
    criticality: "MEDIUM",
  }),
];

const RESEARCH_REQUIREMENTS: readonly EvaluationRequirement[] = [
  requirement({
    id: "question_answered",
    label: "question answered",
    required: true,
    evidenceKinds: ["ARTIFACT_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: false,
    criticality: "HIGH",
  }),
  requirement({
    id: "source_evidence_present",
    label: "source evidence present",
    required: true,
    evidenceKinds: ["SOURCE_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: false,
    criticality: "HIGH",
  }),
  requirement({
    id: "source_freshness_known",
    label: "source freshness known",
    required: false,
    evidenceKinds: ["SOURCE_FACT", "RUNTIME_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: true,
    criticality: "LOW",
  }),
];

const EMAIL_DRAFT_REQUIREMENTS: readonly EvaluationRequirement[] = [
  requirement({
    id: "purpose_addressed",
    label: "purpose addressed",
    required: true,
    evidenceKinds: ["ARTIFACT_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: false,
    criticality: "HIGH",
  }),
  requirement({
    id: "required_questions_present",
    label: "required questions present",
    required: false,
    evidenceKinds: ["ARTIFACT_FACT", "SOURCE_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: true,
    criticality: "MEDIUM",
  }),
  requirement({
    id: "unsupported_commitment_absent",
    label: "unsupported commitment absent",
    required: true,
    evidenceKinds: ["ARTIFACT_FACT", "SOURCE_FACT"],
    minimumEvidenceRefs: 1,
    allowUnknown: false,
    criticality: "HIGH",
  }),
];

function provenance(
  source: TaskContractSource,
  sourceId: string | undefined,
  createdAt: string,
): AutonomousEvaluationTaskContract["provenance"] {
  return {
    contractVersion: A2P2_TASK_CONTRACT_VERSION,
    source,
    sourceId,
    resolverVersion: A2P2_RESOLVER_VERSION,
    createdAt,
  };
}

function conservativeGeneric(
  createdAt: string,
  source: TaskContractSource,
  sourceId?: string,
): AutonomousEvaluationTaskContract {
  return {
    version: A2P2_TASK_CONTRACT_VERSION,
    taskType: "GENERIC",
    goalSummary: "generic conservative evaluation",
    requirements: [],
    riskClass: "MEDIUM",
    automationLevel: "L1_AUTO_ANALYZE",
    recoveryPolicy: defaultRecoveryPolicy({
      allowedActions: [
        "READ_EXISTING_DOCUMENT",
        "SEARCH_PROJECT_DOCUMENTS",
        "SEARCH_INTERNAL_FACTS",
        "REFRESH_SOURCE_FACTS",
        "RECHECK_TOOL_RESULT",
      ],
      allowExternalResearch: false,
    }),
    escalationPolicy: defaultEscalationPolicy(),
    evaluationBudget: defaultEvaluationBudget(),
    provenance: provenance(source, sourceId, createdAt),
  };
}

export const A2P2_DOMAIN_TEMPLATES: Record<
  A2P2DomainId,
  (createdAt: string) => AutonomousEvaluationTaskContract
> = {
  TENDER_ANALYSIS: (createdAt) => ({
    version: A2P2_TASK_CONTRACT_VERSION,
    taskType: "TENDER_ANALYSIS",
    goalSummary: "tender analysis evaluation",
    requirements: TENDER_REQUIREMENTS,
    riskClass: "LOW",
    automationLevel: "L1_AUTO_ANALYZE",
    recoveryPolicy: defaultRecoveryPolicy({
      allowExternalResearch: true,
    }),
    escalationPolicy: defaultEscalationPolicy(),
    evaluationBudget: defaultEvaluationBudget(),
    provenance: provenance("DOMAIN_TEMPLATE", "TENDER_ANALYSIS", createdAt),
  }),
  RESEARCH: (createdAt) => ({
    version: A2P2_TASK_CONTRACT_VERSION,
    taskType: "RESEARCH",
    goalSummary: "research evaluation",
    requirements: RESEARCH_REQUIREMENTS,
    riskClass: "LOW",
    automationLevel: "L1_AUTO_ANALYZE",
    recoveryPolicy: defaultRecoveryPolicy({
      allowExternalResearch: true,
    }),
    escalationPolicy: defaultEscalationPolicy(),
    evaluationBudget: defaultEvaluationBudget(),
    provenance: provenance("DOMAIN_TEMPLATE", "RESEARCH", createdAt),
  }),
  EMAIL_DRAFT: (createdAt) => ({
    version: A2P2_TASK_CONTRACT_VERSION,
    taskType: "EMAIL_DRAFT",
    goalSummary: "email draft evaluation",
    requirements: EMAIL_DRAFT_REQUIREMENTS,
    riskClass: "MEDIUM",
    automationLevel: "L2_AUTO_PREPARE",
    recoveryPolicy: defaultRecoveryPolicy({
      allowedActions: [
        "READ_EXISTING_DOCUMENT",
        "SEARCH_PROJECT_DOCUMENTS",
        "SEARCH_INTERNAL_FACTS",
        "REFRESH_SOURCE_FACTS",
        "RECHECK_TOOL_RESULT",
      ],
      allowExternalResearch: false,
    }),
    escalationPolicy: defaultEscalationPolicy(),
    evaluationBudget: defaultEvaluationBudget(),
    provenance: provenance("DOMAIN_TEMPLATE", "EMAIL_DRAFT", createdAt),
  }),
  GENERIC: (createdAt) => conservativeGeneric(createdAt, "GENERIC_FALLBACK", "GENERIC"),
};

export type ResolveTaskContractInput = {
  explicitContract?: AutonomousEvaluationTaskContract | Record<string, unknown>;
  workflowContract?: AutonomousEvaluationTaskContract | Record<string, unknown>;
  domainHint?: string | null;
  now?: Date;
};

function isKnownDomain(value: string | null | undefined): value is A2P2DomainId {
  return (A2P2_DOMAIN_IDS as readonly string[]).includes(value ?? "");
}

function asTaskContract(
  value: AutonomousEvaluationTaskContract | Record<string, unknown>,
  source: TaskContractSource,
  createdAt: string,
): AutonomousEvaluationTaskContract | null {
  if (hasForbiddenContractFields(value as Record<string, unknown>)) {
    return null;
  }
  const candidate = value as AutonomousEvaluationTaskContract;
  if (candidate.version !== A2P2_TASK_CONTRACT_VERSION) return null;
  if (!isKnownDomain(candidate.taskType)) return null;
  if (candidate.automationLevel === "L4_CONTROLLED_EXTERNAL_ACTION") return null;
  if (candidate.automationLevel === "L5_RESTRICTED") return null;
  try {
    assertFiniteBudget(candidate.evaluationBudget);
    const allowed = assertRecoveryAllowlist(
      candidate.recoveryPolicy.allowedActions as readonly string[],
    );
    return {
      ...candidate,
      goalSummary: sanitizeGoalSummary(candidate.goalSummary ?? ""),
      recoveryPolicy: {
        ...candidate.recoveryPolicy,
        allowedActions: allowed,
      },
      provenance: {
        ...candidate.provenance,
        contractVersion: A2P2_TASK_CONTRACT_VERSION,
        source,
        resolverVersion: A2P2_RESOLVER_VERSION,
        createdAt: candidate.provenance?.createdAt ?? createdAt,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Priority: explicit typed contract → workflow contract → domain template → generic.
 * Never parses conversation text or customer content.
 */
export function resolveTaskContract(
  input: ResolveTaskContractInput = {},
): AutonomousEvaluationTaskContract {
  const createdAt = (input.now ?? new Date()).toISOString();
  if (input.explicitContract) {
    const explicit = asTaskContract(
      input.explicitContract,
      "EXPLICIT_CONTRACT",
      createdAt,
    );
    if (explicit) return explicit;
  }
  if (input.workflowContract) {
    const workflow = asTaskContract(
      input.workflowContract,
      "WORKFLOW_TEMPLATE",
      createdAt,
    );
    if (workflow) return workflow;
  }
  if (isKnownDomain(input.domainHint)) {
    return A2P2_DOMAIN_TEMPLATES[input.domainHint](createdAt);
  }
  return conservativeGeneric(createdAt, "GENERIC_FALLBACK");
}

export function emailDraftForbidsAutoSend(
  contract: AutonomousEvaluationTaskContract,
): boolean {
  const actions = contract.recoveryPolicy.allowedActions as readonly string[];
  return (
    contract.taskType === "EMAIL_DRAFT" &&
    contract.automationLevel !== "L4_CONTROLLED_EXTERNAL_ACTION" &&
    contract.automationLevel !== "L5_RESTRICTED" &&
    !actions.includes("SEND_EMAIL")
  );
}
