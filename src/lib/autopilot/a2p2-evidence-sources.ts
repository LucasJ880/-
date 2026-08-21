/**
 * Autopilot A2-P2.1 — runtime structured-source parser.
 *
 * TypeScript types are not authority. Unknown JSON fails closed.
 * Never throws.
 */

import {
  EVALUATION_EVIDENCE_KINDS,
  EVALUATION_PRIVACY_CLASSES,
  type EvaluationEvidenceKind,
  type EvaluationPrivacyClass,
} from "./a2p2-contract";
import {
  TENDER_ANALYSIS_RESULT_VERSION,
} from "../tender-understanding/contract";
import { scanForbiddenEvidenceFields } from "./a2p2-evidence-privacy";
import {
  MAX_SAFE_SCALAR_ARRAY,
  MAX_STRUCTURED_FACTS,
  SAFE_FACT_STRING_MAX,
  type EmailDraftStructuredSnapshot,
  type EvidenceLocator,
  type GenericStructuredFact,
  type GenericStructuredSnapshot,
  type ResearchStructuredSnapshot,
  type SafeNormalizedValue,
  type StructuredSourcesSnapshot,
} from "./a2p2-evidence-types";

const SOURCE_TOP_KEYS = ["tender", "research", "emailDraft", "generic"] as const;

const ANALYSIS_RESULT_KEYS = [
  "contractVersion",
  "manifest",
  "projectSummary",
  "criticalFacts",
  "facts",
  "requirements",
  "mandatoryRequirementIds",
  "unknowns",
  "risks",
  "clarifications",
  "resolvedAmbiguities",
  "addendumChanges",
  "conflicts",
  "submissionChecklist",
  "evidenceCoverage",
  "limitations",
  "nextActions",
  "metadata",
] as const;

const DOCUMENT_FACT_KEYS = [
  "id",
  "factType",
  "claim",
  "rawValue",
  "normalizedValue",
  "confidence",
  "evidence",
  "sourceRole",
  "status",
] as const;

const REQUIREMENT_KEYS = [
  "id",
  "category",
  "statement",
  "actor",
  "action",
  "object",
  "mandatory",
  "mandatorySignal",
  "deadline",
  "quantity",
  "unit",
  "submissionStage",
  "technicalArea",
  "status",
  "supersededById",
  "evidence",
  "confidence",
] as const;

const EVIDENCE_REF_KEYS = ["documentId", "pageNumber", "snippet"] as const;

const GENERIC_FACT_KEYS = [
  "requirementId",
  "factKey",
  "summary",
  "sourceId",
  "evidenceKind",
  "normalizedValue",
  "privacyClass",
  "locator",
  "contentHash",
  "extractorVersion",
  "sourceType",
] as const;

const GENERIC_SNAPSHOT_KEYS = ["facts"] as const;
const RESEARCH_SNAPSHOT_KEYS = ["claims"] as const;
const EMAIL_SNAPSHOT_KEYS = [
  "purposeAddressed",
  "requiredQuestionIds",
  "unsupportedCommitmentAbsent",
  "recipientResolved",
  "sourceId",
] as const;
const LOCATOR_KEYS = ["page", "section", "field", "recordKey", "toolName"] as const;

export type ParseStructuredSourcesResult =
  | { ok: true; sources: StructuredSourcesSnapshot }
  | { ok: false; reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max = SAFE_FACT_STRING_MAX): string | null {
  if (typeof value !== "string") return null;
  if (value.length > max) return null;
  return value;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseSafeNormalized(value: unknown): SafeNormalizedValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    return value.length <= SAFE_FACT_STRING_MAX ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_SAFE_SCALAR_ARRAY) return undefined;
    const items: Array<string | number | boolean | null> = [];
    for (const item of value) {
      if (item === null || typeof item === "boolean") {
        items.push(item);
        continue;
      }
      if (typeof item === "number" && Number.isFinite(item)) {
        items.push(item);
        continue;
      }
      if (typeof item === "string" && item.length <= SAFE_FACT_STRING_MAX) {
        items.push(item);
        continue;
      }
      return undefined;
    }
    return items;
  }
  return undefined;
}

