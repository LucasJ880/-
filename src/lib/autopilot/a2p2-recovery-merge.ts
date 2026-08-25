/**
 * Autopilot A2-P2.3 — fail-closed RecoverySnapshotDelta → existing TENDER source.
 *
 * Projects already-structured facts onto real canonical Tender provenance.
 * Never invents documents, locators, confidence, or mandatory semantics.
 * Packet rebuild still happens only via buildEvidencePacket().
 */

import { canonicalJson, sha256Hex } from "./a2p2-evidence-hash";
import { parseStructuredSourcesSnapshot } from "./a2p2-evidence-sources";
import {
  P2_3_TENDER_RECOVERY_EVIDENCE_KIND,
  TENDER_V1_REQUIREMENT_FACT_KEYS,
  TENDER_V1_UNSUPPORTED_RECOVERY_REQUIREMENTS,
  bindRecoveryDeltaToPlan,
  type RecoveryDeltaFact,
  type RecoveryPlanBinding,
  type RecoverySnapshotDelta,
} from "./a2p2-recovery-types";

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function jsonCloneSafe(value: unknown): unknown | undefined {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}

export function cloneStructuredSources(value: unknown): unknown {
  const parsed = parseStructuredSourcesSnapshot(value);
  if (!parsed.ok) return {};
  const cloned = jsonCloneSafe(value);
  return cloned === undefined ? {} : cloned;
}

export function hashStructuredSources(value: unknown): string {
  const parsed = parseStructuredSourcesSnapshot(value);
  if (!parsed.ok) return sha256Hex(canonicalJson({ invalid: true }));
  try {
    return sha256Hex(canonicalJson(parsed.sources));
  } catch {
    return sha256Hex(canonicalJson({ invalid: true }));
  }
}

function toNormalizedValue(fact: RecoveryDeltaFact): Record<string, unknown> {
  const raw = fact.normalizedValue;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { kind: "date", value: raw };
  }
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return {
      kind: "datetime",
      date: raw.slice(0, 10),
      time: raw.slice(11, 16) || null,
      tz: null,
    };
  }
  if (typeof raw === "boolean") return { kind: "boolean", value: raw };
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { kind: "quantity", value: raw, unit: null };
  }
  const text = Array.isArray(raw) ? raw.map(String).join(",") : raw == null ? "" : String(raw);
  return { kind: "text", value: text.slice(0, 500) };
}

function opaqueFactId(index: number, factKey: string): string {
  const cleaned = factKey.replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
  return `fact_rec_${index}_${cleaned}`.slice(0, 80);
}

type ExistingDocument = {
  documentId: string;
  contentHash: string;
};

function existingDocuments(parsedTender: {
  manifest: { documents: readonly { documentId: string; contentHash: string | null }[] };
}): ExistingDocument[] {
  const out: ExistingDocument[] = [];
  for (const doc of parsedTender.manifest.documents) {
    if (typeof doc.documentId !== "string" || doc.documentId.length < 1) continue;
    if (typeof doc.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(doc.contentHash)) continue;
    out.push({ documentId: doc.documentId, contentHash: doc.contentHash });
  }
  return out;
}

function documentFactFromDelta(
  fact: RecoveryDeltaFact,
  index: number,
  documents: readonly ExistingDocument[],
): Record<string, unknown> | null {
  if (
    (TENDER_V1_UNSUPPORTED_RECOVERY_REQUIREMENTS as readonly string[]).includes(fact.requirementId)
  ) {
    return null;
  }
  const factType = TENDER_V1_REQUIREMENT_FACT_KEYS[fact.requirementId];
  if (!factType || fact.factKey !== factType) return null;
  if (fact.evidenceKind !== P2_3_TENDER_RECOVERY_EVIDENCE_KIND) return null;
  const document = documents.find(
    (item) => item.documentId === fact.sourceId && item.contentHash === fact.contentHash,
  );
  if (!document) return null;
  const claim =
    typeof fact.normalizedValue === "string" ? fact.normalizedValue.slice(0, 240) : fact.factKey;
  return {
    id: opaqueFactId(index, fact.factKey),
    factType,
    claim,
    rawValue: null,
    normalizedValue: toNormalizedValue(fact),
    evidence: [{ documentId: document.documentId, pageNumber: fact.pageNumber }],
    status: "ACTIVE",
  };
}

export type ProjectDeltaResult =
  | { ok: true; structuredSources: unknown; sourceHash: string }
  | { ok: false; reason: "PROJECT_REJECTED" | "NO_PROGRESS" };

export function projectRecoveryDelta(input: {
  currentSources: unknown;
  delta: RecoverySnapshotDelta;
  plan?: RecoveryPlanBinding;
}): ProjectDeltaResult {
  if (input.plan) {
    const bound = bindRecoveryDeltaToPlan({ delta: input.delta, plan: input.plan });
    if (!bound.ok) return { ok: false, reason: "PROJECT_REJECTED" };
  }
  if (
    input.delta.status === "NOT_FOUND" ||
    input.delta.status === "UNCHANGED" ||
    input.delta.status === "REJECTED" ||
    input.delta.externalResearchUsed ||
    input.delta.costUsd !== 0
  ) {
    return { ok: false, reason: "NO_PROGRESS" };
  }
  if (input.delta.status !== "FOUND" || input.delta.facts.length === 0) {
    return { ok: false, reason: "NO_PROGRESS" };
  }

  const parsed = parseStructuredSourcesSnapshot(input.currentSources);
  if (!parsed.ok || !parsed.sources.tender) {
    return { ok: false, reason: "PROJECT_REJECTED" };
  }
  const documents = existingDocuments(parsed.sources.tender);
  if (documents.length === 0) {
    return { ok: false, reason: "PROJECT_REJECTED" };
  }

  const cloned = jsonCloneSafe(input.currentSources);
  if (cloned === undefined) return { ok: false, reason: "PROJECT_REJECTED" };
  const current = asObject(cloned);
  if (!current) return { ok: false, reason: "PROJECT_REJECTED" };
  const tender = asObject(current.tender);
  if (!tender) return { ok: false, reason: "PROJECT_REJECTED" };

  const facts = asArray(tender.facts);
  let added = 0;
  for (const [index, fact] of input.delta.facts.entries()) {
    const documentFact = documentFactFromDelta(fact, index, documents);
    if (!documentFact) return { ok: false, reason: "PROJECT_REJECTED" };
    facts.push(documentFact);
    added += 1;
  }
  if (added === 0) return { ok: false, reason: "NO_PROGRESS" };

  const nextTender = {
    ...tender,
    facts,
  };
  const nextSources = {
    ...current,
    tender: nextTender,
  };
  const reparsed = parseStructuredSourcesSnapshot(nextSources);
  if (!reparsed.ok) return { ok: false, reason: "PROJECT_REJECTED" };
  return {
    ok: true,
    structuredSources: nextSources,
    sourceHash: hashStructuredSources(nextSources),
  };
}
