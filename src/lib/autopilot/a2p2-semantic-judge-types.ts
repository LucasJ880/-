/**
 * Autopilot A2-P2.2 — Grounded Semantic Judge contracts.
 *
 * LLM proposes per-requirement judgments.
 * Deterministic code decides global outcome and verdictState.
 *
 * Not wired to processor, persistence, recovery, or Production runtime.
 */

import type {
  A2P2DomainId,
  EvaluationEvidenceKind,
  EvaluationOutcomeHint,
  EvaluationVerdictState,
  RequirementCriticality,
} from "./a2p2-contract";
import type { SafeNormalizedValue } from "./a2p2-evidence-types";

export const A2P2_SEMANTIC_JUDGE_VERSION =
  "a2p2-grounded-semantic-judge-v1" as const;
export const A2P2_SEMANTIC_JUDGE_INPUT_VERSION =
  "a2p2-semantic-judge-input-v1" as const;
export const A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION =
  "a2p2-semantic-judge-proposal-v1" as const;
export const A2P2_SEMANTIC_JUDGE_PROMPT_VERSION =
  "a2p2-semantic-judge-prompt-v1" as const;

export const MAX_SEMANTIC_JUDGE_INPUT_BYTES = 32 * 1024;
export const MAX_SEMANTIC_JUDGE_OUTPUT_BYTES = 64 * 1024;
export const MAX_SEMANTIC_JUDGE_RATIONALE_CHARS = 160;
export const MAX_SEMANTIC_JUDGE_REQUIREMENTS = 32;
export const SEMANTIC_JUDGE_TOOL_COUNT = 0 as const;

export const SEMANTIC_JUDGMENTS = [
  "SATISFIED",
  "PARTIAL",
  "NOT_SATISFIED",
  "UNKNOWN",
] as const;
export type SemanticJudgment = (typeof SEMANTIC_JUDGMENTS)[number];

export const SEMANTIC_CONFIDENCES = ["low", "medium", "high"] as const;
export type SemanticConfidence = (typeof SEMANTIC_CONFIDENCES)[number];

export const SEMANTIC_PROPOSAL_REASON_CODES = [
  "EVIDENCE_SUPPORTS_REQUIREMENT",
  "EVIDENCE_PARTIALLY_SUPPORTS_REQUIREMENT",
  "EVIDENCE_CONTRADICTS_REQUIREMENT",
  "SEMANTIC_UNCERTAINTY",
] as const;
export type SemanticProposalReasonCode =
  (typeof SEMANTIC_PROPOSAL_REASON_CODES)[number];

export const SEMANTIC_JUDGMENT_REASON_MATRIX = {
  SATISFIED: "EVIDENCE_SUPPORTS_REQUIREMENT",
  PARTIAL: "EVIDENCE_PARTIALLY_SUPPORTS_REQUIREMENT",
  NOT_SATISFIED: "EVIDENCE_CONTRADICTS_REQUIREMENT",
  UNKNOWN: "SEMANTIC_UNCERTAINTY",
} as const satisfies Record<SemanticJudgment, SemanticProposalReasonCode>;

export const SEMANTIC_JUDGE_PROVIDER_STATUSES = [
  "NOT_CALLED",
  "RETURNED",
  "UNAVAILABLE",
] as const;
export type SemanticJudgeProviderStatus =
  (typeof SEMANTIC_JUDGE_PROVIDER_STATUSES)[number];

export const SEMANTIC_JUDGE_PROPOSAL_STATUSES = [
  "VALID",
  "REJECTED",
  "ABSTAINED",
] as const;
export type SemanticJudgeProposalStatus =
  (typeof SEMANTIC_JUDGE_PROPOSAL_STATUSES)[number];

/** Fields the model must never be allowed to set as authority. */
export const MODEL_FORBIDDEN_AUTHORITY_FIELDS = [
  "verdictState",
  "outcome",
  "failureType",
  "automationLevel",
  "riskClass",
  "routeDecision",
  "decision",
  "AUTO_FINALIZE",
  "AUTO_RECOVER",
  "AUTO_ABSTAIN",
  "HUMAN_ESCALATE",
  "POLICY_BLOCKED",
  "allowedNextActions",
  "recoveryActions",
] as const;