function parseLocator(value: unknown): EvidenceLocator | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return "invalid";
  if (unknownKeys(value, LOCATOR_KEYS).length > 0) return "invalid";
  const page = value.page === undefined ? undefined : positiveInt(value.page);
  if (value.page !== undefined && page == null) return "invalid";
  const section = value.section === undefined ? undefined : boundedString(value.section, 80);
  if (value.section !== undefined && section == null) return "invalid";
  const field = value.field === undefined ? undefined : boundedString(value.field, 80);
  if (value.field !== undefined && field == null) return "invalid";
  const recordKey =
    value.recordKey === undefined ? undefined : boundedString(value.recordKey, 80);
  if (value.recordKey !== undefined && recordKey == null) return "invalid";
  const toolName = value.toolName === undefined ? undefined : boundedString(value.toolName, 80);
  if (value.toolName !== undefined && toolName == null) return "invalid";
  return {
    page: page ?? undefined,
    section: section ?? undefined,
    field: field ?? undefined,
    recordKey: recordKey ?? undefined,
    toolName: toolName ?? undefined,
  };
}

function parseGenericFact(value: unknown): GenericStructuredFact | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, GENERIC_FACT_KEYS).length > 0) return null;
  const requirementId = boundedString(value.requirementId, 80);
  const factKey = boundedString(value.factKey, 80);
  const summary = boundedString(value.summary);
  const sourceId = boundedString(value.sourceId, 128);
  if (!requirementId || !factKey || !summary || !sourceId) return null;
  let evidenceKind: EvaluationEvidenceKind | undefined;
  if (value.evidenceKind !== undefined) {
    if (
      typeof value.evidenceKind !== "string" ||
      !(EVALUATION_EVIDENCE_KINDS as readonly string[]).includes(value.evidenceKind)
    ) {
      return null;
    }
    evidenceKind = value.evidenceKind as EvaluationEvidenceKind;
  }
  let normalizedValue: SafeNormalizedValue | undefined;
  if (value.normalizedValue !== undefined) {
    normalizedValue = parseSafeNormalized(value.normalizedValue);
    if (normalizedValue === undefined) return null;
  }
  let privacyClass: EvaluationPrivacyClass | undefined;
  if (value.privacyClass !== undefined) {
    if (
      typeof value.privacyClass !== "string" ||
      !(EVALUATION_PRIVACY_CLASSES as readonly string[]).includes(value.privacyClass)
    ) {
      return null;
    }
    privacyClass = value.privacyClass as EvaluationPrivacyClass;
  }
  const locator = parseLocator(value.locator);
  if (locator === "invalid") return null;
  const contentHash =
    value.contentHash === undefined ? undefined : boundedString(value.contentHash, 64);
  if (value.contentHash !== undefined && (contentHash == null || !/^[a-f0-9]{64}$/i.test(contentHash))) {
    return null;
  }
  const extractorVersion =
    value.extractorVersion === undefined ? undefined : boundedString(value.extractorVersion, 80);
  if (value.extractorVersion !== undefined && extractorVersion == null) return null;
  const sourceType =
    value.sourceType === undefined ? undefined : boundedString(value.sourceType, 80);
  if (value.sourceType !== undefined && sourceType == null) return null;
  return {
    requirementId,
    factKey,
    summary,
    sourceId,
    evidenceKind,
    normalizedValue,
    privacyClass,
    locator,
    contentHash: contentHash ?? undefined,
    extractorVersion: extractorVersion ?? undefined,
    sourceType: sourceType ?? undefined,
  };
}

function parseGeneric(value: unknown): GenericStructuredSnapshot | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, GENERIC_SNAPSHOT_KEYS).length > 0) return null;
  if (value.facts === undefined) return {};
  if (!Array.isArray(value.facts) || value.facts.length > MAX_STRUCTURED_FACTS) return null;
  const facts: GenericStructuredFact[] = [];
  for (const item of value.facts) {
    const parsed = parseGenericFact(item);
    if (!parsed) return null;
    facts.push(parsed);
  }
  return { facts };
}

