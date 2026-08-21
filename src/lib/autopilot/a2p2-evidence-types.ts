/**
 * Autopilot A2-P2.1 — Semantic Evidence Packet V1 contracts.
 *
 * Pure types and bounds. Does not call an LLM, execute recovery,
 * write to the database, or attach to A1 / A2-P0 / A2-P1 runtime.
 */

import type {
  A2P2DomainId,
  EvaluationEvidenceKind,
  EvaluationPrivacyClass,
  EvaluationRequirement,
} from "./a2p2-contract";

export const A2P2_EVIDENCE_SURFACE = "A2_P2_1_EVIDENCE_BUILDER" as const;
export const A2P2_EVIDENCE_PACKET_VERSION = "a2p2-evidence-packet-v1" as const;
export const A2P2_EVIDENCE_COLLECTOR_VERSION = "a2p2-evidence-collector-v1" as const;
export const A2P2_EVIDENCE_BUILDER_VERSION = "a2p2-evidence-builder-v1" as const;

export const SAFE_FACT_STRING_MAX = 500;
export const MAX_EVIDENCE_FACTS = 100;
export const MAX_FACTS_PER_REQUIREMENT = 20;
export const MAX_PACKET_SAFE_TEXT_BYTES = 32 * 1024;
export const MAX_SAFE_SCALAR_ARRAY = 20;
export const MAX_LOCATOR_STRING = 80;

export const EVIDENCE_SOURCE_STATES = [
  "FOUND",
  "NOT_FOUND",
  "UNKNOWN",
  "NOT_APPLICABLE",
] as const;
export type EvidenceSourceState = (typeof EVIDENCE_SOURCE_STATES)[number];

export const EVIDENCE_ACCEPTANCE_STATES = [
  "COLLECTED",
  "REDACTED",
  "BLOCKED",
] as const;
export type EvidenceAcceptanceState = (typeof EVIDENCE_ACCEPTANCE_STATES)[number];

export const REQUIREMENT_EVIDENCE_STATES = [
  "READY",
  "INSUFFICIENT",
  "CONFLICTING",
  "PRIVACY_BLOCKED",
  "NOT_EVALUABLE",
] as const;
export type RequirementEvidenceState =
  (typeof REQUIREMENT_EVIDENCE_STATES)[number];

export const EVIDENCE_PACKET_STATUSES = [
  "SUFFICIENT",
  "INSUFFICIENT",
  "CONFLICTING",
  "PRIVACY_BLOCKED",
  "NOT_EVALUABLE",
] as const;
export type EvidencePacketStatus = (typeof EVIDENCE_PACKET_STATUSES)[number];

export const EVIDENCE_REASON_CODES = [
  "EVIDENCE_READY",
  "EVIDENCE_MISSING",
  "EVIDENCE_KIND_MISMATCH",
  "EVIDENCE_DUPLICATE",
  "EVIDENCE_STRUCTURAL_CONFLICT",
  "EVIDENCE_PRIVACY_BLOCKED",
  "EVIDENCE_SECRET_BLOCKED",
  "EVIDENCE_RAW_CONTENT_REJECTED",
  "EVIDENCE_UNKNOWN_REQUIREMENT",
  "EVIDENCE_PACKET_LIMIT_EXCEEDED",
  "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE",
  "EVIDENCE_GENERIC_NOT_EVALUABLE",
  "EVIDENCE_UNVALIDATED_CONTRACT",
  "EVIDENCE_INVALID_VALUE",
  "EVIDENCE_OPTIONAL_REJECTED",
] as const;
export type EvidenceReasonCode = (typeof EVIDENCE_REASON_CODES)[number];

export type SafeScalar = string | number | boolean | null;
export type SafeNormalizedValue = SafeScalar | readonly SafeScalar[];

export type EvidenceLocator = {
  page?: number;
  section?: string;
  field?: string;
  recordKey?: string;
  toolName?: string;
};

export type EvidenceFact = {
  evidenceRef: string;
  evidenceKind: EvaluationEvidenceKind;
  requirementId: string;
  factKey: string;
  factSummary: string;
  normalizedValue: SafeNormalizedValue;
  source: {
    sourceType: string;
    sourceId: string;
    locator?: EvidenceLocator;
  };
  contentHash: string;
  privacyClass: EvaluationPrivacyClass;
  acceptance: EvidenceAcceptanceState;
  countsTowardRequirement: boolean;
  provenance: {
    collectorVersion: typeof A2P2_EVIDENCE_COLLECTOR_VERSION;
    extractorVersion?: string;
    sourceObservedAt?: string;
    createdAt: string;
  };
};

