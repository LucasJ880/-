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
import { hashEvidencePacket, makeContentHash, makeEvidenceRef } from "./a2p2-evidence-hash";
import {
  boundFactString,
  redactPiiText,
  sanitizeLocator,
  sanitizeNormalizedValue,
  scanEvidenceValue,
} from "./a2p2-evidence-privacy";
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
  type SemanticEvidencePacketV1,
  type StructuredSourcesSnapshot,
} from "./a2p2-evidence-types";

export type BuildEvidencePacketInput = {
  contract: unknown;
  structuredSources?: StructuredSourcesSnapshot;
  now?: Date;
};

function requirementOf(
  contract: ValidatedTaskContract,
  requirementId: string,
): EvaluationRequirement | undefined {
  return contract.requirements.find((item) => item.id === requirementId);
}

function compareFacts(a: EvidenceFact, b: EvidenceFact): number {
  return [
    a.requirementId.localeCompare(b.requirementId),
    a.evidenceKind.localeCompare(b.evidenceKind),
    a.factKey.localeCompare(b.factKey),
    a.source.sourceType.localeCompare(b.source.sourceType),
    a.source.sourceId.localeCompare(b.source.sourceId),
    a.evidenceRef.localeCompare(b.evidenceRef),
  ].find((value) => value !== 0) ?? 0;
}

