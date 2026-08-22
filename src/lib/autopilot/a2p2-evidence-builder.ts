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
  computeSemanticContractHash,
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
  safeExtractorVersion,
  safeRejectedIdentifier,
  safeSourceObservedAt,
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
  MAX_DIAGNOSTIC_DETAIL,
  MAX_EMITTED_REJECTED_FACTS,
  MAX_EVIDENCE_FACTS,
  MAX_OVERFLOW_DIAGNOSTICS,
  MAX_PACKET_SAFE_TEXT_BYTES,
  isPrivacyRejectCode,
  type EvidenceCandidate,
  type EvidenceDiagnostic,
  type EvidenceFact,
  type EvidencePacketStatus,
  type RejectedEvidence,
  type RequirementEvidenceAssessment,
  type SafeContractMetadata,
  type SemanticEvidencePacketV1,
} from "./a2p2-evidence-types";

export type BuildEvidencePacketInput = {
  contract: unknown;
  structuredSources?: unknown;
  now?: Date;
};

const CANONICAL_DIAGNOSTIC_DETAILS = new Set([
  "MAX_EVIDENCE_FACTS",
  "MAX_PACKET_SAFE_TEXT_BYTES",
  "MAX_FACTS_PER_REQUIREMENT",
  "MAX_EMITTED_REJECTED_FACTS",
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
    requirementId: safeRejectedIdentifier(candidate.requirementId),
    factKey: safeRejectedIdentifier(candidate.factKey),
  });
}

function sanitizeRejected(items: readonly RejectedEvidence[]): RejectedEvidence[] {
  return items.map((item) => ({
    reasonCode: item.reasonCode,
    requirementId: safeRejectedIdentifier(item.requirementId),
    factKey: safeRejectedIdentifier(item.factKey),
  }));
}

function sanitizeDiagnostics(items: readonly EvidenceDiagnostic[]): EvidenceDiagnostic[] {
  return items.map((item) => {
    if (!item.detail) return { code: item.code };
    if (CANONICAL_DIAGNOSTIC_DETAILS.has(item.detail)) {
      return { code: item.code, detail: item.detail };
    }
    if (isOpaqueToken(item.detail) && item.detail.length <= MAX_DIAGNOSTIC_DETAIL) {
      return { code: item.code, detail: item.detail };
    }
    return { code: item.code };
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
  const extractorVersion = safeExtractorVersion(candidate.extractorVersion);
  if (candidate.extractorVersion !== undefined && extractorVersion === undefined) {
    reject(rejected, "EVIDENCE_UNSAFE_IDENTIFIER", candidate);
    return { privacyBlockedRequired: false };
  }
  const sourceObservedAt = safeSourceObservedAt(candidate.sourceObservedAt);
  if (candidate.sourceObservedAt !== undefined && sourceObservedAt === undefined) {
    reject(rejected, "EVIDENCE_INVALID_VALUE", candidate);
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
        extractorVersion,
        sourceContentHash,
        sourceObservedAt,
        createdAt,
      },
    },
  };
}

function contractMetadataOf(contract: ValidatedTaskContract): SafeContractMetadata {
  return {
    taskType: contract.taskType,
    riskClass: contract.riskClass,
    automationLevel: contract.automationLevel,
    requirementCount: contract.requirements.length,
    semanticContractHash: computeSemanticContractHash(contract),
  };
}

function emptyContractMetadata(
  taskType: SemanticEvidencePacketV1["taskType"],
): SafeContractMetadata {
  return {
    taskType,
    riskClass: "RESTRICTED",
    automationLevel: "L0",
    requirementCount: 0,
    semanticContractHash: computeSemanticContractHash({
      taskType,
      requirements: [],
    }),
  };
}

