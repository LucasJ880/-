/**
 * Autopilot A2-P2.1 — pure AnalysisResultV2 → EvidenceCandidate adapter.
 *
 * Canonical tender source. Drops rawValue, evidence snippets, and document text.
 * No DB, file read, LLM, or PDF access.
 */

import {
  TENDER_ANALYSIS_RESULT_VERSION,
  TENDER_UNDERSTANDING_VERSION,
  type AnalysisResultV2,
  type DocumentFactV2,
  type NormalizedValueV2,
  type TenderRequirementV2,
} from "../tender-understanding/contract";
import type { EvidenceCandidate, RejectedEvidence, SafeNormalizedValue } from "./a2p2-evidence-types";

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

function firstEvidence(item: { evidence: { documentId: string; pageNumber: number }[] }): {
  documentId: string;
  pageNumber: number;
} | null {
  const ev = item.evidence[0];
  if (!ev || typeof ev.documentId !== "string" || typeof ev.pageNumber !== "number") {
    return null;
  }
  return { documentId: ev.documentId, pageNumber: ev.pageNumber };
}

function manifestHash(
  result: AnalysisResultV2,
  documentId: string,
): string | undefined {
  const hash = result.manifest?.documents?.find((doc) => doc.documentId === documentId)
    ?.contentHash;
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : undefined;
}

function mandatorySummary(req: TenderRequirementV2): string {
  const parts = [req.actor, req.action, req.object].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  if (parts.length > 0) return parts.join(" ").slice(0, 500);
  return req.statement.slice(0, 500);
}

function adaptFact(
  fact: DocumentFactV2,
  result: AnalysisResultV2,
): EvidenceCandidate | null {
  if (fact.status === "SUPERSEDED") return null;
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
    sourceContentHash: manifestHash(result, evidence.documentId),
    extractorVersion: result.metadata?.analyzerVersion ?? TENDER_UNDERSTANDING_VERSION,
  };
}

function adaptMandatory(
  req: TenderRequirementV2,
  result: AnalysisResultV2,
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
    sourceContentHash: manifestHash(result, evidence.documentId),
    extractorVersion: result.metadata?.analyzerVersion ?? TENDER_UNDERSTANDING_VERSION,
  };
}

export function adaptAnalysisResultV2(result: AnalysisResultV2): {
  facts: EvidenceCandidate[];
  rejectedFacts: RejectedEvidence[];
} {
  const facts: EvidenceCandidate[] = [];
  const rejectedFacts: RejectedEvidence[] = [];
  if (result.contractVersion !== TENDER_ANALYSIS_RESULT_VERSION) {
    return { facts: [], rejectedFacts };
  }
  for (const fact of result.facts) {
    const adapted = adaptFact(fact, result);
    if (adapted) facts.push(adapted);
  }
  const byId = new Map(result.requirements.map((item) => [item.id, item]));
  for (const id of result.mandatoryRequirementIds) {
    const req = byId.get(id);
    if (!req) continue;
    const adapted = adaptMandatory(req, result);
    if (adapted) facts.push(adapted);
  }
  return { facts, rejectedFacts };
}