const RESEARCH_CLAIM_KEYS = [
  "requirementId",
  "claimKey",
  "summary",
  "sourceId",
  "sourceDate",
  "contentHash",
  "evidenceKind",
] as const;

function parseResearch(value: unknown): ResearchStructuredSnapshot | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, RESEARCH_SNAPSHOT_KEYS).length > 0) return null;
  if (value.claims === undefined) return {};
  if (!Array.isArray(value.claims) || value.claims.length > MAX_STRUCTURED_FACTS) return null;
  for (const claim of value.claims) {
    if (!isPlainObject(claim)) return null;
    if (unknownKeys(claim, RESEARCH_CLAIM_KEYS).length > 0) return null;
  }
  return { claims: value.claims as Record<string, unknown>[] };
}

function parseEmail(value: unknown): EmailDraftStructuredSnapshot | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, EMAIL_SNAPSHOT_KEYS).length > 0) return null;
  if (value.purposeAddressed !== undefined && typeof value.purposeAddressed !== "boolean") {
    return null;
  }
  if (value.unsupportedCommitmentAbsent !== undefined && typeof value.unsupportedCommitmentAbsent !== "boolean") {
    return null;
  }
  if (value.recipientResolved !== undefined && typeof value.recipientResolved !== "boolean") {
    return null;
  }
  if (value.requiredQuestionIds !== undefined) {
    if (!Array.isArray(value.requiredQuestionIds) || value.requiredQuestionIds.length > 50) {
      return null;
    }
    if (!value.requiredQuestionIds.every((id) => typeof id === "string" && id.length <= 80)) {
      return null;
    }
  }
  if (value.sourceId !== undefined && boundedString(value.sourceId, 128) == null) return null;
  return {
    purposeAddressed: value.purposeAddressed as boolean | undefined,
    requiredQuestionIds: value.requiredQuestionIds as string[] | undefined,
    unsupportedCommitmentAbsent: value.unsupportedCommitmentAbsent as boolean | undefined,
    recipientResolved: value.recipientResolved as boolean | undefined,
    sourceId: value.sourceId as string | undefined,
  };
}

function parseEvidenceRef(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (unknownKeys(value, EVIDENCE_REF_KEYS).length > 0) return false;
  if (boundedString(value.documentId, 128) == null) return false;
  if (positiveInt(value.pageNumber) == null) return false;
  if (typeof value.snippet !== "string" || value.snippet.length < 1 || value.snippet.length > 600) {
    return false;
  }
  return true;
}

function parseNormalizedV2(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  const kind = value.kind;
  if (kind === "date") return boundedString(value.value, 40) != null;
  if (kind === "datetime") {
    return (
      boundedString(value.date, 40) != null &&
      (value.time === null || boundedString(value.time, 20) != null) &&
      (value.tz === null || boundedString(value.tz, 40) != null)
    );
  }
  if (kind === "money") {
    return (
      typeof value.amount === "number" &&
      Number.isFinite(value.amount) &&
      (value.currency === null || boundedString(value.currency, 12) != null)
    );
  }
  if (kind === "quantity") {
    return (
      typeof value.value === "number" &&
      Number.isFinite(value.value) &&
      (value.unit === null || boundedString(value.unit, 40) != null)
    );
  }
  if (kind === "duration_days") {
    return typeof value.days === "number" && Number.isFinite(value.days);
  }
  if (kind === "percent") {
    return typeof value.value === "number" && Number.isFinite(value.value);
  }
  if (kind === "boolean") return typeof value.value === "boolean";
  if (kind === "text") return boundedString(value.value) != null;
  return false;
}

