/**
 * Autopilot A2-P2.2 — deep Semantic Evidence Packet validator.
 *
 * Never throws for arbitrary JSON. Does not call hashEvidencePacket until
 * nested structure and P2.1 canonical invariants are checked.
 */

import {
  A2P2_DOMAIN_IDS,
  AUTOMATION_LEVELS,
  EVALUATION_RISK_CLASSES,
  REQUIREMENT_ID_PATTERN,
  isJudgeEligibleEvidenceKind,
  isJudgeEligiblePrivacyClass,
  type EvaluationEvidenceKind,
} from "./a2p2-contract";
import {
  hashEvidencePacket,
  makeCanonicalFactHash,
  makeEvidenceRef,
} from "./a2p2-evidence-hash";
import { isKnownPrivacyClass, isOpaqueSourceId, isOpaqueToken } from "./a2p2-evidence-privacy";
import {
  A2P2_EVIDENCE_BUILDER_VERSION,
  A2P2_EVIDENCE_COLLECTOR_VERSION,
  A2P2_EVIDENCE_PACKET_VERSION,
  EVIDENCE_ACCEPTANCE_STATES,
  EVIDENCE_PACKET_STATUSES,
  EVIDENCE_REASON_CODES,
  MAX_EVIDENCE_FACTS,
  MAX_FACTS_PER_REQUIREMENT,
  REQUIREMENT_EVIDENCE_STATES,
  SAFE_FACT_STRING_MAX,
  type EvidenceAcceptanceState,
  type EvidenceFact,
  type EvidenceLocator,
  type EvidencePacketStatus,
  type RejectedEvidence,
  type RequirementEvidenceAssessment,
  type SafeNormalizedValue,
  type SemanticEvidencePacketV1,
} from "./a2p2-evidence-types";
import type { SemanticJudgeRuleId } from "./a2p2-semantic-judge-types";

const HEX_64 = /^[a-f0-9]{64}$/;
const MAX_WALK_DEPTH = 24;
const EXTRACTOR_VERSION_RE =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,63}){0,3}$/;

const PACKET_KEYS = [
  "version",
  "builderVersion",
  "contract",
  "taskType",
  "requirements",
  "evidenceFacts",
  "rejectedFacts",
  "requirementAssessments",
  "status",
  "privacySummary",
  "provenanceSummary",
  "diagnostics",
  "packetHash",
] as const;

const CONTRACT_KEYS = [
  "taskType",
  "riskClass",
  "automationLevel",
  "requirementCount",
  "semanticContractHash",
] as const;

const REQUIREMENT_KEYS = [
  "id",
  "required",
  "evidenceKinds",
  "minimumEvidenceRefs",
  "allowUnknown",
] as const;

const FACT_KEYS = [
  "evidenceRef",
  "evidenceKind",
  "requirementId",
  "factKey",
  "factSummary",
  "normalizedValue",
  "source",
  "canonicalFactHash",
  "privacyClass",
  "acceptance",
  "countsTowardRequirement",
  "provenance",
] as const;

const SOURCE_KEYS = ["sourceType", "sourceId", "locator"] as const;
const LOCATOR_KEYS = ["page", "section", "field", "recordKey", "toolName"] as const;
const PROVENANCE_KEYS = [
  "collectorVersion",
  "extractorVersion",
  "sourceContentHash",
  "sourceObservedAt",
  "createdAt",
] as const;
const ASSESSMENT_KEYS = [
  "requirementId",
  "requiredEvidenceRefs",
  "validEvidenceRefs",
  "state",
  "reasonCode",
] as const;
const PRIVACY_SUMMARY_KEYS = ["blocked", "redactedCount", "prohibitedCount"] as const;
const PROVENANCE_SUMMARY_KEYS = ["collectorVersion", "factCount", "rejectedCount"] as const;
const REJECTED_KEYS = ["reasonCode", "requirementId", "factKey"] as const;
const DIAGNOSTIC_KEYS = ["code", "detail"] as const;

export type ValidateEvidencePacketResult =
  | { ok: true; packet: SemanticEvidencePacketV1 }
  | { ok: false; ruleId: SemanticJudgeRuleId };

export function validateEvidencePacketForSemanticJudge(
  value: unknown,
): ValidateEvidencePacketResult {
  try {
    return validateInner(value, 0);
  } catch {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_MALFORMED_PACKET" };
  }
}

