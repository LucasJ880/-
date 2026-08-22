/**
 * Autopilot A2-P2.1 — deterministic EvidenceRef and packetHash.
 *
 * canonicalFactHash is always computed locally from sanitized fields.
 * Upstream hashes may be stored as provenance.sourceContentHash only.
 * packetHash includes stable provenance and excludes provenance.createdAt.
 */

import { createHash } from "node:crypto";
import {
  A2P2_EVIDENCE_PACKET_VERSION,
  type EvidenceDiagnostic,
  type EvidenceFact,
  type RejectedEvidence,
  type RequirementEvidenceAssessment,
} from "./a2p2-evidence-types";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Judge-authoritative contract fingerprint. Does not include raw prompts
 * or goal conversation text. Used by P2.1 packet identity and P2.2 binding.
 */
export function computeSemanticContractHash(input: {
  taskType: string;
  requirements: readonly {
    id: string;
    normalizedDescription: string;
    required: boolean;
    criticality: string;
    allowUnknown: boolean;
    minimumEvidenceRefs: number;
    evidenceKinds: readonly string[];
  }[];
}): string {
  const requirements = [...input.requirements]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      normalizedDescription: item.normalizedDescription,
      required: item.required,
      criticality: item.criticality,
      allowUnknown: item.allowUnknown,
      minimumEvidenceRefs: item.minimumEvidenceRefs,
      evidenceKinds: [...item.evidenceKinds].sort(),
    }));
  return sha256Hex(
    canonicalJson({
      taskType: input.taskType,
      requirements,
    }),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      if (child === undefined) continue;
      out[key] = sortValue(child);
    }
    return out;
  }
  return value;
}

export function makeCanonicalFactHash(input: {
  evidenceKind: string;
  requirementId: string;
  factKey: string;
  normalizedValue: unknown;
  sourceType: string;
  sourceId: string;
}): string {
  return sha256Hex(canonicalJson(input));
}

export function makeEvidenceRef(input: {
  evidenceKind: string;
  requirementId: string;
  factKey: string;
  sourceType: string;
  sourceId: string;
  canonicalFactHash: string;
}): string {
  return sha256Hex(
    canonicalJson({
      version: A2P2_EVIDENCE_PACKET_VERSION,
      evidenceKind: input.evidenceKind,
      requirementId: input.requirementId,
      factKey: input.factKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      canonicalFactHash: input.canonicalFactHash,
    }),
  );
}

export function compareRejectedEvidence(a: RejectedEvidence, b: RejectedEvidence): number {
  return (
    a.reasonCode.localeCompare(b.reasonCode) ||
    (a.requirementId ?? "").localeCompare(b.requirementId ?? "") ||
    (a.factKey ?? "").localeCompare(b.factKey ?? "")
  );
}

export function compareDiagnostics(a: EvidenceDiagnostic, b: EvidenceDiagnostic): number {
  return a.code.localeCompare(b.code) || (a.detail ?? "").localeCompare(b.detail ?? "");
}

export function stableProvenance(fact: EvidenceFact): {
  collectorVersion: string;
  extractorVersion?: string;
  sourceContentHash?: string;
  sourceObservedAt?: string;
} {
  return {
    collectorVersion: fact.provenance.collectorVersion,
    extractorVersion: fact.provenance.extractorVersion,
    sourceContentHash: fact.provenance.sourceContentHash,
    sourceObservedAt: fact.provenance.sourceObservedAt,
  };
}

export function hashEvidencePacket(input: {
  version: string;
  taskType: string;
  contract: unknown;
  requirements: unknown;
  evidenceFacts: readonly EvidenceFact[];
  requirementAssessments: readonly RequirementEvidenceAssessment[];
  status: string;
  rejectedFacts: readonly RejectedEvidence[];
  diagnostics: readonly EvidenceDiagnostic[];
  privacySummary: unknown;
  provenanceSummary: { collectorVersion: string; factCount: number; rejectedCount: number };
}): string {
  const facts = input.evidenceFacts.map((fact) => ({
    evidenceRef: fact.evidenceRef,
    evidenceKind: fact.evidenceKind,
    requirementId: fact.requirementId,
    factKey: fact.factKey,
    factSummary: fact.factSummary,
    normalizedValue: fact.normalizedValue,
    source: fact.source,
    canonicalFactHash: fact.canonicalFactHash,
    privacyClass: fact.privacyClass,
    acceptance: fact.acceptance,
    countsTowardRequirement: fact.countsTowardRequirement,
    provenance: stableProvenance(fact),
  }));
  return sha256Hex(
    canonicalJson({
      version: input.version,
      taskType: input.taskType,
      contract: input.contract,
      requirements: input.requirements,
      evidenceFacts: facts,
      requirementAssessments: input.requirementAssessments,
      status: input.status,
      rejectedFacts: [...input.rejectedFacts].sort(compareRejectedEvidence),
      diagnostics: [...input.diagnostics].sort(compareDiagnostics),
      privacySummary: input.privacySummary,
      provenanceSummary: input.provenanceSummary,
    }),
  );
}

export function judgeFacingPacketBytes(input: {
  version: string;
  taskType: string;
  contract: unknown;
  requirements: unknown;
  evidenceFacts: readonly EvidenceFact[];
  requirementAssessments: readonly RequirementEvidenceAssessment[];
  status: string;
  rejectedFacts: readonly RejectedEvidence[];
  diagnostics: readonly EvidenceDiagnostic[];
  privacySummary: unknown;
  provenanceSummary: unknown;
}): number {
  const facts = input.evidenceFacts.map((fact) => ({
    evidenceRef: fact.evidenceRef,
    evidenceKind: fact.evidenceKind,
    requirementId: fact.requirementId,
    factKey: fact.factKey,
    factSummary: fact.factSummary,
    normalizedValue: fact.normalizedValue,
    source: fact.source,
    canonicalFactHash: fact.canonicalFactHash,
    privacyClass: fact.privacyClass,
    acceptance: fact.acceptance,
    countsTowardRequirement: fact.countsTowardRequirement,
    provenance: stableProvenance(fact),
  }));
  return Buffer.byteLength(
    canonicalJson({
      version: input.version,
      taskType: input.taskType,
      contract: input.contract,
      requirements: input.requirements,
      evidenceFacts: facts,
      requirementAssessments: input.requirementAssessments,
      status: input.status,
      rejectedFacts: input.rejectedFacts,
      diagnostics: input.diagnostics,
      privacySummary: input.privacySummary,
      provenanceSummary: input.provenanceSummary,
    }),
    "utf8",
  );
}