function acceptCandidate(
  contract: ValidatedTaskContract,
  candidate: EvidenceCandidate,
  createdAt: string,
  rejected: RejectedEvidence[],
): { fact?: EvidenceFact; privacyBlockedRequired: boolean } {
  const requirement = requirementOf(contract, candidate.requirementId);
  if (!requirement) {
    rejected.push({
      reasonCode: "EVIDENCE_UNKNOWN_REQUIREMENT",
      requirementId: candidate.requirementId,
      factKey: candidate.factKey,
    });
    return { privacyBlockedRequired: false };
  }
  const scan = scanEvidenceValue(candidate);
  if (scan.forbiddenField) {
    rejected.push({
      reasonCode: "EVIDENCE_RAW_CONTENT_REJECTED",
      requirementId: candidate.requirementId,
      factKey: candidate.factKey,
    });
    return { privacyBlockedRequired: requirement.required };
  }
  if (scan.secret) {
    rejected.push({
      reasonCode: "EVIDENCE_SECRET_BLOCKED",
      requirementId: candidate.requirementId,
      factKey: candidate.factKey,
    });
    return { privacyBlockedRequired: requirement.required };
  }
  const normalized = sanitizeNormalizedValue(candidate.normalizedValue);
  if (normalized === undefined) {
    rejected.push({
      reasonCode: "EVIDENCE_INVALID_VALUE",
      requirementId: candidate.requirementId,
      factKey: candidate.factKey,
    });
    return { privacyBlockedRequired: false };
  }
  const summaryRaw = boundFactString(candidate.factSummary);
  const summary = redactPiiText(summaryRaw);
  const sourceId = boundFactString(candidate.sourceId);
  const sourceType = boundFactString(candidate.sourceType);
  const factKey = boundFactString(candidate.factKey);
  if (!summaryRaw || !sourceId || !sourceType || !factKey) {
    rejected.push({
      reasonCode: "EVIDENCE_INVALID_VALUE",
      requirementId: candidate.requirementId,
      factKey: candidate.factKey,
    });
    return { privacyBlockedRequired: false };
  }
  const contentHash =
    candidate.contentHash && /^[a-f0-9]{64}$/i.test(candidate.contentHash)
      ? candidate.contentHash.toLowerCase()
      : makeContentHash({
          evidenceKind: candidate.evidenceKind,
          requirementId: candidate.requirementId,
          factKey,
          normalizedValue: normalized,
          sourceId,
        });
  const evidenceRef = makeEvidenceRef({
    evidenceKind: candidate.evidenceKind,
    requirementId: candidate.requirementId,
    factKey,
    sourceType,
    sourceId,
    contentHash,
  });
  const kindOk = requirement.evidenceKinds.includes(candidate.evidenceKind);
  const privacyClass = summary.redacted ? "SENSITIVE" : (candidate.privacyClass ?? "INTERNAL");
  return {
    privacyBlockedRequired: false,
    fact: {
      evidenceRef,
      evidenceKind: candidate.evidenceKind,
      requirementId: candidate.requirementId,
      factKey,
      factSummary: summary.text,
      normalizedValue: normalized,
      source: {
        sourceType,
        sourceId,
        locator: sanitizeLocator(candidate.locator),
      },
      contentHash,
      privacyClass,
      acceptance: summary.redacted ? "REDACTED" : "COLLECTED",
      countsTowardRequirement: kindOk,
      provenance: {
        collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
        extractorVersion: candidate.extractorVersion,
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
  const packet: SemanticEvidencePacketV1 = {
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract,
    taskType: input.taskType,
    requirements: [],
    evidenceFacts: [],
    rejectedFacts: input.rejectedFacts ?? [],
    requirementAssessments: [],
    status: input.status,
    privacySummary: { blocked: input.status === "PRIVACY_BLOCKED", redactedCount: 0, prohibitedCount: 0 },
    provenanceSummary: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      factCount: 0,
      rejectedCount: (input.rejectedFacts ?? []).length,
    },
    diagnostics: input.diagnostics,
    packetHash: "",
  };
  return finalizePacket(packet);
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function finalizePacket(packet: Omit<SemanticEvidencePacketV1, "packetHash"> & { packetHash?: string }): SemanticEvidencePacketV1 {
  const packetHash = hashEvidencePacket(packet);
  return Object.freeze({
    ...packet,
    packetHash,
    evidenceFacts: Object.freeze([...packet.evidenceFacts]),
    rejectedFacts: Object.freeze([...packet.rejectedFacts]),
    requirementAssessments: Object.freeze([...packet.requirementAssessments]),
    diagnostics: Object.freeze([...packet.diagnostics]),
    requirements: Object.freeze([...packet.requirements]),
  });
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
  const createdAt = (input.now ?? new Date(0)).toISOString();
  const sources = input.structuredSources ?? {};
  const collected = collectEvidenceForContract(contract, sources);
  const rejected: RejectedEvidence[] = [...collected.rejectedFacts];
  const diagnostics: EvidenceDiagnostic[] = [...collected.diagnostics];
  let privacyBlockedRequired = rejected.some((item) => {
    if (
      item.reasonCode !== "EVIDENCE_SECRET_BLOCKED" &&
      item.reasonCode !== "EVIDENCE_RAW_CONTENT_REJECTED" &&
      item.reasonCode !== "EVIDENCE_PRIVACY_BLOCKED"
    ) {
      return false;
    }
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
  const packetLimitExceeded = deduped.length > MAX_EVIDENCE_FACTS;
  const boundedFacts = packetLimitExceeded ? deduped.slice(0, MAX_EVIDENCE_FACTS) : deduped;
  if (packetLimitExceeded) {
    diagnostics.push({ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED", detail: "MAX_EVIDENCE_FACTS" });
  }
  const { assessments, packetLimitExceeded: perRequirementLimit } = assessRequirementEvidence(
    contract,
    boundedFacts,
  );
  const overflow = packetLimitExceeded || perRequirementLimit;
  const textBytes = utf8Bytes(JSON.stringify(boundedFacts.map((fact) => fact.factSummary)));
  const byteOverflow = textBytes > MAX_PACKET_SAFE_TEXT_BYTES;
  if (byteOverflow) {
    diagnostics.push({ code: "EVIDENCE_PACKET_LIMIT_EXCEEDED", detail: "MAX_PACKET_SAFE_TEXT_BYTES" });
  }
  const status = assessPacketStatus({
    contract,
    assessments,
    privacyBlocked: privacyBlockedRequired,
    packetLimitExceeded: overflow || byteOverflow,
  });
  const redactedCount = boundedFacts.filter((fact) => fact.acceptance === "REDACTED").length;
  const requirements = contract.requirements.map((item) => ({
    id: item.id,
    required: item.required,
    evidenceKinds: item.evidenceKinds,
    minimumEvidenceRefs: item.minimumEvidenceRefs,
    allowUnknown: item.allowUnknown,
  }));
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
    evidenceFacts: boundedFacts,
    rejectedFacts: rejected,
    requirementAssessments: assessments,
    status,
    privacySummary: {
      blocked: status === "PRIVACY_BLOCKED",
      redactedCount,
      prohibitedCount: rejected.filter((item) => item.reasonCode === "EVIDENCE_SECRET_BLOCKED").length,
    },
    provenanceSummary: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      factCount: boundedFacts.length,
      rejectedCount: rejected.length,
    },
    diagnostics,
  });
}

export function evidencePacketHasSemanticVerdict(packet: SemanticEvidencePacketV1): boolean {
  const json = JSON.stringify(packet);
  const banned = ["TASK_".concat("SUCCESS"), "PARTIAL_".concat("SUCCESS")];
  return banned.some((item) => json.includes(item));
}