function validateInner(value: unknown, depth: number): ValidateEvidencePacketResult {
  if (depth > MAX_WALK_DEPTH) return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  if (!isPlainObject(value)) return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  if (extraKeys(value, PACKET_KEYS).length > 0) return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");

  if (value.version !== A2P2_EVIDENCE_PACKET_VERSION) {
    return fail("SEMANTIC_JUDGE_NOT_EVALUABLE");
  }
  if (value.builderVersion !== A2P2_EVIDENCE_BUILDER_VERSION) {
    return fail("SEMANTIC_JUDGE_NOT_EVALUABLE");
  }
  if (typeof value.packetHash !== "string" || !HEX_64.test(value.packetHash)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!isEnum(value.taskType, A2P2_DOMAIN_IDS)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!isEnum(value.status, EVIDENCE_PACKET_STATUSES)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }

  const contract = parseContractMeta(value.contract);
  if (!contract.ok) return contract;

  if (!Array.isArray(value.requirements) || value.requirements.length > MAX_EVIDENCE_FACTS) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  const requirements: SemanticEvidencePacketV1["requirements"][number][] = [];
  const requirementById = new Map<string, SemanticEvidencePacketV1["requirements"][number]>();
  for (const item of value.requirements) {
    const parsed = parsePacketRequirement(item);
    if (!parsed.ok) return parsed;
    if (requirementById.has(parsed.requirement.id)) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    requirementById.set(parsed.requirement.id, parsed.requirement);
    requirements.push(parsed.requirement);
  }
  if (contract.meta.requirementCount !== requirements.length) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }

  if (!Array.isArray(value.evidenceFacts) || value.evidenceFacts.length > MAX_EVIDENCE_FACTS) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  const evidenceFacts: EvidenceFact[] = [];
  const factsByRef = new Map<string, EvidenceFact>();
  for (const item of value.evidenceFacts) {
    const parsed = parseFact(item, requirementById);
    if (!parsed.ok) return parsed;
    if (factsByRef.has(parsed.fact.evidenceRef)) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    factsByRef.set(parsed.fact.evidenceRef, parsed.fact);
    evidenceFacts.push(parsed.fact);
  }

  if (!Array.isArray(value.requirementAssessments)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  const requirementAssessments: RequirementEvidenceAssessment[] = [];
  const assessedIds = new Set<string>();
  for (const item of value.requirementAssessments) {
    const parsed = parseAssessment(item, requirementById, factsByRef);
    if (!parsed.ok) return parsed;
    if (assessedIds.has(parsed.assessment.requirementId)) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    assessedIds.add(parsed.assessment.requirementId);
    requirementAssessments.push(parsed.assessment);
  }
  if (requirementAssessments.length !== requirements.length) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  for (const requirement of requirements) {
    if (!assessedIds.has(requirement.id)) return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }

  const rejectedFacts = parseRejectedList(value.rejectedFacts);
  if (!rejectedFacts.ok) return rejectedFacts;
  const diagnostics = parseDiagnosticList(value.diagnostics);
  if (!diagnostics.ok) return diagnostics;

  const privacySummary = parsePrivacySummary(value.privacySummary);
  if (!privacySummary.ok) return privacySummary;
  const provenanceSummary = parseProvenanceSummary(value.provenanceSummary);
  if (!provenanceSummary.ok) return provenanceSummary;

  const packet: SemanticEvidencePacketV1 = {
    version: A2P2_EVIDENCE_PACKET_VERSION,
    builderVersion: A2P2_EVIDENCE_BUILDER_VERSION,
    contract: contract.meta,
    taskType: value.taskType,
    requirements,
    evidenceFacts,
    rejectedFacts: rejectedFacts.rows,
    requirementAssessments,
    status: value.status as EvidencePacketStatus,
    privacySummary: privacySummary.summary,
    provenanceSummary: provenanceSummary.summary,
    diagnostics: diagnostics.rows,
    packetHash: value.packetHash,
  };

  if (hashEvidencePacket(packet) !== packet.packetHash) {
    return fail("SEMANTIC_JUDGE_PACKET_HASH_MISMATCH");
  }
  return { ok: true, packet };
}

function parseContractMeta(
  value: unknown,
):
  | { ok: true; meta: SemanticEvidencePacketV1["contract"] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, CONTRACT_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!isEnum(value.taskType, A2P2_DOMAIN_IDS)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.riskClass !== "string" || !isEnum(value.riskClass, EVALUATION_RISK_CLASSES)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (
    typeof value.automationLevel !== "string" ||
    (!isEnum(value.automationLevel, AUTOMATION_LEVELS) && value.automationLevel !== "L0")
  ) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (
    typeof value.requirementCount !== "number" ||
    !Number.isInteger(value.requirementCount) ||
    value.requirementCount < 0
  ) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.semanticContractHash !== "string" || !HEX_64.test(value.semanticContractHash)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  return {
    ok: true,
    meta: {
      taskType: value.taskType,
      riskClass: value.riskClass,
      automationLevel: value.automationLevel,
      requirementCount: value.requirementCount,
      semanticContractHash: value.semanticContractHash,
    },
  };
}

