/**
 * Shared AnalysisResultV2 fixtures for A2-P2.1 tests.
 */

import {
  CRITICAL_FACT_TYPES,
  TENDER_ANALYSIS_RESULT_VERSION,
  TENDER_UNDERSTANDING_VERSION,
  type AnalysisResultV2,
  type DocumentFactV2,
  type TenderRequirementV2,
} from "../../tender-understanding/contract";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function criticalUnknown(): AnalysisResultV2["criticalFacts"] {
  const slots = {} as AnalysisResultV2["criticalFacts"];
  for (const key of CRITICAL_FACT_TYPES) {
    slots[key] = { status: "UNKNOWN" };
  }
  return slots;
}

export function evidenceRef(
  documentId: string,
  pageNumber: number,
  snippet = "MUST submit by the closing date stated herein",
) {
  return { documentId, pageNumber, snippet };
}

export function closingFact(overrides: Partial<DocumentFactV2> = {}): DocumentFactV2 {
  return {
    id: "fact_closing",
    factType: "closing_datetime",
    claim: "Closing date is 15 September 2026 at 14:00",
    rawValue: "SECRET_RAW_VALUE_MUST_NOT_LEAK",
    normalizedValue: {
      kind: "datetime",
      date: "2026-09-15",
      time: "14:00",
      tz: "ADT",
    },
    confidence: "HIGH",
    evidence: [evidenceRef("doc-1", 3, "SNIPPET_TEXT_MUST_NOT_LEAK")],
    sourceRole: "BASE_TENDER",
    status: "ACTIVE",
    ...overrides,
  };
}

export function mandatoryRequirement(
  overrides: Partial<TenderRequirementV2> = {},
): TenderRequirementV2 {
  return {
    id: overrides.id ?? "req_bond",
    category: overrides.category ?? "BONDING",
    statement: overrides.statement ?? "Bidder must provide a bid bond equal to 10 percent.",
    actor: overrides.actor ?? "Bidder",
    action: overrides.action ?? "provide",
    object: overrides.object ?? "bid bond",
    mandatory: overrides.mandatory ?? true,
    mandatorySignal: overrides.mandatorySignal ?? "must",
    deadline: overrides.deadline ?? null,
    quantity: overrides.quantity ?? "10",
    unit: overrides.unit ?? "percent",
    submissionStage: overrides.submissionStage ?? null,
    technicalArea: overrides.technicalArea ?? null,
    status: overrides.status ?? "ACTIVE",
    supersededById: overrides.supersededById ?? null,
    evidence: overrides.evidence ?? [evidenceRef("doc-1", 8, "SNIPPET_TEXT_MUST_NOT_LEAK")],
    confidence: overrides.confidence ?? "HIGH",
  };
}

export function makeAnalysisResultV2(
  overrides: Partial<AnalysisResultV2> = {},
): AnalysisResultV2 {
  const facts = overrides.facts ?? [closingFact()];
  const requirements = overrides.requirements ?? [mandatoryRequirement()];
  const mandatoryRequirementIds =
    overrides.mandatoryRequirementIds ?? requirements.filter((item) => item.mandatory === true).map((item) => item.id);
  return {
    contractVersion: TENDER_ANALYSIS_RESULT_VERSION,
    manifest: overrides.manifest ?? {
      projectId: "proj_test",
      parseVersion: "tender-understanding-v2-manifest@1",
      documents: [
        {
          documentId: "doc-1",
          name: "ITT.pdf",
          type: "pdf",
          sourceRole: "BASE_TENDER",
          pageCount: 12,
          contentHash: SHA_A,
        },
        {
          documentId: "doc-2",
          name: "Addendum.pdf",
          type: "pdf",
          sourceRole: "ADDENDUM",
          pageCount: 2,
          contentHash: SHA_B,
        },
      ],
    },
    projectSummary: overrides.projectSummary ?? "Municipal supply tender",
    criticalFacts: overrides.criticalFacts ?? {
      ...criticalUnknown(),
      closing_datetime: { status: "KNOWN", factId: facts[0]?.id ?? "fact_closing" },
    },
    facts,
    requirements,
    mandatoryRequirementIds,
    unknowns: overrides.unknowns ?? [],
    risks: overrides.risks ?? [],
    clarifications: overrides.clarifications ?? [],
    resolvedAmbiguities: overrides.resolvedAmbiguities ?? [],
    addendumChanges: overrides.addendumChanges ?? [],
    conflicts: overrides.conflicts ?? [],
    submissionChecklist: overrides.submissionChecklist ?? [],
    evidenceCoverage: overrides.evidenceCoverage ?? {
      factsWithEvidence: facts.length,
      factsTotal: facts.length,
      requirementsWithEvidence: requirements.length,
      requirementsTotal: requirements.length,
    },
    limitations: overrides.limitations ?? [],
    nextActions: overrides.nextActions ?? [],
    metadata: overrides.metadata ?? {
      analyzerVersion: TENDER_UNDERSTANDING_VERSION,
      resultVersion: TENDER_ANALYSIS_RESULT_VERSION,
      projectId: "proj_test",
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
      inputChars: 1000,
      outputChars: 400,
    },
  };
}

export const UPSTREAM_HASH_A = SHA_A;
export const UPSTREAM_HASH_B = SHA_B;