function emptyPacket(input: {
  taskType: SemanticEvidencePacketV1["taskType"];
  status: EvidencePacketStatus;
  diagnostics: EvidenceDiagnostic[];
  rejectedFacts?: RejectedEvidence[];
}): SemanticEvidencePacketV1 {
  const packet = finalizePacket({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract: emptyContractMetadata(input.taskType),
    taskType: input.taskType,
    requirements: [],
    evidenceFacts: [],
    rejectedFacts: sanitizeRejected(input.rejectedFacts ?? []),
    requirementAssessments: [],
    status: input.status,
    privacySummary: {
      blocked: input.status === "PRIVACY_BLOCKED",
      redactedCount: 0,
      prohibitedCount: (input.rejectedFacts ?? []).filter((item) =>
        isPrivacyRejectCode(item.reasonCode),
      ).length,
    },
    provenanceSummary: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      factCount: 0,
      rejectedCount: (input.rejectedFacts ?? []).length,
    },
    diagnostics: sanitizeDiagnostics(input.diagnostics),
  });
  return enforceFinalByteBound(packet, {
    taskType: input.taskType,
    status: input.status,
    privacyBlocked: input.status === "PRIVACY_BLOCKED",
    rejectedCount: (input.rejectedFacts ?? []).length,
    prohibitedCount: packet.privacySummary.prohibitedCount,
    assessments: [],
    requirements: [],
    contractMeta: packet.contract,
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

function lastResortPacket(input: {
  taskType: SemanticEvidencePacketV1["taskType"];
  privacyBlocked: boolean;
  rejectedCount: number;
  prohibitedCount: number;
}): SemanticEvidencePacketV1 {
  const status: EvidencePacketStatus = input.privacyBlocked ? "PRIVACY_BLOCKED" : "NOT_EVALUABLE";
  const diagnostics: EvidenceDiagnostic[] = [{ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED" }];
  if (input.privacyBlocked) diagnostics.push({ code: "EVIDENCE_PRIVACY_BLOCKED" });
  return finalizePacket({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract: emptyContractMetadata(input.taskType),
    taskType: input.taskType,
    requirements: [],
    evidenceFacts: [],
    rejectedFacts: [],
    requirementAssessments: [],
    status,
    privacySummary: {
      blocked: input.privacyBlocked,
      redactedCount: 0,
      prohibitedCount: input.prohibitedCount,
    },
    provenanceSummary: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      factCount: 0,
      rejectedCount: input.rejectedCount,
    },
    diagnostics: diagnostics.slice(0, MAX_OVERFLOW_DIAGNOSTICS),
  });
}

function minimalOverflowPacket(input: {
  taskType: SemanticEvidencePacketV1["taskType"];
  contractMeta: SemanticEvidencePacketV1["contract"];
  requirements: SemanticEvidencePacketV1["requirements"];
  assessments: readonly RequirementEvidenceAssessment[];
  privacyBlocked: boolean;
  rejectedCount: number;
  prohibitedCount: number;
}): SemanticEvidencePacketV1 {
  const status: EvidencePacketStatus = input.privacyBlocked ? "PRIVACY_BLOCKED" : "NOT_EVALUABLE";
  const diagnostics: EvidenceDiagnostic[] = [{ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED" }];
  if (input.privacyBlocked) diagnostics.push({ code: "EVIDENCE_PRIVACY_BLOCKED" });
  return finalizePacket({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract: input.contractMeta,
    taskType: input.taskType,
    requirements: input.requirements,
    evidenceFacts: [],
    rejectedFacts: [],
    requirementAssessments: input.assessments,
    status,
    privacySummary: {
      blocked: input.privacyBlocked,
      redactedCount: 0,
      prohibitedCount: input.prohibitedCount,
    },
    provenanceSummary: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      factCount: 0,
      rejectedCount: input.rejectedCount,
    },
    diagnostics: diagnostics.slice(0, MAX_OVERFLOW_DIAGNOSTICS),
  });
}

function enforceFinalByteBound(
  packet: SemanticEvidencePacketV1,
  overflow: {
    taskType: SemanticEvidencePacketV1["taskType"];
    status: EvidencePacketStatus;
    privacyBlocked: boolean;
    rejectedCount: number;
    prohibitedCount: number;
    assessments: readonly RequirementEvidenceAssessment[];
    requirements: SemanticEvidencePacketV1["requirements"];
    contractMeta: SemanticEvidencePacketV1["contract"];
  },
): SemanticEvidencePacketV1 {
  if (judgeFacingPacketBytes(packet) <= MAX_PACKET_SAFE_TEXT_BYTES) return packet;
  const minimal = minimalOverflowPacket({
    taskType: overflow.taskType,
    contractMeta: overflow.contractMeta,
    requirements: overflow.requirements,
    assessments: overflow.assessments,
    privacyBlocked: overflow.privacyBlocked || overflow.status === "PRIVACY_BLOCKED",
    rejectedCount: overflow.rejectedCount,
    prohibitedCount: overflow.prohibitedCount,
  });
  if (judgeFacingPacketBytes(minimal) <= MAX_PACKET_SAFE_TEXT_BYTES) return minimal;
  return lastResortPacket({
    taskType: overflow.taskType,
    privacyBlocked: overflow.privacyBlocked || overflow.status === "PRIVACY_BLOCKED",
    rejectedCount: overflow.rejectedCount,
    prohibitedCount: overflow.prohibitedCount,
  });
}

function buildEvidencePacketInner(input: BuildEvidencePacketInput): SemanticEvidencePacketV1 {
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
  const rejected: RejectedEvidence[] = sanitizeRejected(collected.rejectedFacts);
  const diagnostics: EvidenceDiagnostic[] = sanitizeDiagnostics(collected.diagnostics);
  let privacyBlockedRequired = rejected.some((item) => {
    if (!isPrivacyRejectCode(item.reasonCode)) return false;
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
      reject(rejected, "EVIDENCE_DUPLICATE", fact);
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
  const perRequirementLimit = assessed.packetLimitExceeded;
  if (perRequirementLimit) {
    diagnostics.push({ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED", detail: "MAX_FACTS_PER_REQUIREMENT" });
  }
  const rejectedOverflow = rejected.length > MAX_EMITTED_REJECTED_FACTS;
  if (rejectedOverflow) {
    diagnostics.push({ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED", detail: "MAX_EMITTED_REJECTED_FACTS" });
  }
  const requirements = contract.requirements.map((item) => ({
    id: item.id,
    required: item.required,
    evidenceKinds: item.evidenceKinds,
    minimumEvidenceRefs: item.minimumEvidenceRefs,
    allowUnknown: item.allowUnknown,
  }));
  const contractMeta = contractMetadataOf(contract);
  const assessments = perRequirementLimit || countOverflow
    ? overflowAssessments(contract)
    : assessed.assessments;
  const privacySummary = {
    blocked: false,
    redactedCount: boundedFacts.filter((fact) => fact.acceptance === "REDACTED").length,
    prohibitedCount: rejected.filter((item) => isPrivacyRejectCode(item.reasonCode)).length,
  };
  const provenanceSummary = {
    collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
    factCount: boundedFacts.length,
    rejectedCount: rejected.length,
  };
  const preBytes = judgeFacingPacketBytes({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    taskType: contract.taskType,
    contract: contractMeta,
    requirements,
    evidenceFacts: boundedFacts,
    requirementAssessments: assessments,
    status: "INSUFFICIENT",
    rejectedFacts: rejectedOverflow ? [] : rejected,
    diagnostics,
    privacySummary,
    provenanceSummary,
  });
  const byteOverflow = preBytes > MAX_PACKET_SAFE_TEXT_BYTES;
  if (byteOverflow) {
    diagnostics.push({ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED", detail: "MAX_PACKET_SAFE_TEXT_BYTES" });
  }
  const hardOverflow = countOverflow || byteOverflow || rejectedOverflow;
  const overflow = hardOverflow || perRequirementLimit;
  const factsOut = hardOverflow ? [] : boundedFacts;
  const rejectedOut = hardOverflow ? [] : sanitizeRejected(rejected);
  const assessmentsOut = overflow ? overflowAssessments(contract) : assessments;
  const boundedDiagnostics = sanitizeDiagnostics(diagnostics).slice(
    0,
    hardOverflow ? MAX_OVERFLOW_DIAGNOSTICS : diagnostics.length,
  );
  const status = assessPacketStatus({
    contract,
    assessments: assessmentsOut,
    privacyBlocked: privacyBlockedRequired,
    packetLimitExceeded: overflow,
  });
  privacySummary.blocked = status === "PRIVACY_BLOCKED";
  privacySummary.redactedCount = factsOut.filter((fact) => fact.acceptance === "REDACTED").length;
  provenanceSummary.factCount = factsOut.length;
  provenanceSummary.rejectedCount = rejected.length;
  const packet = finalizePacket({
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract: contractMeta,
    taskType: contract.taskType,
    requirements,
    evidenceFacts: factsOut,
    rejectedFacts: rejectedOut,
    requirementAssessments: assessmentsOut,
    status,
    privacySummary,
    provenanceSummary,
    diagnostics: boundedDiagnostics,
  });
  return enforceFinalByteBound(packet, {
    taskType: contract.taskType,
    status,
    privacyBlocked: privacyBlockedRequired,
    rejectedCount: rejected.length,
    prohibitedCount: privacySummary.prohibitedCount,
    assessments: assessmentsOut,
    requirements,
    contractMeta,
  });
}

export function buildEvidencePacket(input: BuildEvidencePacketInput): SemanticEvidencePacketV1 {
  try {
    return buildEvidencePacketInner(input);
  } catch {
    return emptyPacket({
      taskType: "GENERIC",
      status: "NOT_EVALUABLE",
      diagnostics: [{ code: "EVIDENCE_INVALID_STRUCTURED_SOURCE" }],
    });
  }
}

export function evidencePacketHasSemanticVerdict(packet: SemanticEvidencePacketV1): boolean {
  const json = JSON.stringify(packet);
  const banned = ["TASK_".concat("SUCCESS"), "PARTIAL_".concat("SUCCESS")];
  return banned.some((item) => json.includes(item));
}
