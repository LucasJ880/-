/**
 * Autopilot A2-P2.1 — runtime structured-source parser.
 *
 * TypeScript types are not authority. Unknown JSON fails closed.
 * Tender input is projected to ParsedTenderEvidenceSource; the original
 * unknown value is never returned to collectors/adapters.
 * Never throws.
 */

import {
  EVALUATION_EVIDENCE_KINDS,
  EVALUATION_PRIVACY_CLASSES,
  type EvaluationEvidenceKind,
  type EvaluationPrivacyClass,
} from "./a2p2-contract";
import {
  CONFIDENCE_LEVELS,
  CRITICAL_FACT_TYPES,
  DOCUMENT_SOURCE_ROLES,
  REQUIREMENT_CATEGORIES,
  TENDER_ANALYSIS_RESULT_VERSION,
  type FactTypeV2,
  type MandatoryV2,
  type NormalizedValueV2,
  type RequirementCategoryV2,
  type RequirementStatusV2,
} from "../tender-understanding/contract";
import {
  isBoundedIsoTimestamp,
  isOpaqueSourceId,
  isOpaqueToken,
  isVersionToken,
  scanForbiddenEvidenceFields,
} from "./a2p2-evidence-privacy";
import {
  MAX_EVIDENCE_REFS_PER_ITEM,
  MAX_MANIFEST_DOCUMENTS,
  MAX_SAFE_SCALAR_ARRAY,
  MAX_STRUCTURED_FACTS,
  SAFE_FACT_STRING_MAX,
  type EmailDraftStructuredSnapshot,
  type EvidenceLocator,
  type GenericStructuredFact,
  type GenericStructuredSnapshot,
  type ParsedTenderEvidenceRef,
  type ParsedTenderEvidenceSource,
  type ParsedTenderFact,
  type ParsedTenderManifestDocument,
  type ParsedTenderRequirement,
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
const MANIFEST_DOCUMENT_KEYS = [
  "documentId",
  "name",
  "type",
  "sourceRole",
  "pageCount",
  "contentHash",
] as const;

const DOCUMENT_FACT_STATUSES = ["ACTIVE", "SUPERSEDED", "CONFLICT"] as const;
const REQUIREMENT_STATUSES = ["ACTIVE", "SUPERSEDED", "CONFLICT", "NEEDS_REVIEW"] as const;
const FACT_TYPES: readonly string[] = [...CRITICAL_FACT_TYPES, "other"];

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
  "sourceObservedAt",
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

function isCanonical(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
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
  if (!isOpaqueToken(requirementId) || !isOpaqueToken(factKey) || !isOpaqueSourceId(sourceId)) {
    return null;
  }
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
  let extractorVersion: string | undefined;
  if (value.extractorVersion !== undefined) {
    if (typeof value.extractorVersion !== "string" || !isVersionToken(value.extractorVersion)) {
      return null;
    }
    extractorVersion = value.extractorVersion;
  }
  let sourceObservedAt: string | undefined;
  if (value.sourceObservedAt !== undefined) {
    if (typeof value.sourceObservedAt !== "string" || !isBoundedIsoTimestamp(value.sourceObservedAt)) {
      return null;
    }
    sourceObservedAt = value.sourceObservedAt;
  }
  let sourceType: string | undefined;
  if (value.sourceType !== undefined) {
    if (typeof value.sourceType !== "string" || !isOpaqueToken(value.sourceType)) {
      return null;
    }
    sourceType = value.sourceType;
  }
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
    extractorVersion,
    sourceObservedAt,
    sourceType,
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
  if (value.sourceId !== undefined) {
    const sourceId = boundedString(value.sourceId, 128);
    if (sourceId == null || !isOpaqueSourceId(sourceId)) return null;
  }
  return {
    purposeAddressed: value.purposeAddressed as boolean | undefined,
    requiredQuestionIds: value.requiredQuestionIds as string[] | undefined,
    unsupportedCommitmentAbsent: value.unsupportedCommitmentAbsent as boolean | undefined,
    recipientResolved: value.recipientResolved as boolean | undefined,
    sourceId: typeof value.sourceId === "string" ? value.sourceId : undefined,
  };
}

function parseEvidenceRef(value: unknown): ParsedTenderEvidenceRef | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, EVIDENCE_REF_KEYS).length > 0) return null;
  const documentId = boundedString(value.documentId, 128);
  if (documentId == null || !isOpaqueSourceId(documentId)) return null;
  const pageNumber = positiveInt(value.pageNumber);
  if (pageNumber == null) return null;
  if (value.snippet !== undefined) {
    if (typeof value.snippet !== "string" || value.snippet.length < 1 || value.snippet.length > 600) {
      return null;
    }
  }
  return { documentId, pageNumber };
}

