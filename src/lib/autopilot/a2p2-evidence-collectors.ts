/**
 * Autopilot A2-P2.1 — automatic collector registry.
 *
 * Transforms already-structured snapshots into EvidenceCandidates.
 * Does not query DB, call tools, search the web, send email, or invoke an LLM.
 */

import {
  A2P2_DOMAIN_IDS,
  type A2P2DomainId,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import { containsSecretMaterial, scanForbiddenEvidenceFields } from "./a2p2-evidence-privacy";
import {
  A2P2_EVIDENCE_COLLECTOR_VERSION,
  type CollectorResult,
  type EvidenceCandidate,
  type EvidenceDiagnostic,
  type RejectedEvidence,
  type StructuredSourcesSnapshot,
} from "./a2p2-evidence-types";

const TENDER_FACT_TYPE_TO_REQUIREMENT: Record<string, string> = {
  closing_datetime: "submission_deadline",
  submission_method: "submission_method",
  pricing_method: "pricing_requirements",
  evaluation_criteria: "evaluation_criteria",
};

function emptyResult(
  taskType: A2P2DomainId,
  diagnostics: readonly EvidenceDiagnostic[] = [],
  rejectedFacts: readonly RejectedEvidence[] = [],
): CollectorResult {
  return {
    collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
    taskType,
    facts: [],
    rejectedFacts,
    diagnostics,
  };
}

function rejectIfUnsafe(
  value: unknown,
  requirementId: string,
  factKey: string,
): RejectedEvidence | null {
  if (scanForbiddenEvidenceFields(value)) {
    return { reasonCode: "EVIDENCE_RAW_CONTENT_REJECTED", requirementId, factKey };
  }
  if (containsSecretMaterial(value)) {
    return { reasonCode: "EVIDENCE_SECRET_BLOCKED", requirementId, factKey };
  }
  return null;
}

function knownRequirementIds(contract: ValidatedTaskContract): Set<string> {
  return new Set(contract.requirements.map((item) => item.id));
}

export function selectEvidenceCollector(
  taskType: A2P2DomainId,
): (contract: ValidatedTaskContract, sources: StructuredSourcesSnapshot) => CollectorResult {
  if (taskType === "TENDER_ANALYSIS") return collectTenderEvidence;
  if (taskType === "RESEARCH") return collectResearchEvidence;
  if (taskType === "EMAIL_DRAFT") return collectEmailDraftEvidence;
  return collectGenericEvidence;
}

export function collectEvidenceForContract(
  contract: ValidatedTaskContract,
  sources: StructuredSourcesSnapshot = {},
): CollectorResult {
  return selectEvidenceCollector(contract.taskType)(contract, sources);
}

export function collectTenderEvidence(
  contract: ValidatedTaskContract,
  sources: StructuredSourcesSnapshot,
): CollectorResult {
  const snapshot = sources.tender;
  if (!snapshot) {
    return emptyResult("TENDER_ANALYSIS", [
      { code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "tender snapshot missing" },
    ]);
  }
  const ids = knownRequirementIds(contract);
  const facts: EvidenceCandidate[] = [];
  const rejected: RejectedEvidence[] = [];
  for (const fact of snapshot.facts ?? []) {
    if (fact.sourceState === "NOT_FOUND" || fact.sourceState === "NOT_APPLICABLE") {
      continue;
    }
    if (fact.status === "SUPERSEDED") continue;
    const requirementId = TENDER_FACT_TYPE_TO_REQUIREMENT[fact.factType];
    if (!requirementId) continue;
    if (!ids.has(requirementId)) {
      rejected.push({
        reasonCode: "EVIDENCE_UNKNOWN_REQUIREMENT",
        requirementId,
        factKey: fact.factType,
      });
      continue;
    }
    const unsafe = rejectIfUnsafe(fact, requirementId, fact.factType);
    if (unsafe) {
      rejected.push(unsafe);
      continue;
    }
    if (fact.sourceState === "UNKNOWN") continue;
    const summary = (fact.claim ?? String(fact.normalizedValue ?? fact.factType)).slice(0, 500);
    facts.push({
      requirementId,
      evidenceKind: "SOURCE_FACT",
      factKey: fact.factType,
      factSummary: summary,
      normalizedValue: fact.normalizedValue ?? summary,
      sourceType: fact.sourceType ?? "TENDER_DOCUMENT_FACT",
      sourceId: fact.sourceId,
      locator: { page: fact.page, field: fact.field },
      contentHash: fact.contentHash,
      extractorVersion: "tender-understanding/v2",
    });
  }
  if (snapshot.mandatoryRequirementPresent === true && ids.has("mandatory_requirements")) {
    facts.push({
      requirementId: "mandatory_requirements",
      evidenceKind: "SOURCE_FACT",
      factKey: "mandatory_requirement_present",
      factSummary: "structured mandatory requirement present",
      normalizedValue: true,
      sourceType: "TENDER_REQUIREMENT",
      sourceId: snapshot.mandatorySourceId ?? "tender-mandatory",
      extractorVersion: "tender-understanding/v2",
    });
  }
  return {
    collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
    taskType: "TENDER_ANALYSIS",
    facts,
    rejectedFacts: rejected,
    diagnostics: [],
  };
}

export function collectResearchEvidence(
  contract: ValidatedTaskContract,
  sources: StructuredSourcesSnapshot,
): CollectorResult {
  const snapshot = sources.research;
  if (!snapshot || !snapshot.claims || snapshot.claims.length === 0) {
    return emptyResult("RESEARCH", [
      { code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "research claims missing" },
    ]);
  }
  const ids = knownRequirementIds(contract);
  const facts: EvidenceCandidate[] = [];
  const rejected: RejectedEvidence[] = [];
  for (const claim of snapshot.claims) {
    if (!ids.has(claim.requirementId)) {
      rejected.push({
        reasonCode: "EVIDENCE_UNKNOWN_REQUIREMENT",
        requirementId: claim.requirementId,
        factKey: claim.claimKey,
      });
      continue;
    }
    const unsafe = rejectIfUnsafe(claim, claim.requirementId, claim.claimKey);
    if (unsafe) {
      rejected.push(unsafe);
      continue;
    }
    facts.push({
      requirementId: claim.requirementId,
      evidenceKind: claim.evidenceKind ?? "SOURCE_FACT",
      factKey: claim.claimKey,
      factSummary: claim.summary,
      normalizedValue: claim.summary,
      sourceType: "RESEARCH_CLAIM",
      sourceId: claim.sourceId,
      locator: { field: claim.sourceDate },
      contentHash: claim.contentHash,
    });
  }
  return {
    collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
    taskType: "RESEARCH",
    facts,
    rejectedFacts: rejected,
    diagnostics: [],
  };
}

export function collectEmailDraftEvidence(
  contract: ValidatedTaskContract,
  sources: StructuredSourcesSnapshot,
): CollectorResult {
  const snapshot = sources.emailDraft;
  if (!snapshot) {
    return emptyResult("EMAIL_DRAFT", [
      { code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "email structured metadata missing" },
    ]);
  }
  const emailUnsafe = rejectIfUnsafe(snapshot, "purpose_addressed", "email_draft_snapshot");
  if (emailUnsafe) {
    return emptyResult("EMAIL_DRAFT", [], [emailUnsafe]);
  }
  const ids = knownRequirementIds(contract);
  const sourceId = snapshot.sourceId ?? "email-draft-metadata";
  const facts: EvidenceCandidate[] = [];
  if (snapshot.purposeAddressed === true && ids.has("purpose_addressed")) {
    facts.push({
      requirementId: "purpose_addressed",
      evidenceKind: "ARTIFACT_FACT",
      factKey: "purpose_addressed",
      factSummary: "structured draft purpose addressed",
      normalizedValue: true,
      sourceType: "EMAIL_DRAFT_METADATA",
      sourceId,
    });
  }
  if (
    snapshot.requiredQuestionIds &&
    snapshot.requiredQuestionIds.length > 0 &&
    ids.has("required_questions_present")
  ) {
    facts.push({
      requirementId: "required_questions_present",
      evidenceKind: "ARTIFACT_FACT",
      factKey: "required_questions_present",
      factSummary: "structured required question ids present",
      normalizedValue: snapshot.requiredQuestionIds.map((id) => String(id).slice(0, 80)),
      sourceType: "EMAIL_DRAFT_METADATA",
      sourceId,
    });
  }
  if (
    snapshot.unsupportedCommitmentAbsent === true &&
    ids.has("unsupported_commitment_absent")
  ) {
    facts.push({
      requirementId: "unsupported_commitment_absent",
      evidenceKind: "ARTIFACT_FACT",
      factKey: "unsupported_commitment_absent",
      factSummary: "structured unsupported commitment absent",
      normalizedValue: true,
      sourceType: "EMAIL_DRAFT_METADATA",
      sourceId,
    });
  }
  return {
    collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
    taskType: "EMAIL_DRAFT",
    facts,
    rejectedFacts: [],
    diagnostics: [],
  };
}

export function collectGenericEvidence(
  contract: ValidatedTaskContract,
  sources: StructuredSourcesSnapshot,
): CollectorResult {
  const snapshot = sources.generic;
  if (!snapshot || !snapshot.facts || snapshot.facts.length === 0) {
    return emptyResult("GENERIC", contract.requirements.length === 0
      ? [{ code: "EVIDENCE_GENERIC_NOT_EVALUABLE", detail: "empty generic contract" }]
      : [{ code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "generic facts missing" }]);
  }
  const ids = knownRequirementIds(contract);
  const facts: EvidenceCandidate[] = [];
  const rejected: RejectedEvidence[] = [];
  for (const fact of snapshot.facts) {
    if (!ids.has(fact.requirementId)) {
      rejected.push({
        reasonCode: "EVIDENCE_UNKNOWN_REQUIREMENT",
        requirementId: fact.requirementId,
        factKey: fact.factKey,
      });
      continue;
    }
    const unsafe = rejectIfUnsafe(fact, fact.requirementId, fact.factKey);
    if (unsafe) {
      rejected.push(unsafe);
      continue;
    }
    facts.push({
      requirementId: fact.requirementId,
      evidenceKind: fact.evidenceKind ?? "SOURCE_FACT",
      factKey: fact.factKey,
      factSummary: fact.summary,
      normalizedValue: fact.normalizedValue ?? fact.summary,
      sourceType: "GENERIC_STRUCTURED_FACT",
      sourceId: fact.sourceId,
    });
  }
  return {
    collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
    taskType: "GENERIC",
    facts,
    rejectedFacts: rejected,
    diagnostics: [],
  };
}

export const EVIDENCE_COLLECTOR_REGISTRY: Record<
  A2P2DomainId,
  (contract: ValidatedTaskContract, sources: StructuredSourcesSnapshot) => CollectorResult
> = {
  TENDER_ANALYSIS: collectTenderEvidence,
  RESEARCH: collectResearchEvidence,
  EMAIL_DRAFT: collectEmailDraftEvidence,
  GENERIC: collectGenericEvidence,
};

export function isKnownEvidenceTaskType(value: string): value is A2P2DomainId {
  return (A2P2_DOMAIN_IDS as readonly string[]).includes(value);
}