function parsePacketRequirement(value: unknown):
  | { ok: true; requirement: SemanticEvidencePacketV1["requirements"][number] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, REQUIREMENT_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.id !== "string" || !REQUIREMENT_ID_PATTERN.test(value.id) || !isOpaqueToken(value.id)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.required !== "boolean" || typeof value.allowUnknown !== "boolean") {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (
    typeof value.minimumEvidenceRefs !== "number" ||
    !Number.isInteger(value.minimumEvidenceRefs) ||
    value.minimumEvidenceRefs < 0
  ) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!Array.isArray(value.evidenceKinds) || value.evidenceKinds.length < 1) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  const evidenceKinds: EvaluationEvidenceKind[] = [];
  for (const kind of value.evidenceKinds) {
    if (typeof kind !== "string" || !isJudgeEligibleEvidenceKind(kind)) {
      return fail("SEMANTIC_JUDGE_UNKNOWN_EVIDENCE_KIND");
    }
    evidenceKinds.push(kind);
  }
  return {
    ok: true,
    requirement: {
      id: value.id,
      required: value.required,
      allowUnknown: value.allowUnknown,
      minimumEvidenceRefs: value.minimumEvidenceRefs,
      evidenceKinds,
    },
  };
}

function parseFact(
  value: unknown,
  requirementById: Map<string, SemanticEvidencePacketV1["requirements"][number]>,
): { ok: true; fact: EvidenceFact } | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, FACT_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.evidenceRef !== "string" || !HEX_64.test(value.evidenceRef)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.canonicalFactHash !== "string" || !HEX_64.test(value.canonicalFactHash)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.evidenceKind !== "string" || !isJudgeEligibleEvidenceKind(value.evidenceKind)) {
    return fail("SEMANTIC_JUDGE_UNKNOWN_EVIDENCE_KIND");
  }
  if (
    typeof value.requirementId !== "string" ||
    !REQUIREMENT_ID_PATTERN.test(value.requirementId) ||
    !isOpaqueToken(value.requirementId)
  ) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.factKey !== "string" || !isOpaqueToken(value.factKey)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (
    typeof value.factSummary !== "string" ||
    value.factSummary.length < 1 ||
    value.factSummary.length > SAFE_FACT_STRING_MAX
  ) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!isSafeNormalizedValue(value.normalizedValue)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!isKnownPrivacyClass(value.privacyClass)) {
    return fail("SEMANTIC_JUDGE_UNKNOWN_PRIVACY_CLASS");
  }
  if (!isEnum(value.acceptance, EVIDENCE_ACCEPTANCE_STATES)) {
    return fail("SEMANTIC_JUDGE_UNKNOWN_ACCEPTANCE");
  }
  if (typeof value.countsTowardRequirement !== "boolean") {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }

  const source = parseSource(value.source);
  if (!source.ok) return source;
  const provenance = parseFactProvenance(value.provenance);
  if (!provenance.ok) return provenance;

  const recomputedHash = makeCanonicalFactHash({
    evidenceKind: value.evidenceKind,
    requirementId: value.requirementId,
    factKey: value.factKey,
    normalizedValue: value.normalizedValue,
    sourceType: source.source.sourceType,
    sourceId: source.source.sourceId,
  });
  if (recomputedHash !== value.canonicalFactHash) {
    return fail("SEMANTIC_JUDGE_CANONICAL_FACT_HASH_MISMATCH");
  }
  const recomputedRef = makeEvidenceRef({
    evidenceKind: value.evidenceKind,
    requirementId: value.requirementId,
    factKey: value.factKey,
    sourceType: source.source.sourceType,
    sourceId: source.source.sourceId,
    canonicalFactHash: recomputedHash,
  });
  if (recomputedRef !== value.evidenceRef) {
    return fail("SEMANTIC_JUDGE_EVIDENCE_REF_MISMATCH");
  }

  const requirement = requirementById.get(value.requirementId);
  if (value.countsTowardRequirement) {
    if (!requirement) return fail("SEMANTIC_JUDGE_WRONG_EVIDENCE_KIND");
    if (!requirement.evidenceKinds.includes(value.evidenceKind)) {
      return fail("SEMANTIC_JUDGE_WRONG_EVIDENCE_KIND");
    }
  }

  return {
    ok: true,
    fact: {
      evidenceRef: value.evidenceRef,
      evidenceKind: value.evidenceKind,
      requirementId: value.requirementId,
      factKey: value.factKey,
      factSummary: value.factSummary,
      normalizedValue: value.normalizedValue as SafeNormalizedValue,
      source: source.source,
      canonicalFactHash: value.canonicalFactHash,
      privacyClass: value.privacyClass,
      acceptance: value.acceptance as EvidenceAcceptanceState,
      countsTowardRequirement: value.countsTowardRequirement,
      provenance: provenance.provenance,
    },
  };
}