export type RequirementEvidenceAssessment = {
  requirementId: string;
  requiredEvidenceRefs: number;
  validEvidenceRefs: readonly string[];
  state: RequirementEvidenceState;
  reasonCode: EvidenceReasonCode;
};

export type RejectedEvidence = {
  reasonCode: EvidenceReasonCode;
  requirementId?: string;
  factKey?: string;
};

export type EvidenceDiagnostic = {
  code: EvidenceReasonCode;
  detail?: string;
};

export type CollectorResult = {
  collectorVersion: typeof A2P2_EVIDENCE_COLLECTOR_VERSION;
  taskType: A2P2DomainId;
  facts: readonly EvidenceCandidate[];
  rejectedFacts: readonly RejectedEvidence[];
  diagnostics: readonly EvidenceDiagnostic[];
};

export type EvidenceCandidate = {
  requirementId: string;
  evidenceKind: EvaluationEvidenceKind;
  factKey: string;
  factSummary: string;
  normalizedValue: SafeNormalizedValue;
  sourceType: string;
  sourceId: string;
  locator?: EvidenceLocator;
  contentHash?: string;
  privacyClass?: EvaluationPrivacyClass;
  extractorVersion?: string;
  sourceObservedAt?: string;
};

export type TenderStructuredFact = {
  factType: string;
  claim?: string;
  normalizedValue?: SafeNormalizedValue;
  sourceState?: EvidenceSourceState;
  sourceType?: string;
  sourceId: string;
  page?: number;
  field?: string;
  contentHash?: string;
  status?: "ACTIVE" | "SUPERSEDED" | "CONFLICT";
};

export type TenderStructuredSnapshot = {
  facts?: readonly TenderStructuredFact[];
  mandatoryRequirementPresent?: boolean;
  mandatorySourceId?: string;
};

export type ResearchStructuredClaim = {
  requirementId: string;
  claimKey: string;
  summary: string;
  sourceId: string;
  sourceDate?: string;
  contentHash?: string;
  evidenceKind?: EvaluationEvidenceKind;
};

export type ResearchStructuredSnapshot = {
  claims?: readonly ResearchStructuredClaim[];
};

export type EmailDraftStructuredSnapshot = {
  purposeAddressed?: boolean;
  requiredQuestionIds?: readonly string[];
  unsupportedCommitmentAbsent?: boolean;
  recipientResolved?: boolean;
  sourceId?: string;
};

export type GenericStructuredFact = {
  requirementId: string;
  factKey: string;
  summary: string;
  sourceId: string;
  evidenceKind?: EvaluationEvidenceKind;
  normalizedValue?: SafeNormalizedValue;
};

export type GenericStructuredSnapshot = {
  facts?: readonly GenericStructuredFact[];
};

export type StructuredSourcesSnapshot = {
  tender?: TenderStructuredSnapshot;
  research?: ResearchStructuredSnapshot;
  emailDraft?: EmailDraftStructuredSnapshot;
  generic?: GenericStructuredSnapshot;
};

export type SafeContractMetadata = {
  taskType: A2P2DomainId;
  riskClass: string;
  automationLevel: string;
  requirementCount: number;
};

export type SemanticEvidencePacketV1 = {
  version: typeof A2P2_EVIDENCE_PACKET_VERSION;
  builderVersion: typeof A2P2_EVIDENCE_BUILDER_VERSION;
  contract: SafeContractMetadata;
  taskType: A2P2DomainId;
  requirements: readonly Pick<
    EvaluationRequirement,
    "id" | "required" | "evidenceKinds" | "minimumEvidenceRefs" | "allowUnknown"
  >[];
  evidenceFacts: readonly EvidenceFact[];
  rejectedFacts: readonly RejectedEvidence[];
  requirementAssessments: readonly RequirementEvidenceAssessment[];
  status: EvidencePacketStatus;
  privacySummary: {
    blocked: boolean;
    redactedCount: number;
    prohibitedCount: number;
  };
  provenanceSummary: {
    collectorVersion: typeof A2P2_EVIDENCE_COLLECTOR_VERSION;
    factCount: number;
    rejectedCount: number;
  };
  diagnostics: readonly EvidenceDiagnostic[];
  packetHash: string;
};
