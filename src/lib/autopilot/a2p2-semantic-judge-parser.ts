/**
 * Autopilot A2-P2.2 — strict closed parser for per-requirement proposals.
 *
 * One JSON object. No markdown fences, no extra prose, no unknown fields.
 * Deterministic parser remains authority even if a provider used jsonSchema.
 */

import { REQUIREMENT_ID_PATTERN } from "./a2p2-contract";
import {
  A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
  MAX_SEMANTIC_JUDGE_RATIONALE_CHARS,
  MODEL_FORBIDDEN_AUTHORITY_FIELDS,
  SEMANTIC_CONFIDENCES,
  SEMANTIC_JUDGMENTS,
  SEMANTIC_PROPOSAL_REASON_CODES,
  type ParsedRequirementProposal,
  type ParsedSemanticJudgeProposal,
  type SemanticConfidence,
  type SemanticJudgment,
  type SemanticJudgeRuleId,
  type SemanticProposalReasonCode,
} from "./a2p2-semantic-judge-types";

const PROPOSAL_KEYS = [
  "version",
  "packetHash",
  "judgeInputHash",
  "requirements",
] as const;

const REQUIREMENT_KEYS = [
  "requirementId",
  "judgment",
  "confidence",
  "evidenceRefs",
  "reasonCode",
  "rationale",
] as const;

const HEX_64 = /^[a-f0-9]{64}$/;
const MAX_EVIDENCE_REFS = 32;
const MAX_EVIDENCE_REF_LENGTH = 128;

export type ParseSemanticJudgeProposalResult =
  | { ok: true; proposal: ParsedSemanticJudgeProposal }
  | { ok: false; ruleId: SemanticJudgeRuleId };

export function parseSemanticJudgeProposal(
  text: unknown,
): ParseSemanticJudgeProposalResult {
  if (typeof text !== "string") {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  if (trimmed.includes("```") || /^```/m.test(trimmed)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_EXTRA_TEXT" };
  }
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_EXTRA_TEXT" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  const row = parsed as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.some((key) => !(PROPOSAL_KEYS as readonly string[]).includes(key))) {
    return { ok: false, ruleId: unknownFieldRule(keys) };
  }
  for (const key of PROPOSAL_KEYS) {
    if (!(key in row)) return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (row.version !== A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (typeof row.packetHash !== "string" || !HEX_64.test(row.packetHash)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (typeof row.judgeInputHash !== "string" || !HEX_64.test(row.judgeInputHash)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (!Array.isArray(row.requirements)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }

  const requirements: ParsedRequirementProposal[] = [];
  const seen = new Set<string>();
  for (const item of row.requirements) {
    const parsedRow = parseRequirementProposal(item);
    if (!parsedRow.ok) return parsedRow;
    if (seen.has(parsedRow.requirement.requirementId)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_DUPLICATE_REQUIREMENT" };
    }
    seen.add(parsedRow.requirement.requirementId);
    requirements.push(parsedRow.requirement);
  }

  return {
    ok: true,
    proposal: {
      version: A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
      packetHash: row.packetHash,
      judgeInputHash: row.judgeInputHash,
      requirements,
    },
  };
}

function parseRequirementProposal(
  value: unknown,
):
  | { ok: true; requirement: ParsedRequirementProposal }
  | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.some((key) => !(REQUIREMENT_KEYS as readonly string[]).includes(key))) {
    return { ok: false, ruleId: unknownFieldRule(keys) };
  }
  for (const key of REQUIREMENT_KEYS) {
    if (!(key in row)) return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (typeof row.requirementId !== "string" || !REQUIREMENT_ID_PATTERN.test(row.requirementId)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (!isEnum(row.judgment, SEMANTIC_JUDGMENTS)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_INVALID_ENUM" };
  }
  if (!isEnum(row.confidence, SEMANTIC_CONFIDENCES)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_INVALID_ENUM" };
  }
  if (!isEnum(row.reasonCode, SEMANTIC_PROPOSAL_REASON_CODES)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_INVALID_ENUM" };
  }
  if (typeof row.rationale !== "string" || row.rationale.length > MAX_SEMANTIC_JUDGE_RATIONALE_CHARS) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  const refs = parseEvidenceRefs(row.evidenceRefs);
  if (!refs.ok) return refs;

  return {
    ok: true,
    requirement: {
      requirementId: row.requirementId,
      judgment: row.judgment,
      confidence: row.confidence,
      evidenceRefs: refs.refs,
      reasonCode: row.reasonCode,
      rationale: row.rationale,
    },
  };
}

function parseEvidenceRefs(
  value: unknown,
): { ok: true; refs: string[] } | { ok: false; ruleId: SemanticJudgeRuleId } {
  if (!Array.isArray(value)) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  if (value.length > MAX_EVIDENCE_REFS) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length < 1 || item.length > MAX_EVIDENCE_REF_LENGTH) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED" };
    }
    if (seen.has(item)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_DUPLICATE_EVIDENCE_REF" };
    }
    seen.add(item);
    refs.push(item);
  }
  return { ok: true, refs };
}

function unknownFieldRule(keys: readonly string[]): SemanticJudgeRuleId {
  if (keys.some((key) => (MODEL_FORBIDDEN_AUTHORITY_FIELDS as readonly string[]).includes(key))) {
    return "SEMANTIC_JUDGE_UNKNOWN_FIELD";
  }
  return "SEMANTIC_JUDGE_UNKNOWN_FIELD";
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function isSemanticJudgment(value: unknown): value is SemanticJudgment {
  return isEnum(value, SEMANTIC_JUDGMENTS);
}

export function isSemanticConfidence(value: unknown): value is SemanticConfidence {
  return isEnum(value, SEMANTIC_CONFIDENCES);
}

export function isSemanticProposalReasonCode(
  value: unknown,
): value is SemanticProposalReasonCode {
  return isEnum(value, SEMANTIC_PROPOSAL_REASON_CODES);
}