function parseSource(value: unknown):
  | { ok: true; source: EvidenceFact["source"] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, SOURCE_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.sourceType !== "string" || !isOpaqueToken(value.sourceType)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.sourceId !== "string" || !isOpaqueSourceId(value.sourceId)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  let locator: EvidenceLocator | undefined;
  if (value.locator !== undefined) {
    const parsed = parseLocator(value.locator);
    if (!parsed.ok) return parsed;
    locator = parsed.locator;
  }
  return {
    ok: true,
    source: {
      sourceType: value.sourceType,
      sourceId: value.sourceId,
      locator,
    },
  };
}

function parseLocator(value: unknown):
  | { ok: true; locator: EvidenceLocator }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, LOCATOR_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  const locator: EvidenceLocator = {};
  if (value.page !== undefined) {
    if (typeof value.page !== "number" || !Number.isInteger(value.page) || value.page < 1) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    locator.page = value.page;
  }
  for (const key of ["section", "field", "recordKey", "toolName"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    locator[key] = value[key];
  }
  return { ok: true, locator };
}

function parseFactProvenance(value: unknown):
  | { ok: true; provenance: EvidenceFact["provenance"] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, PROVENANCE_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (value.collectorVersion !== A2P2_EVIDENCE_COLLECTOR_VERSION) {
    return fail("SEMANTIC_JUDGE_NOT_EVALUABLE");
  }
  if (typeof value.createdAt !== "string" || value.createdAt.length < 1) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (value.extractorVersion !== undefined) {
    if (
      typeof value.extractorVersion !== "string" ||
      value.extractorVersion.length > 80 ||
      !EXTRACTOR_VERSION_RE.test(value.extractorVersion)
    ) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
  }
  if (
    value.sourceContentHash !== undefined &&
    (typeof value.sourceContentHash !== "string" || !HEX_64.test(value.sourceContentHash))
  ) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (value.sourceObservedAt !== undefined && typeof value.sourceObservedAt !== "string") {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  return {
    ok: true,
    provenance: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      extractorVersion: typeof value.extractorVersion === "string" ? value.extractorVersion : undefined,
      sourceContentHash:
        typeof value.sourceContentHash === "string" ? value.sourceContentHash : undefined,
      sourceObservedAt: typeof value.sourceObservedAt === "string" ? value.sourceObservedAt : undefined,
      createdAt: value.createdAt,
    },
  };
}