function parseDocumentFact(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (unknownKeys(value, DOCUMENT_FACT_KEYS).length > 0) return false;
  if (boundedString(value.id, 80) == null) return false;
  if (boundedString(value.factType, 80) == null) return false;
  if (boundedString(value.claim) == null) return false;
  if (value.rawValue !== null && boundedString(value.rawValue, 300) == null) return false;
  if (!parseNormalizedV2(value.normalizedValue)) return false;
  if (typeof value.confidence !== "string") return false;
  if (!Array.isArray(value.evidence) || value.evidence.length > 20) return false;
  if (!value.evidence.every(parseEvidenceRef)) return false;
  if (typeof value.sourceRole !== "string") return false;
  if (value.status !== "ACTIVE" && value.status !== "SUPERSEDED" && value.status !== "CONFLICT") {
    return false;
  }
  return true;
}

function parseRequirement(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (unknownKeys(value, REQUIREMENT_KEYS).length > 0) return false;
  if (boundedString(value.id, 80) == null) return false;
  if (boundedString(value.category, 40) == null) return false;
  if (boundedString(value.statement, 600) == null) return false;
  if (value.actor !== null && boundedString(value.actor, 120) == null) return false;
  if (value.action !== null && boundedString(value.action, 200) == null) return false;
  if (value.object !== null && boundedString(value.object, 200) == null) return false;
  if (value.mandatory !== true && value.mandatory !== false && value.mandatory !== "uncertain") {
    return false;
  }
  if (!Array.isArray(value.evidence) || !value.evidence.every(parseEvidenceRef)) return false;
  if (
    value.status !== "ACTIVE" &&
    value.status !== "SUPERSEDED" &&
    value.status !== "CONFLICT" &&
    value.status !== "NEEDS_REVIEW"
  ) {
    return false;
  }
  return true;
}

function parseTender(value: unknown): unknown | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, ANALYSIS_RESULT_KEYS).length > 0) return null;
  if (value.contractVersion !== TENDER_ANALYSIS_RESULT_VERSION) return null;
  if (!Array.isArray(value.facts) || value.facts.length > MAX_STRUCTURED_FACTS) return null;
  if (!value.facts.every(parseDocumentFact)) return null;
  if (!Array.isArray(value.requirements) || value.requirements.length > MAX_STRUCTURED_FACTS) {
    return null;
  }
  if (!value.requirements.every(parseRequirement)) return null;
  if (!Array.isArray(value.mandatoryRequirementIds)) return null;
  if (!value.mandatoryRequirementIds.every((id) => typeof id === "string" && id.length <= 80)) {
    return null;
  }
  if (scanForbiddenEvidenceFields({
    facts: (value.facts as { rawValue?: unknown }[]).map((fact) => ({
      id: (fact as { id?: string }).id,
      factType: (fact as { factType?: string }).factType,
      claim: (fact as { claim?: string }).claim,
    })),
  })) {
    return null;
  }
  return value;
}

export function parseStructuredSourcesSnapshot(
  value: unknown,
): ParseStructuredSourcesResult {
  try {
    if (value == null) return { ok: true, sources: {} };
    if (!isPlainObject(value)) {
      return { ok: false, reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };
    }
    if (unknownKeys(value, SOURCE_TOP_KEYS).length > 0) {
      return { ok: false, reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };
    }
    const sources: StructuredSourcesSnapshot = {};
    if (value.tender !== undefined) {
      const tender = parseTender(value.tender);
      if (!tender) return { ok: false, reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };
      sources.tender = tender;
    }
    if (value.research !== undefined) {
      const research = parseResearch(value.research);
      if (!research) return { ok: false, reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };
      sources.research = research;
    }
    if (value.emailDraft !== undefined) {
      const emailDraft = parseEmail(value.emailDraft);
      if (!emailDraft) return { ok: false, reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };
      sources.emailDraft = emailDraft;
    }
    if (value.generic !== undefined) {
      const generic = parseGeneric(value.generic);
      if (!generic) return { ok: false, reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };
      sources.generic = generic;
    }
    return { ok: true, sources };
  } catch {
    return { ok: false, reason: "EVIDENCE_INVALID_STRUCTURED_SOURCE" };
  }
}
