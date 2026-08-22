/**
 * Autopilot A2-P2.1 — pure AnalysisResultV2 → EvidenceCandidate adapter.
 *
 * Consumes ParsedTenderEvidenceSource only. Drops rawValue, snippets,
 * projectSummary, and other unused AnalysisResultV2 fields at parse time.
 * No DB, file read, LLM, or PDF access.
 */

import {
  TENDER_ANALYSIS_RESULT_VERSION,
  TENDER_UNDERSTANDING_VERSION,
  type NormalizedValueV2,
} from "../tender-understanding/contract";
import { parseTenderEvidenceSource } from "./a2p2-evidence-sources";
import type {
  EvidenceCandidate,
  ParsedTenderEvidenceSource,
  ParsedTenderFact,
  ParsedTenderRequirement,
  RejectedEvidence,
  SafeNormalizedValue,
} from "./a2p2-evidence-types";

export const TENDER_FACT_TYPE_TO_REQUIREMENT: Readonly<Record<string, string>> = {
  closing_datetime: "submission_deadline",
  submission_method: "submission_method",
  pricing_method: "pricing_requirements",
  evaluation_criteria: "evaluation_criteria",
};

export function flattenNormalizedValueV2(
  value: NormalizedValueV2,
): SafeNormalizedValue {
  switch (value.kind) {
    case "date":
      return `date:${value.value}`;
    case "datetime":
      return `datetime:${value.date}T${value.time ?? "00:00"}|${value.tz ?? ""}`;
    case "money":
      return `money:${value.amount}:${value.currency ?? ""}`;
    case "quantity":
      return `quantity:${value.value}:${value.unit ?? ""}`;
    case "duration_days":
      return `duration_days:${value.days}`;
    case "percent":
      return `percent:${value.value}`;
    case "boolean":
      return value.value;
    case "text":
      return value.value;
    default: {
      const _never: never = value;
      return String(_never);
    }
  }
}

function firstEvidence(item: {
  evidence: readonly { documentId: string; pageNumber: number }[];
}): { documentId: string; pageNumber: number } | null {
  const ev = item.evidence[0];
  if (!ev) return null;
  return { documentId: ev.documentId, pageNumber: ev.pageNumber };
}

function manifestHash(
  source: ParsedTenderEvidenceSource,
  documentId: string,
): string | undefined {
  for (const doc of source.manifest.documents) {
    if (doc.documentId === documentId) {
      return doc.contentHash ?? undefined;
    }
  }
  return undefined;
}

function mandatorySummary(req: ParsedTenderRequirement): string {
  const parts = [req.actor, req.action, req.object].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  if (parts.length > 0) return parts.join(" ").slice(0, 500);
  return req.statement.slice(0, 500);
}

function adaptFact(
  fact: ParsedTenderFact,
  source: ParsedTenderEvidenceSource,
): EvidenceCandidate | null {
  if (fact.status !== "ACTIVE") return null;
  const requirementId = TENDER_FACT_TYPE_TO_REQUIREMENT[fact.factType];
  if (!requirementId) return null;
  if (!fact.normalizedValue) return null;
  const evidence = firstEvidence(fact);
  if (!evidence) return null;
  return {
    requirementId,
    evidenceKind: "SOURCE_FACT",
    factKey: fact.factType,
    factSummary: fact.claim.slice(0, 500),
    normalizedValue: flattenNormalizedValueV2(fact.normalizedValue),
    sourceType: "TENDER_DOCUMENT_FACT",
    sourceId: evidence.documentId,
    locator: {
      page: evidence.pageNumber,
      field: fact.factType,
      recordKey: fact.id,
    },
    sourceContentHash: manifestHash(source, evidence.documentId),
    extractorVersion: source.metadata.analyzerVersion ?? TENDER_UNDERSTANDING_VERSION,
  };
}

function adaptMandatory(
  req: ParsedTenderRequirement,
  source: ParsedTenderEvidenceSource,
): EvidenceCandidate | null {
  if (req.status !== "ACTIVE") return null;
  if (req.mandatory !== true) return null;
  const evidence = firstEvidence(req);
  if (!evidence) return null;
  return {
    requirementId: "mandatory_requirements",
    evidenceKind: "SOURCE_FACT",
    factKey: `mandatory:${req.id}`,
    factSummary: mandatorySummary(req),
    normalizedValue: req.id,
    sourceType: "TENDER_REQUIREMENT",
    sourceId: evidence.documentId,
    locator: {
      page: evidence.pageNumber,
      field: req.category,
      recordKey: req.id,
    },
    sourceContentHash: manifestHash(source, evidence.documentId),
    extractorVersion: source.metadata.analyzerVersion ?? TENDER_UNDERSTANDING_VERSION,
  };
}

export function adaptParsedTenderSource(source: ParsedTenderEvidenceSource): {
  facts: EvidenceCandidate[];
  rejectedFacts: RejectedEvidence[];
} {
  const facts: EvidenceCandidate[] = [];
  const rejectedFacts: RejectedEvidence[] = [];
  if (source.contractVersion !== TENDER_ANALYSIS_RESULT_VERSION) {
    return { facts: [], rejectedFacts };
  }
  for (const fact of source.facts) {
    if (fact.status === "CONFLICT") {
      const requirementId = TENDER_FACT_TYPE_TO_REQUIREMENT[fact.factType];
      if (requirementId) {
        rejectedFacts.push({
          reasonCode: "EVIDENCE_STRUCTURAL_CONFLICT",
          requirementId,
          factKey: fact.factType,
        });
      }
      continue;
    }
    const adapted = adaptFact(fact, source);
    if (adapted) facts.push(adapted);
  }
  const byId = new Map(source.requirements.map((item) => [item.id, item]));
  for (const id of source.mandatoryRequirementIds) {
    const req = byId.get(id);
    if (!req) continue;
    const adapted = adaptMandatory(req, source);
    if (adapted) facts.push(adapted);
  }
  return { facts, rejectedFacts };
}

export function adaptAnalysisResultV2(result: unknown): {
  facts: EvidenceCandidate[];
  rejectedFacts: RejectedEvidence[];
} {
  const parsed = parseTenderEvidenceSource(result);
  if (!parsed) return { facts: [], rejectedFacts: [] };
  return adaptParsedTenderSource(parsed);
}