export const SEMANTIC_JUDGE_RULE_IDS = [
  "SEMANTIC_JUDGE_UNVALIDATED_CONTRACT",
  "SEMANTIC_JUDGE_GENERIC_EMPTY",
  "SEMANTIC_JUDGE_BUDGET_EXHAUSTED",
  "SEMANTIC_JUDGE_COST_BUDGET_EXHAUSTED",
  "SEMANTIC_JUDGE_INSUFFICIENT_PACKET",
  "SEMANTIC_JUDGE_CONFLICTING_PACKET",
  "SEMANTIC_JUDGE_PRIVACY_BLOCKED",
  "SEMANTIC_JUDGE_NOT_EVALUABLE",
  "SEMANTIC_JUDGE_PACKET_HASH_MISMATCH",
  "SEMANTIC_JUDGE_MALFORMED_PACKET",
  "SEMANTIC_JUDGE_CANONICAL_FACT_HASH_MISMATCH",
  "SEMANTIC_JUDGE_EVIDENCE_REF_MISMATCH",
  "SEMANTIC_JUDGE_WRONG_EVIDENCE_KIND",
  "SEMANTIC_JUDGE_UNKNOWN_EVIDENCE_KIND",
  "SEMANTIC_JUDGE_UNKNOWN_PRIVACY_CLASS",
  "SEMANTIC_JUDGE_UNKNOWN_ACCEPTANCE",
  "SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID",
  "SEMANTIC_JUDGE_ASSESSMENT_MISMATCH",
  "SEMANTIC_JUDGE_STATUS_MISMATCH",
  "SEMANTIC_JUDGE_SUMMARY_MISMATCH",
  "SEMANTIC_JUDGE_PACKET_LIMIT_EXCEEDED",
  "SEMANTIC_JUDGE_SECRET_IN_EVIDENCE",
  "SEMANTIC_JUDGE_HTML_IN_EVIDENCE",
  "SEMANTIC_JUDGE_PII_IN_EVIDENCE",
  "SEMANTIC_JUDGE_REQUIREMENT_LIMIT_EXCEEDED",
  "SEMANTIC_JUDGE_SEMANTIC_CONTRACT_MISMATCH",
  "SEMANTIC_JUDGE_CONTRACT_TASK_TYPE_MISMATCH",
  "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH",
  "SEMANTIC_JUDGE_CONTRACT_RISK_MISMATCH",
  "SEMANTIC_JUDGE_CONTRACT_AUTOMATION_MISMATCH",
  "SEMANTIC_JUDGE_SECRET_IN_TASK_SPEC",
  "SEMANTIC_JUDGE_HTML_IN_TASK_SPEC",
  "SEMANTIC_JUDGE_RAW_CONTENT_IN_TASK_SPEC",
  "SEMANTIC_JUDGE_PROMPT_INJECTION",
  "SEMANTIC_JUDGE_INPUT_LIMIT_EXCEEDED",
  "SEMANTIC_JUDGE_OUTPUT_LIMIT_EXCEEDED",
  "SEMANTIC_JUDGE_REQUIREMENT_ARRAY_LIMIT",
  "SEMANTIC_JUDGE_JUDGMENT_REASON_MISMATCH",
  "SEMANTIC_JUDGE_UNSAFE_RATIONALE",
  "SEMANTIC_JUDGE_PROVIDER_UNAVAILABLE",
  "SEMANTIC_JUDGE_PROPOSAL_REJECTED",
  "SEMANTIC_JUDGE_UNKNOWN_FIELD",
  "SEMANTIC_JUDGE_EXTRA_TEXT",
  "SEMANTIC_JUDGE_INVALID_ENUM",
  "SEMANTIC_JUDGE_MISSING_REQUIREMENT",
  "SEMANTIC_JUDGE_UNKNOWN_REQUIREMENT",
  "SEMANTIC_JUDGE_DUPLICATE_REQUIREMENT",
  "SEMANTIC_JUDGE_PACKET_HASH_ECHO_MISMATCH",
  "SEMANTIC_JUDGE_INPUT_HASH_ECHO_MISMATCH",
  "SEMANTIC_JUDGE_UNKNOWN_EVIDENCE_REF",
  "SEMANTIC_JUDGE_CROSS_REQUIREMENT_EVIDENCE_REF",
  "SEMANTIC_JUDGE_DUPLICATE_EVIDENCE_REF",
  "SEMANTIC_JUDGE_UNGROUNDED_SATISFIED",
  "SEMANTIC_JUDGE_UNGROUNDED_PARTIAL",
  "SEMANTIC_JUDGE_UNGROUNDED_NOT_SATISFIED",
  "SEMANTIC_JUDGE_SUCCESS_GATE_FAILED",
  "SEMANTIC_JUDGE_ACCEPTED_TASK_SUCCESS",
  "SEMANTIC_JUDGE_ACCEPTED_PARTIAL_SUCCESS",
  "SEMANTIC_JUDGE_ACCEPTED_FAILURE",
  "SEMANTIC_JUDGE_ABSTAINED",
] as const;
export type SemanticJudgeRuleId = (typeof SEMANTIC_JUDGE_RULE_IDS)[number];

