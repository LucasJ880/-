/**
 * Autopilot A2-P2.1 — Evidence Builder pipeline.
 *
 * Structured snapshot → privacy gate → EvidenceRef → dedupe → conflict →
 * sufficiency → Semantic Evidence Packet V1.
 *
 * Does not emit semantic task outcomes. Only EvidencePacketStatus.
 * Does not call routeEvaluation, persist packets, or invoke an LLM.
 */

import {
  parseTaskContract,
  type EvaluationRequirement,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import { collectEvidenceForContract } from "./a2p2-evidence-collectors";
import {
  compareDiagnostics,
  compareRejectedEvidence,
  hashEvidencePacket,
  judgeFacingPacketBytes,
  makeCanonicalFactHash,
  makeEvidenceRef,
} from "./a2p2-evidence-hash";
import {
  boundFactString,
  containsSecretMaterial,
  containsUnsafeMarkup,
  isOpaqueSourceId,
  isOpaqueToken,
  redactPiiText,
  sanitizeLocator,
  sanitizeNormalizedValue,
  scanEvidenceValue,
} from "./a2p2-evidence-privacy";
import { parseStructuredSourcesSnapshot } from "./a2p2-evidence-sources";
import { assessPacketStatus, assessRequirementEvidence } from "./a2p2-evidence-sufficiency";
import {
  A2P2_EVIDENCE_BUILDER_VERSION,
  A2P2_EVIDENCE_COLLECTOR_VERSION,
  A2P2_EVIDENCE_PACKET_VERSION,
  MAX_EVIDENCE_FACTS,
  MAX_PACKET_SAFE_TEXT_BYTES,
  type EvidenceCandidate,
  type EvidenceDiagnostic,
  type EvidenceFact,
  type EvidencePacketStatus,
  type RejectedEvidence,
  type RequirementEvidenceAssessment,
  type SemanticEvidencePacketV1,
} from "./a2p2-evidence-types";

export type BuildEvidencePacketInput = {
  contract: unknown;
  structuredSources?: unknown;
  now?: Date;
};

const PRIVACY_REJECT_CODES = new Set([
  "EVIDENCE_SECRET_BLOCKED",
  "EVIDENCE_RAW_CONTENT_REJECTED",
  "EVIDENCE_PROHIBITED_CLASS_BLOCKED",
  "EVIDENCE_PRIVACY_BLOCKED",
]);

function requirementOf(
  contract: ValidatedTaskContract,
  requirementId: string,
): EvaluationRequirement | undefined {
  return contract.requirements.find((item) => item.id === requirementId);
}

function compareFacts(a: EvidenceFact, b: EvidenceFact): number {
  return (
    [
      a.requirementId.localeCompare(b.requirementId),
      a.evidenceKind.localeCompare(b.evidenceKind),
      a.factKey.localeCompare(b.factKey),
      a.source.sourceType.localeCompare(b.source.sourceType),
      a.source.sourceId.localeCompare(b.source.sourceId),
      a.evidenceRef.localeCompare(b.evidenceRef),
    ].find((value) => value !== 0) ?? 0
  );
}

function reject(
  rejected: RejectedEvidence[],
  reasonCode: RejectedEvidence["reasonCode"],
  candidate: Pick<EvidenceCandidate, "requirementId" | "factKey">,
): void {
  rejected.push({
    reasonCode,
    requirementId: candidate.requirementId,
    factKey: candidate.factKey,
  });
}

function acceptCandidate(
  contract: ValidatedTaskContract,
  candidate: EvidenceCandidate,
  createdAt: string,
  rejected: RejectedEvidence[],
): { fact?: EvidenceFact; privacyBlockedRequired: boolean } {
  const requirement = requirementOf(contract, candidate.requirementId);
  if (!requirement) {
    reject(rejected, "EVIDENCE_UNKNOWN_REQUIREMENT", candidate);
    return { privacyBlockedRequired: false };
  }
  const scan = scanEvidenceValue(candidate);
  if (scan.forbiddenField) {
    reject(rejected, "EVIDENCE_RAW_CONTENT_REJECTED", candidate);
    return { privacyBlockedRequired: requirement.required };
  }
  if (scan.secret) {
    reject(rejected, "EVIDENCE_SECRET_BLOCKED", candidate);
    return { privacyBlockedRequired: requirement.required };
  }
  if (candidate.privacyClass === "PROHIBITED") {
    reject(rejected, "EVIDENCE_PROHIBITED_CLASS_BLOCKED", candidate);
    return { privacyBlockedRequired: requirement.required };
  }
  if (containsUnsafeMarkup(candidate.factSummary) || containsUnsafeMarkup(candidate.normalizedValue)) {
    reject(rejected, "EVIDENCE_HTML_REJECTED", candidate);
    return { privacyBlockedRequired: false };
  }
  if (containsSecretMaterial(candidate.sourceId) || containsSecretMaterial(candidate.sourceType)) {
    reject(rejected, "EVIDENCE_SECRET_BLOCKED", candidate);
    return { privacyBlockedRequired: requirement.required };
  }
  if (!isOpaqueSourceId(candidate.sourceId) || !isOpaqueToken(candidate.sourceType) || !isOpaqueToken(candidate.factKey)) {
    reject(rejected, "EVIDENCE_UNSAFE_IDENTIFIER", candidate);
    return { privacyBlockedRequired: false };
  }
  const normalized = sanitizeNormalizedValue(candidate.normalizedValue);
  if (normalized === undefined) {
    reject(rejected, "EVIDENCE_INVALID_VALUE", candidate);
    return { privacyBlockedRequired: false };
  }
  const summary = redactPiiText(boundFactString(candidate.factSummary));
  if (!summary.text) {
    reject(rejected, "EVIDENCE_INVALID_VALUE", candidate);
    return { privacyBlockedRequired: false };
  }
  const locator = sanitizeLocator(candidate.locator);
  if (containsUnsafeMarkup(locator.locator)) {
    reject(rejected, "EVIDENCE_HTML_REJECTED", candidate);
    return { privacyBlockedRequired: false };
  }
  const redactedAnywhere = summary.redacted || normalized.redacted || locator.redacted;
  const canonicalFactHash = makeCanonicalFactHash({
    evidenceKind: candidate.evidenceKind,
    requirementId: candidate.requirementId,
    factKey: candidate.factKey,
    normalizedValue: normalized.value,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
  });
  const evidenceRef = makeEvidenceRef({
    evidenceKind: candidate.evidenceKind,
    requirementId: candidate.requirementId,
    factKey: candidate.factKey,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    canonicalFactHash,
  });
  const sourceContentHash =
    candidate.sourceContentHash && /^[a-f0-9]{64}$/i.test(candidate.sourceContentHash)
      ? candidate.sourceContentHash.toLowerCase()
      : undefined;
  const kindOk = requirement.evidenceKinds.includes(candidate.evidenceKind);
  return {
    privacyBlockedRequired: false,
    fact: {
      evidenceRef,
      evidenceKind: candidate.evidenceKind,
      requirementId: candidate.requirementId,
      factKey: candidate.factKey,
      factSummary: summary.text,
      normalizedValue: normalized.value,
      source: {
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        locator: locator.locator,
      },
      canonicalFactHash,
      privacyClass: redactedAnywhere ? "SENSITIVE" : (candidate.privacyClass ?? "INTERNAL"),
      acceptance: redactedAnywhere ? "REDACTED" : "COLLECTED",
      countsTowardRequirement: kindOk,
      provenance: {
        collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
        extractorVersion: candidate.extractorVersion,
        sourceContentHash,
        sourceObservedAt: candidate.sourceObservedAt,
        createdAt,
      },
    },
  };
}

function emptyPacket(input: {
  taskType: SemanticEvidencePacketV1["taskType"];
  status: EvidencePacketStatus;
  diagnostics: EvidenceDiagnostic[];
  rejectedFacts?: RejectedEvidence[];
}): SemanticEvidencePacketV1 {
  const contract = {
    taskType: input.taskType,
    riskClass: "RESTRICTED",
    automationLevel: "L0",
    requirementCount: 0,
  };
  return finalizePacket({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract,
    taskType: input.taskType,
    requirements: [],
    evidenceFacts: [],
    rejectedFacts: input.rejectedFacts ?? [],
    requirementAssessments: [],
    status: input.status,
    privacySummary: {
      blocked: input.status === "PRIVACY_BLOCKED",
      redactedCount: 0,
      prohibitedCount: (input.rejectedFacts ?? []).filter((item) =>
        PRIVACY_REJECT_CODES.has(item.reasonCode),
      ).length,
    },
    provenanceSummary: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      factCount: 0,
      rejectedCount: (input.rejectedFacts ?? []).length,
    },
    diagnostics: input.diagnostics,
  });
}