function parseAssessment(
  value: unknown,
  requirementById: Map<string, SemanticEvidencePacketV1["requirements"][number]>,
  factsByRef: Map<string, EvidenceFact>,
):
  | { ok: true; assessment: RequirementEvidenceAssessment }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, ASSESSMENT_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.requirementId !== "string" || !requirementById.has(value.requirementId)) {
    return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
  }
  const requirement = requirementById.get(value.requirementId)!;
  if (
    typeof value.requiredEvidenceRefs !== "number" ||
    !Number.isInteger(value.requiredEvidenceRefs) ||
    value.requiredEvidenceRefs < 0
  ) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!isEnum(value.state, REQUIREMENT_EVIDENCE_STATES)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!isEnum(value.reasonCode, EVIDENCE_REASON_CODES)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (!Array.isArray(value.validEvidenceRefs) || value.validEvidenceRefs.length > MAX_FACTS_PER_REQUIREMENT) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const evidenceRef of value.validEvidenceRefs) {
    if (typeof evidenceRef !== "string" || !HEX_64.test(evidenceRef)) {
      return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
    }
    if (seen.has(evidenceRef)) return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
    seen.add(evidenceRef);
    const fact = factsByRef.get(evidenceRef);
    if (!fact) return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
    if (fact.requirementId !== value.requirementId) {
      return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
    }
    if (fact.countsTowardRequirement !== true) {
      return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
    }
    if (!requirement.evidenceKinds.includes(fact.evidenceKind)) {
      return fail("SEMANTIC_JUDGE_WRONG_EVIDENCE_KIND");
    }
    if (!isKnownPrivacyClass(fact.privacyClass) || !isJudgeEligiblePrivacyClass(fact.privacyClass)) {
      return fail("SEMANTIC_JUDGE_UNKNOWN_PRIVACY_CLASS");
    }
    if (fact.acceptance === "BLOCKED") {
      return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
    }
    refs.push(evidenceRef);
  }
  if (value.state === "READY") {
    const meetsMinimum = refs.length >= requirement.minimumEvidenceRefs;
    // P2.1 locked identity: optional + allowUnknown + zero refs is READY.
    const optionalUnknownReady =
      requirement.required === false &&
      requirement.allowUnknown === true &&
      refs.length === 0;
    if (!meetsMinimum && !optionalUnknownReady) {
      return fail("SEMANTIC_JUDGE_READY_ASSESSMENT_INVALID");
    }
  }
  return {
    ok: true,
    assessment: {
      requirementId: value.requirementId,
      requiredEvidenceRefs: value.requiredEvidenceRefs,
      validEvidenceRefs: refs,
      state: value.state,
      reasonCode: value.reasonCode,
    },
  };
}

function parseRejectedList(value: unknown):
  | { ok: true; rows: RejectedEvidence[] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!Array.isArray(value)) return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  const rows: RejectedEvidence[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || extraKeys(item, REJECTED_KEYS).length > 0) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    if (!isEnum(item.reasonCode, EVIDENCE_REASON_CODES)) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    rows.push({
      reasonCode: item.reasonCode,
      requirementId: typeof item.requirementId === "string" ? item.requirementId : undefined,
      factKey: typeof item.factKey === "string" ? item.factKey : undefined,
    });
  }
  return { ok: true, rows };
}

function parseDiagnosticList(value: unknown):
  | { ok: true; rows: SemanticEvidencePacketV1["diagnostics"][number][] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!Array.isArray(value)) return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  const rows: SemanticEvidencePacketV1["diagnostics"][number][] = [];
  for (const item of value) {
    if (!isPlainObject(item) || extraKeys(item, DIAGNOSTIC_KEYS).length > 0) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    if (!isEnum(item.code, EVIDENCE_REASON_CODES)) {
      return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
    }
    rows.push({
      code: item.code,
      detail: typeof item.detail === "string" ? item.detail : undefined,
    });
  }
  return { ok: true, rows };
}

function parsePrivacySummary(value: unknown):
  | { ok: true; summary: SemanticEvidencePacketV1["privacySummary"] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, PRIVACY_SUMMARY_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (typeof value.blocked !== "boolean") return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  if (!isNonNegInt(value.redactedCount) || !isNonNegInt(value.prohibitedCount)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  return {
    ok: true,
    summary: {
      blocked: value.blocked,
      redactedCount: value.redactedCount,
      prohibitedCount: value.prohibitedCount,
    },
  };
}

function parseProvenanceSummary(value: unknown):
  | { ok: true; summary: SemanticEvidencePacketV1["provenanceSummary"] }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!isPlainObject(value) || extraKeys(value, PROVENANCE_SUMMARY_KEYS).length > 0) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  if (value.collectorVersion !== A2P2_EVIDENCE_COLLECTOR_VERSION) {
    return fail("SEMANTIC_JUDGE_NOT_EVALUABLE");
  }
  if (!isNonNegInt(value.factCount) || !isNonNegInt(value.rejectedCount)) {
    return fail("SEMANTIC_JUDGE_MALFORMED_PACKET");
  }
  return {
    ok: true,
    summary: {
      collectorVersion: A2P2_EVIDENCE_COLLECTOR_VERSION,
      factCount: value.factCount,
      rejectedCount: value.rejectedCount,
    },
  };
}

function isSafeNormalizedValue(value: unknown): value is SafeNormalizedValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= SAFE_FACT_STRING_MAX;
  if (!Array.isArray(value) || value.length > 20) return false;
  return value.every(
    (item) =>
      item === null ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item)) ||
      (typeof item === "string" && item.length <= SAFE_FACT_STRING_MAX),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function fail(ruleId: SemanticJudgeRuleId): { ok: false; ruleId: SemanticJudgeRuleId } {
  return { ok: false, ruleId };
}
