/**
 * Autopilot A2-P2.3 — fail-closed RecoverySnapshotDelta → TENDER structured source.
 *
 * Projects already-structured facts only. Never reads PDF/HTML/raw bodies.
 * Packet rebuild still happens only via buildEvidencePacket().
 */

import {
  CRITICAL_FACT_TYPES,
  TENDER_ANALYSIS_RESULT_VERSION,
  TENDER_UNDERSTANDING_VERSION,
} from "../tender-understanding/contract";
import { canonicalJson, sha256Hex } from "./a2p2-evidence-hash";
import { parseStructuredSourcesSnapshot } from "./a2p2-evidence-sources";
import { TENDER_FACT_TYPE_TO_REQUIREMENT } from "./a2p2-evidence-tender-adapter";
import type { RecoveryDeltaFact, RecoverySnapshotDelta } from "./a2p2-recovery-types";

const REQUIREMENT_TO_FACT_TYPE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(TENDER_FACT_TYPE_TO_REQUIREMENT).map(([factType, requirementId]) => [
      requirementId,
      factType,
    ]),
  ),
);

const DOC_ID = "doc-1";
const DOC_HASH = "a".repeat(64);

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unknownCriticalFacts(): Record<string, { status: "UNKNOWN" }> {
  const slots: Record<string, { status: "UNKNOWN" }> = {};
  for (const key of CRITICAL_FACT_TYPES) {
    slots[key] = { status: "UNKNOWN" };
  }
  return slots;
}

export function emptyTenderAnalysisResult(): Record<string, unknown> {
  return {
    contractVersion: TENDER_ANALYSIS_RESULT_VERSION,
    manifest: {
      projectId: "proj_recovery",
      parseVersion: "tender-understanding-v2-manifest@1",
      documents: [
        {
          documentId: DOC_ID,
          name: "ITT.pdf",
          type: "pdf",
          sourceRole: "BASE_TENDER",
          pageCount: 12,
          contentHash: DOC_HASH,
        },
      ],
    },
    projectSummary: "recovery structured index",
    criticalFacts: unknownCriticalFacts(),
    facts: [],
    requirements: [],
    mandatoryRequirementIds: [],
    unknowns: [],
    risks: [],
    clarifications: [],
    resolvedAmbiguities: [],
    addendumChanges: [],
    conflicts: [],
    submissionChecklist: [],
    evidenceCoverage: {
      factsWithEvidence: 0,
      factsTotal: 0,
      requirementsWithEvidence: 0,
      requirementsTotal: 0,
    },
    limitations: [],
    nextActions: [],
    metadata: {
      analyzerVersion: TENDER_UNDERSTANDING_VERSION,
      resultVersion: TENDER_ANALYSIS_RESULT_VERSION,
      projectId: "proj_recovery",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      wallTimeMs: 1000,
      llmCalls: 0,
      llmFailures: 0,
      models: [],
      promptUsages: [],
      pages: 12,
      windows: 3,
      rejectedCandidates: [],
      inputChars: 0,
      outputChars: 0,
    },
  };
}

export function cloneStructuredSources(value: unknown): unknown {
  if (value == null) return {};
  return cloneJson(value);
}

export function hashStructuredSources(value: unknown): string {
  const parsed = parseStructuredSourcesSnapshot(value);
  if (!parsed.ok) return sha256Hex(canonicalJson({ invalid: true, raw: value ?? null }));
  return sha256Hex(canonicalJson(parsed.sources));
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

function documentFactFromDelta(fact: RecoveryDeltaFact, index: number): Record<string, unknown> | null {
  const factType = REQUIREMENT_TO_FACT_TYPE[fact.requirementId];
  if (!factType) return null;
  const sourceId = fact.sourceId.length > 0 ? fact.sourceId : DOC_ID;
  const documentId = sourceId === DOC_ID || sourceId.startsWith("doc") ? sourceId : DOC_ID;
  const claim =
    typeof fact.normalizedValue === "string" ? fact.normalizedValue.slice(0, 240) : fact.factKey;
  return {
    id: opaqueFactId(index, fact.factKey),
    factType,
    claim,
    rawValue: null,
    normalizedValue: toNormalizedValue(fact),
    confidence: "HIGH",
    evidence: [{ documentId, pageNumber: 1 }],
    sourceRole: "BASE_TENDER",
    status: "ACTIVE",
  };
}

function mandatoryRequirementFromDelta(
  fact: RecoveryDeltaFact,
  index: number,
): Record<string, unknown> {
  const id = `req_rec_${index}`.slice(0, 80);
  const statement =
    typeof fact.normalizedValue === "string"
      ? fact.normalizedValue.slice(0, 240)
      : "mandatory requirement from structured index";
  return {
    id,
    category: "BONDING",
    statement,
    actor: "Bidder",
    action: "provide",
    object: "bid bond",
    mandatory: true,
    mandatorySignal: "must",
    deadline: null,
    quantity: "10",
    unit: "percent",
    submissionStage: null,
    technicalArea: null,
    status: "ACTIVE",
    supersededById: null,
    evidence: [{ documentId: DOC_ID, pageNumber: 1 }],
    confidence: "HIGH",
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

export type ProjectDeltaResult =
  | { ok: true; structuredSources: unknown; sourceHash: string }
  | { ok: false; reason: "PROJECT_REJECTED" | "NO_PROGRESS" };

export function projectRecoveryDelta(input: {
  currentSources: unknown;
  delta: RecoverySnapshotDelta;
}): ProjectDeltaResult {
  if (
    input.delta.status === "NOT_FOUND" ||
    input.delta.status === "UNCHANGED" ||
    input.delta.status === "REJECTED" ||
    input.delta.externalResearchUsed ||
    input.delta.costUsd !== 0 ||
    input.delta.facts.length === 0
  ) {
    return { ok: false, reason: "NO_PROGRESS" };
  }

  const current = asObject(cloneStructuredSources(input.currentSources));
  const tender = asObject(current.tender ?? emptyTenderAnalysisResult());
  const facts = asArray(tender.facts);
  const requirements = asArray(tender.requirements);
  const mandatoryIds = asArray(tender.mandatoryRequirementIds).filter(
    (item): item is string => typeof item === "string",
  );

  let added = 0;
  for (const [index, fact] of input.delta.facts.entries()) {
    if (fact.requirementId === "mandatory_requirements") {
      const requirement = mandatoryRequirementFromDelta(fact, index);
      requirements.push(requirement);
      mandatoryIds.push(String(requirement.id));
      added += 1;
      continue;
    }
    const documentFact = documentFactFromDelta(fact, index);
    if (!documentFact) continue;
    facts.push(documentFact);
    added += 1;
  }

  if (added === 0) return { ok: false, reason: "NO_PROGRESS" };

  const nextTender = {
    ...emptyTenderAnalysisResult(),
    ...tender,
    facts,
    requirements,
    mandatoryRequirementIds: mandatoryIds,
    evidenceCoverage: {
      factsWithEvidence: facts.length,
      factsTotal: facts.length,
      requirementsWithEvidence: requirements.length,
      requirementsTotal: requirements.length,
    },
    criticalFacts: {
      ...unknownCriticalFacts(),
      ...(asObject(tender.criticalFacts) as Record<string, unknown>),
    },
  };

  const nextSources = { tender: nextTender };
  const parsed = parseStructuredSourcesSnapshot(nextSources);
  if (!parsed.ok) return { ok: false, reason: "PROJECT_REJECTED" };
  return {
    ok: true,
    structuredSources: nextSources,
    sourceHash: hashStructuredSources(nextSources),
  };
}