function finalizePacket(
  packet: Omit<SemanticEvidencePacketV1, "packetHash"> & { packetHash?: string },
): SemanticEvidencePacketV1 {
  const rejectedFacts = Object.freeze([...packet.rejectedFacts].sort(compareRejectedEvidence));
  const diagnostics = Object.freeze([...packet.diagnostics].sort(compareDiagnostics));
  const evidenceFacts = Object.freeze([...packet.evidenceFacts]);
  const requirementAssessments = Object.freeze([...packet.requirementAssessments]);
  const frozen = {
    ...packet,
    evidenceFacts,
    rejectedFacts,
    requirementAssessments,
    diagnostics,
    requirements: Object.freeze([...packet.requirements]),
  };
  return Object.freeze({
    ...frozen,
    packetHash: hashEvidencePacket(frozen),
  });
}

function overflowAssessments(
  contract: ValidatedTaskContract,
): RequirementEvidenceAssessment[] {
  return contract.requirements.map((requirement) => ({
    requirementId: requirement.id,
    requiredEvidenceRefs: requirement.minimumEvidenceRefs,
    validEvidenceRefs: [],
    state: "NOT_EVALUABLE" as const,
    reasonCode: "EVIDENCE_PACKET_LIMIT_EXCEEDED" as const,
  }));
}