export type SemanticJudgeBudgetState = {
  judgeCallsUsed: number;
  costUsdUsed: number;
};

export type JudgeSafeRequirement = {
  requirementId: string;
  normalizedDescription: string;
  required: boolean;
  criticality: RequirementCriticality;
  allowUnknown: boolean;
  minimumEvidenceRefs: number;
  evidenceKinds: readonly EvaluationEvidenceKind[];
};

export type JudgeSafeEvidenceFact = {
  evidenceRef: string;
  requirementId: string;
  evidenceKind: EvaluationEvidenceKind;
  factKey: string;
  factSummary: string;
  normalizedValue: SafeNormalizedValue;
};

export type SemanticJudgeFacingInput = {
  version: typeof A2P2_SEMANTIC_JUDGE_INPUT_VERSION;
  judgeVersion: typeof A2P2_SEMANTIC_JUDGE_VERSION;
  promptVersion: typeof A2P2_SEMANTIC_JUDGE_PROMPT_VERSION;
  packetHash: string;
  judgeInputHash: string;
  taskType: A2P2DomainId;
  requirements: readonly JudgeSafeRequirement[];
  evidenceFacts: readonly JudgeSafeEvidenceFact[];
};

export const SEMANTIC_JUDGE_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "packetHash", "judgeInputHash", "requirements"],
  properties: {
    version: { const: A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION },
    packetHash: { type: "string" },
    judgeInputHash: { type: "string" },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "requirementId",
          "judgment",
          "confidence",
          "evidenceRefs",
          "reasonCode",
          "rationale",
        ],
        properties: {
          requirementId: { type: "string" },
          judgment: { enum: [...SEMANTIC_JUDGMENTS] },
          confidence: { enum: [...SEMANTIC_CONFIDENCES] },
          evidenceRefs: { type: "array", items: { type: "string" } },
          reasonCode: { enum: [...SEMANTIC_PROPOSAL_REASON_CODES] },
          rationale: { type: "string", maxLength: MAX_SEMANTIC_JUDGE_RATIONALE_CHARS },
        },
      },
      maxItems: MAX_SEMANTIC_JUDGE_REQUIREMENTS,
    },
  },
} as const;

export type SemanticJudgeProviderRequest = {
  systemPrompt: string;
  userContent: string;
  tools: readonly [];
  toolChoice: "none";
  jsonSchema: typeof SEMANTIC_JUDGE_PROPOSAL_JSON_SCHEMA;
};

export type SemanticJudgeProviderResult = {
  text: string;
};

export type SemanticJudgeProvider = (
  request: SemanticJudgeProviderRequest,
) => Promise<SemanticJudgeProviderResult>;

export type ParsedRequirementProposal = {
  requirementId: string;
  judgment: SemanticJudgment;
  confidence: SemanticConfidence;
  evidenceRefs: readonly string[];
  reasonCode: SemanticProposalReasonCode;
  rationale: string;
};

export type ParsedSemanticJudgeProposal = {
  version: typeof A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION;
  packetHash: string;
  judgeInputHash: string;
  requirements: readonly ParsedRequirementProposal[];
};

export type SemanticJudgeDecision = {
  judgeVersion: typeof A2P2_SEMANTIC_JUDGE_VERSION;
  promptVersion: typeof A2P2_SEMANTIC_JUDGE_PROMPT_VERSION;
  packetHash: string | null;
  judgeInputHash: string | null;
  proposalHash?: string;
  providerStatus: SemanticJudgeProviderStatus;
  proposalStatus: SemanticJudgeProposalStatus;
  requirementJudgments: readonly ParsedRequirementProposal[];
  outcome: EvaluationOutcomeHint;
  verdictState: Extract<
    EvaluationVerdictState,
    "ACCEPTED" | "ABSTAINED" | "NOT_EVALUATED"
  >;
  ruleId: SemanticJudgeRuleId;
  failureType: null;
};

export type SemanticJudgeRunInput = {
  taskContract: unknown;
  evidencePacket: unknown;
  budgetState: SemanticJudgeBudgetState;
  provider: SemanticJudgeProvider;
};
