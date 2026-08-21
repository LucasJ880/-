/**
 * Autopilot A2-P2.0 — domain task-contract templates and resolver.
 *
 * Deterministic metadata only. Does not parse prompts, emails, or tenders.
 */

import {
  A2P2_DOMAIN_IDS,
  A2P2_RESOLVER_VERSION,
  A2P2_TASK_CONTRACT_VERSION,
  defaultEscalationPolicy,
  defaultEvaluationBudget,
  defaultRecoveryPolicy,
  failClosedTaskContract,
  parseTaskContract,
  sanitizeGoalSummary,
  type A2P2DomainId,
  type AutonomousEvaluationTaskContract,
  type EvaluationRequirement,
  type TaskContractSource,
  type ValidatedTaskContract,
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

function parseOrFail(
  value: AutonomousEvaluationTaskContract | Record<string, unknown>,
  source: TaskContractSource,
  createdAt: string,
): ValidatedTaskContract | null {
  const parsed = parseTaskContract(value, { source, createdAt });
  return parsed.ok ? parsed.contract : null;
}

function domainTemplate(domain: A2P2DomainId, createdAt: string): ValidatedTaskContract {
  const parsed = parseTaskContract(A2P2_DOMAIN_TEMPLATES[domain](createdAt), {
    source: domain === "GENERIC" ? "GENERIC_FALLBACK" : "DOMAIN_TEMPLATE",
    createdAt,
  });
  if (!parsed.ok) {
    return failClosedTaskContract("INVALID_EXPLICIT_CONTRACT", createdAt);
  }
  return parsed.contract;
}

/**
 * Priority: explicit typed contract → workflow contract → domain template → generic.
 * Never parses conversation text or customer content.
 *
 * If an explicit or workflow contract EXISTS and is malformed/unsafe,
 * fail closed. Do not silently fall through to a lower-risk domain template.
 */
export function resolveTaskContract(
  input: ResolveTaskContractInput = {},
): ValidatedTaskContract {
  const createdAt = (input.now ?? new Date()).toISOString();
  if (input.explicitContract != null) {
    return (
      parseOrFail(input.explicitContract, "EXPLICIT_CONTRACT", createdAt) ??
      failClosedTaskContract("INVALID_EXPLICIT_CONTRACT", createdAt)
    );
  }
  if (input.workflowContract != null) {
    return (
      parseOrFail(input.workflowContract, "WORKFLOW_TEMPLATE", createdAt) ??
      failClosedTaskContract("INVALID_WORKFLOW_CONTRACT", createdAt)
    );
  }
  if (isKnownDomain(input.domainHint)) {
    return domainTemplate(input.domainHint, createdAt);
  }
  return domainTemplate("GENERIC", createdAt);
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