export function buildEvidencePacket(input: BuildEvidencePacketInput): SemanticEvidencePacketV1 {
  const parsed = parseTaskContract(input.contract);
  if (!parsed.ok) {
    return emptyPacket({
      taskType: "GENERIC",
      status: "NOT_EVALUABLE",
      diagnostics: [{ code: "EVIDENCE_UNVALIDATED_CONTRACT" }],
    });
  }
  const contract = parsed.contract;
  const parsedSources = parseStructuredSourcesSnapshot(input.structuredSources);
  if (!parsedSources.ok) {
    return emptyPacket({
      taskType: contract.taskType,
      status: "NOT_EVALUABLE",
      diagnostics: [{ code: "EVIDENCE_INVALID_STRUCTURED_SOURCE" }],
    });
  }
  const createdAt = (input.now ?? new Date(0)).toISOString();
  const collected = collectEvidenceForContract(contract, parsedSources.sources);
  const rejected: RejectedEvidence[] = [...collected.rejectedFacts];
  const diagnostics: EvidenceDiagnostic[] = [...collected.diagnostics];
  let privacyBlockedRequired = rejected.some((item) => {
    if (!PRIVACY_REJECT_CODES.has(item.reasonCode)) return false;
    return requirementOf(contract, item.requirementId ?? "")?.required === true;
  });
  const accepted: EvidenceFact[] = [];
  for (const candidate of collected.facts) {
    const result = acceptCandidate(contract, candidate, createdAt, rejected);
    if (result.privacyBlockedRequired) privacyBlockedRequired = true;
    if (result.fact) accepted.push(result.fact);
  }
  accepted.sort(compareFacts);
  const deduped: EvidenceFact[] = [];
  const seen = new Set<string>();
  for (const fact of accepted) {
    if (seen.has(fact.evidenceRef)) {
      rejected.push({
        reasonCode: "EVIDENCE_DUPLICATE",
        requirementId: fact.requirementId,
        factKey: fact.factKey,
      });
      continue;
    }
    seen.add(fact.evidenceRef);
    deduped.push(fact);
  }
  const countOverflow = deduped.length > MAX_EVIDENCE_FACTS;
  const boundedFacts = countOverflow ? [] : deduped;
  if (countOverflow) {
    diagnostics.push({ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED", detail: "MAX_EVIDENCE_FACTS" });
  }
  const assessed = assessRequirementEvidence(contract, boundedFacts);
  const assessments = countOverflow ? overflowAssessments(contract) : assessed.assessments;
  const perRequirementLimit = assessed.packetLimitExceeded;
  const requirements = contract.requirements.map((item) => ({
    id: item.id,
    required: item.required,
    evidenceKinds: item.evidenceKinds,
    minimumEvidenceRefs: item.minimumEvidenceRefs,
    allowUnknown: item.allowUnknown,
  }));
  const privacySummary = {
    blocked: false,
    redactedCount: boundedFacts.filter((fact) => fact.acceptance === "REDACTED").length,
    prohibitedCount: rejected.filter((item) => PRIVACY_REJECT_CODES.has(item.reasonCode)).length,
  };
  const provenanceSummary = {
    collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
    factCount: boundedFacts.length,
    rejectedCount: rejected.length,
  };
  const byteCount = judgeFacingPacketBytes({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    taskType: contract.taskType,
    contract: {
      taskType: contract.taskType,
      riskClass: contract.riskClass,
      automationLevel: contract.automationLevel,
      requirementCount: contract.requirements.length,
    },
    requirements,
    evidenceFacts: boundedFacts,
    requirementAssessments: assessments,
    status: "INSUFFICIENT",
    rejectedFacts: rejected,
    diagnostics,
    privacySummary,
    provenanceSummary,
  });
  const byteOverflow = byteCount > MAX_PACKET_SAFE_TEXT_BYTES;
  if (byteOverflow) {
    diagnostics.push({ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED", detail: "MAX_PACKET_SAFE_TEXT_BYTES" });
  }
  const overflow = countOverflow || perRequirementLimit || byteOverflow;
  const factsOut = byteOverflow ? [] : boundedFacts;
  const assessmentsOut = overflow ? overflowAssessments(contract) : assessments;
  const status = assessPacketStatus({
    contract,
    assessments: assessmentsOut,
    privacyBlocked: privacyBlockedRequired,
    packetLimitExceeded: overflow,
  });
  privacySummary.blocked = status === "PRIVACY_BLOCKED";
  privacySummary.redactedCount = factsOut.filter((fact) => fact.acceptance === "REDACTED").length;
  provenanceSummary.factCount = factsOut.length;
  return finalizePacket({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract: {
      taskType: contract.taskType,
      riskClass: contract.riskClass,
      automationLevel: contract.automationLevel,
      requirementCount: contract.requirements.length,
    },
    taskType: contract.taskType,
    requirements,
    evidenceFacts: factsOut,
    rejectedFacts: rejected,
    requirementAssessments: assessmentsOut,
    status,
    privacySummary,
    provenanceSummary,
    diagnostics,
  });
}

export function evidencePacketHasSemanticVerdict(packet: SemanticEvidencePacketV1): boolean {
  const json = JSON.stringify(packet);
  const banned = ["TASK_".concat("SUCCESS"), "PARTIAL_".concat("SUCCESS")];
  return banned.some((item) => json.includes(item));
}
