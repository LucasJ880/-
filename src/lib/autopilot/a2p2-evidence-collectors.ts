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
import { containsSecretMaterial, safeRejectedIdentifier, scanForbiddenEvidenceFields } from "./a2p2-evidence-privacy";
import { adaptParsedTenderSource } from "./a2p2-evidence-tender-adapter";
import {
  A2P2_EVIDENCE_COLLECTOR_VERSION,
  type CollectorResult,
  type EvidenceCandidate,
  type EvidenceDiagnostic,
  type EvidenceReasonCode,
  type RejectedEvidence,
  type StructuredSourcesSnapshot,
} from "./a2p2-evidence-types";

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

function rejectRecord(
  reasonCode: EvidenceReasonCode,
  requirementId?: string,
  factKey?: string,
): RejectedEvidence {
  return {
    reasonCode,
    requirementId: safeRejectedIdentifier(requirementId),
    factKey: safeRejectedIdentifier(factKey),
  };
}

function rejectIfUnsafe(
  value: unknown,
  requirementId: string,
  factKey: string,
): RejectedEvidence | null {
  if (scanForbiddenEvidenceFields(value)) {
    return rejectRecord("EVIDENCE_RAW_CONTENT_REJECTED", requirementId, factKey);
  }
  if (containsSecretMaterial(value)) {
    return rejectRecord("EVIDENCE_SECRET_BLOCKED", requirementId, factKey);
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
  if (!sources.tender) {
    return emptyResult("TENDER_ANALYSIS", [
      { code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "tender snapshot missing" },
    ]);
  }
  const adapted = adaptParsedTenderSource(sources.tender);
  const ids = knownRequirementIds(contract);
  const facts: EvidenceCandidate[] = [];
  const rejected: RejectedEvidence[] = [...adapted.rejectedFacts];
  for (const fact of adapted.facts) {
    if (!ids.has(fact.requirementId)) {
      rejected.push(rejectRecord("EVIDENCE_UNKNOWN_REQUIREMENT", fact.requirementId, fact.factKey));
      continue;
    }
    const unsafe = rejectIfUnsafe(fact, fact.requirementId, fact.factKey);
    if (unsafe) {
      rejected.push(unsafe);
      continue;
    }
    facts.push(fact);
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
  _contract: ValidatedTaskContract,
  _sources: StructuredSourcesSnapshot,
): CollectorResult {
  return emptyResult("RESEARCH", [
    { code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "research has no safe canonical source" },
  ]);
}

export function collectEmailDraftEvidence(
  _contract: ValidatedTaskContract,
  _sources: StructuredSourcesSnapshot,
): CollectorResult {
  return emptyResult("EMAIL_DRAFT", [
    { code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "email draft has no safe canonical source" },
  ]);
}

export function collectGenericEvidence(
  contract: ValidatedTaskContract,
  sources: StructuredSourcesSnapshot,
): CollectorResult {
  const snapshot = sources.generic;
  if (!snapshot || !snapshot.facts || snapshot.facts.length === 0) {
    return emptyResult(
      "GENERIC",
      contract.requirements.length === 0
        ? [{ code: "EVIDENCE_GENERIC_NOT_EVALUABLE", detail: "empty generic contract" }]
        : [{ code: "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE", detail: "generic facts missing" }],
    );
  }
  const ids = knownRequirementIds(contract);
  const facts: EvidenceCandidate[] = [];
  const rejected: RejectedEvidence[] = [];
  for (const fact of snapshot.facts) {
    if (!ids.has(fact.requirementId)) {
      rejected.push(rejectRecord("EVIDENCE_UNKNOWN_REQUIREMENT", fact.requirementId, fact.factKey));
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
      sourceType: fact.sourceType ?? "GENERIC_STRUCTURED_FACT",
      sourceId: fact.sourceId,
      locator: fact.locator,
      sourceContentHash: fact.contentHash,
      privacyClass: fact.privacyClass,
      extractorVersion: fact.extractorVersion,
      sourceObservedAt: fact.sourceObservedAt,
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