function parseNormalizedV2(value: unknown): NormalizedValueV2 | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value) || typeof value.kind !== "string") return undefined;
  const kind = value.kind;
  if (kind === "date") {
    const parsed = boundedString(value.value, 40);
    return parsed == null ? undefined : { kind: "date", value: parsed };
  }
  if (kind === "datetime") {
    const date = boundedString(value.date, 40);
    if (date == null) return undefined;
    if (value.time !== null && boundedString(value.time, 20) == null) return undefined;
    if (value.tz !== null && boundedString(value.tz, 40) == null) return undefined;
    return {
      kind: "datetime",
      date,
      time: value.time === null ? null : (value.time as string),
      tz: value.tz === null ? null : (value.tz as string),
    };
  }
  if (kind === "money") {
    if (typeof value.amount !== "number" || !Number.isFinite(value.amount)) return undefined;
    if (value.currency !== null && boundedString(value.currency, 12) == null) return undefined;
    return {
      kind: "money",
      amount: value.amount,
      currency: value.currency === null ? null : (value.currency as string),
    };
  }
  if (kind === "quantity") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) return undefined;
    if (value.unit !== null && boundedString(value.unit, 40) == null) return undefined;
    return {
      kind: "quantity",
      value: value.value,
      unit: value.unit === null ? null : (value.unit as string),
    };
  }
  if (kind === "duration_days") {
    if (typeof value.days !== "number" || !Number.isFinite(value.days)) return undefined;
    return { kind: "duration_days", days: value.days };
  }
  if (kind === "percent") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) return undefined;
    return { kind: "percent", value: value.value };
  }
  if (kind === "boolean") {
    if (typeof value.value !== "boolean") return undefined;
    return { kind: "boolean", value: value.value };
  }
  if (kind === "text") {
    const parsed = boundedString(value.value);
    return parsed == null ? undefined : { kind: "text", value: parsed };
  }
  return undefined;
}

function parseDocumentFact(value: unknown): ParsedTenderFact | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, DOCUMENT_FACT_KEYS).length > 0) return null;
  const id = boundedString(value.id, 80);
  if (id == null || !isOpaqueToken(id)) return null;
  if (!isCanonical(value.factType, FACT_TYPES)) return null;
  const claim = boundedString(value.claim);
  if (claim == null) return null;
  if (value.rawValue !== undefined && value.rawValue !== null && boundedString(value.rawValue, 300) == null) {
    return null;
  }
  const normalizedValue = parseNormalizedV2(value.normalizedValue);
  if (normalizedValue === undefined) return null;
  if (value.confidence !== undefined && !isCanonical(value.confidence, CONFIDENCE_LEVELS)) {
    return null;
  }
  if (!Array.isArray(value.evidence) || value.evidence.length > MAX_EVIDENCE_REFS_PER_ITEM) return null;
  const evidence: ParsedTenderEvidenceRef[] = [];
  for (const item of value.evidence) {
    const parsed = parseEvidenceRef(item);
    if (!parsed) return null;
    evidence.push(parsed);
  }
  if (value.sourceRole !== undefined && !isCanonical(value.sourceRole, DOCUMENT_SOURCE_ROLES)) {
    return null;
  }
  if (!isCanonical(value.status, DOCUMENT_FACT_STATUSES)) return null;
  return {
    id,
    factType: value.factType as FactTypeV2,
    claim,
    normalizedValue,
    evidence,
    status: value.status as ParsedTenderFact["status"],
  };
}

function parseRequirement(value: unknown): ParsedTenderRequirement | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, REQUIREMENT_KEYS).length > 0) return null;
  const id = boundedString(value.id, 80);
  if (id == null || !isOpaqueToken(id)) return null;
  if (!isCanonical(value.category, REQUIREMENT_CATEGORIES)) return null;
  const statement = boundedString(value.statement, 600);
  if (statement == null) return null;
  if (value.actor !== null && boundedString(value.actor, 120) == null) return null;
  if (value.action !== null && boundedString(value.action, 200) == null) return null;
  if (value.object !== null && boundedString(value.object, 200) == null) return null;
  if (value.mandatory !== true && value.mandatory !== false && value.mandatory !== "uncertain") {
    return null;
  }
  if (!Array.isArray(value.evidence) || value.evidence.length > MAX_EVIDENCE_REFS_PER_ITEM) return null;
  const evidence: ParsedTenderEvidenceRef[] = [];
  for (const item of value.evidence) {
    const parsed = parseEvidenceRef(item);
    if (!parsed) return null;
    evidence.push(parsed);
  }
  if (!isCanonical(value.status, REQUIREMENT_STATUSES)) return null;
  if (value.confidence !== undefined && !isCanonical(value.confidence, CONFIDENCE_LEVELS)) {
    return null;
  }
  return {
    id,
    category: value.category as RequirementCategoryV2,
    statement,
    actor: value.actor === null ? null : (value.actor as string),
    action: value.action === null ? null : (value.action as string),
    object: value.object === null ? null : (value.object as string),
    mandatory: value.mandatory as MandatoryV2,
    evidence,
    status: value.status as RequirementStatusV2,
  };
}

function parseManifestDocuments(value: unknown): ParsedTenderManifestDocument[] | null {
  if (!isPlainObject(value)) return null;
  if (!Array.isArray(value.documents) || value.documents.length > MAX_MANIFEST_DOCUMENTS) {
    return null;
  }
  const documents: ParsedTenderManifestDocument[] = [];
  for (const item of value.documents) {
    if (!isPlainObject(item)) return null;
    if (unknownKeys(item, MANIFEST_DOCUMENT_KEYS).length > 0) return null;
    const documentId = boundedString(item.documentId, 128);
    if (documentId == null || !isOpaqueSourceId(documentId)) return null;
    if (item.sourceRole !== undefined && !isCanonical(item.sourceRole, DOCUMENT_SOURCE_ROLES)) {
      return null;
    }
    let contentHash: string | null = null;
    if (item.contentHash === undefined || item.contentHash === null) {
      contentHash = null;
    } else if (typeof item.contentHash === "string" && /^[a-f0-9]{64}$/i.test(item.contentHash)) {
      contentHash = item.contentHash.toLowerCase();
    } else {
      return null;
    }
    documents.push({ documentId, contentHash });
  }
  return documents;
}

function parseAnalyzerVersion(metadata: unknown): string | undefined | "invalid" {
  if (metadata === undefined) return undefined;
  if (!isPlainObject(metadata)) return "invalid";
  if (metadata.analyzerVersion === undefined) return undefined;
  if (typeof metadata.analyzerVersion !== "string" || !isVersionToken(metadata.analyzerVersion)) {
    return "invalid";
  }
  return metadata.analyzerVersion;
}

function mandatoryViewMatchesCanonical(
  requirements: readonly ParsedTenderRequirement[],
  actualIds: readonly string[],
): boolean {
  const seen = new Set<string>();
  for (const id of actualIds) {
    if (seen.has(id)) return false;
    seen.add(id);
  }
  const byId = new Map(requirements.map((item) => [item.id, item]));
  for (const id of actualIds) {
    if (!byId.has(id)) return false;
  }
  const expectedIds = requirements
    .filter((item) => item.status === "ACTIVE" && item.mandatory === true)
    .map((item) => item.id);
  if (actualIds.length !== expectedIds.length) return false;
  const expectedSet = new Set(expectedIds);
  for (const id of actualIds) {
    if (!expectedSet.has(id)) return false;
  }
  for (const id of expectedIds) {
    const req = byId.get(id);
    if (!req || req.evidence.length < 1) return false;
  }
  return true;
}

export function parseTenderEvidenceSource(value: unknown): ParsedTenderEvidenceSource | null {
  if (!isPlainObject(value)) return null;
  if (unknownKeys(value, ANALYSIS_RESULT_KEYS).length > 0) return null;
  if (value.contractVersion !== TENDER_ANALYSIS_RESULT_VERSION) return null;
  const documents = parseManifestDocuments(value.manifest);
  if (!documents) return null;
  const analyzerVersion = parseAnalyzerVersion(value.metadata);
  if (analyzerVersion === "invalid") return null;
  if (!Array.isArray(value.facts) || value.facts.length > MAX_STRUCTURED_FACTS) return null;
  const facts: ParsedTenderFact[] = [];
  for (const item of value.facts) {
    const parsed = parseDocumentFact(item);
    if (!parsed) return null;
    facts.push(parsed);
  }
  if (!Array.isArray(value.requirements) || value.requirements.length > MAX_STRUCTURED_FACTS) {
    return null;
  }
  const requirements: ParsedTenderRequirement[] = [];
  for (const item of value.requirements) {
    const parsed = parseRequirement(item);
    if (!parsed) return null;
    requirements.push(parsed);
  }
  if (!Array.isArray(value.mandatoryRequirementIds) || value.mandatoryRequirementIds.length > MAX_STRUCTURED_FACTS) {
    return null;
  }
  const mandatoryRequirementIds: string[] = [];
  for (const id of value.mandatoryRequirementIds) {
    if (typeof id !== "string" || id.length > 80 || !isOpaqueToken(id)) return null;
    mandatoryRequirementIds.push(id);
  }
  if (!mandatoryViewMatchesCanonical(requirements, mandatoryRequirementIds)) {
    return null;
  }
  const projected: ParsedTenderEvidenceSource = {
    contractVersion: TENDER_ANALYSIS_RESULT_VERSION,
    manifest: { documents },
    metadata: analyzerVersion ? { analyzerVersion } : {},
    facts,
    requirements,
    mandatoryRequirementIds,
  };
  if (scanForbiddenEvidenceFields(projected)) return null;
  return projected;
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
      const tender = parseTenderEvidenceSource(value.tender);
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
