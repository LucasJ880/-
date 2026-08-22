/**
 * Autopilot A2-P2.2 — Judge-safe input projection and pre-provider gates.
 *
 * Verifies packet integrity, contract binding, privacy, injection, and
 * byte limits. Does not call a model.
 */

import {
  FORBIDDEN_CONTRACT_FIELD_NAMES,
  isJudgeEligiblePrivacyClass,
  type EvaluationEvidenceKind,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import { canonicalJson, hashEvidencePacket, sha256Hex } from "./a2p2-evidence-hash";
import {
  containsSecretMaterial,
  containsUnsafeMarkup,
  FORBIDDEN_EVIDENCE_FIELD_NAMES,
  redactPiiText,
} from "./a2p2-evidence-privacy";
import {
  A2P2_EVIDENCE_PACKET_VERSION,
  type EvidenceFact,
  type SemanticEvidencePacketV1,
} from "./a2p2-evidence-types";
import {
  A2P2_SEMANTIC_JUDGE_INPUT_VERSION,
  A2P2_SEMANTIC_JUDGE_PROMPT_VERSION,
  A2P2_SEMANTIC_JUDGE_VERSION,
  MAX_SEMANTIC_JUDGE_INPUT_BYTES,
  type JudgeSafeEvidenceFact,
  type JudgeSafeRequirement,
  type SemanticJudgeFacingInput,
  type SemanticJudgeRuleId,
} from "./a2p2-semantic-judge-types";

const INJECTION_NEEDLES = [
  "ignore previous instructions",
  "ignore all previous",
  "system prompt",
  "developer message",
  "assistant:",
  "<system",
  "<assistant",
  '"role":"system"',
  "'role':'system'",
  "tool call instructions",
] as const;

const RAW_MARKERS = [
  ...FORBIDDEN_CONTRACT_FIELD_NAMES,
  ...FORBIDDEN_EVIDENCE_FIELD_NAMES,
] as const;

export type PrepareSemanticJudgeInputSuccess = {
  ok: true;
  packet: SemanticEvidencePacketV1;
  facing: SemanticJudgeFacingInput;
  serialized: string;
  byteLength: number;
};

export type PrepareSemanticJudgeInputFailure = {
  ok: false;
  ruleId: SemanticJudgeRuleId;
  packetHash?: string;
};

export type PrepareSemanticJudgeInputResult =
  | PrepareSemanticJudgeInputSuccess
  | PrepareSemanticJudgeInputFailure;

export function verifyEvidencePacketHash(packet: SemanticEvidencePacketV1): boolean {
  return packet.packetHash === hashEvidencePacket(packet);
}

export function judgeInputExceedsLimit(serialized: string): boolean {
  return Buffer.byteLength(serialized, "utf8") > MAX_SEMANTIC_JUDGE_INPUT_BYTES;
}

export function serializedJudgeInputBytes(serialized: string): number {
  return Buffer.byteLength(serialized, "utf8");
}

export function detectPromptInjectionLikeText(value: unknown): boolean {
  for (const text of collectStrings(value)) {
    const lower = text.toLowerCase();
    const compact = lower.replace(/\s+/g, "");
    for (const needle of INJECTION_NEEDLES) {
      if (lower.includes(needle)) return true;
      if (compact.includes(needle.replace(/\s+/g, ""))) return true;
    }
  }
  return false;
}

export function hashSemanticJudgeInput(
  unsigned: Omit<SemanticJudgeFacingInput, "judgeInputHash">,
): string {
  return sha256Hex(canonicalJson(stabilizeUnsigned(unsigned)));
}

export function serializeSemanticJudgeInput(facing: SemanticJudgeFacingInput): string {
  const { judgeInputHash, ...rest } = facing;
  return canonicalJson({
    ...stabilizeUnsigned(rest),
    judgeInputHash,
  });
}

function stabilizeUnsigned(
  unsigned: Omit<SemanticJudgeFacingInput, "judgeInputHash">,
): Omit<SemanticJudgeFacingInput, "judgeInputHash"> {
  return {
    ...unsigned,
    requirements: stableRequirements(unsigned.requirements),
    evidenceFacts: stableFacts(unsigned.evidenceFacts),
  };
}

export function prepareSemanticJudgeInput(input: {
  contract: ValidatedTaskContract;
  evidencePacket: unknown;
}): PrepareSemanticJudgeInputResult {
  const packet = asEvidencePacket(input.evidencePacket);
  if (!packet) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_NOT_EVALUABLE" };
  }
  if (packet.version !== A2P2_EVIDENCE_PACKET_VERSION) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_NOT_EVALUABLE", packetHash: packet.packetHash };
  }

  const eligibility = packetEligibilityRule(packet, input.contract);
  if (eligibility) {
    return { ok: false, ruleId: eligibility, packetHash: packet.packetHash };
  }

  if (!verifyEvidencePacketHash(packet)) {
    return {
      ok: false,
      ruleId: "SEMANTIC_JUDGE_PACKET_HASH_MISMATCH",
      packetHash: packet.packetHash,
    };
  }

  const binding = contractPacketBindingRule(input.contract, packet);
  if (binding) {
    return { ok: false, ruleId: binding, packetHash: packet.packetHash };
  }

  const spec = buildJudgeTaskSpec(input.contract);
  if (!spec.ok) {
    return { ok: false, ruleId: spec.ruleId, packetHash: packet.packetHash };
  }

  const facts = buildJudgeEvidenceFacts(packet);
  const unsigned = {
    version: A2P2_SEMANTIC_JUDGE_INPUT_VERSION,
    judgeVersion: A2P2_SEMANTIC_JUDGE_VERSION,
    promptVersion: A2P2_SEMANTIC_JUDGE_PROMPT_VERSION,
    packetHash: packet.packetHash,
    taskType: packet.taskType,
    requirements: stableRequirements(spec.requirements),
    evidenceFacts: stableFacts(facts),
  };
  const semanticView = {
    requirements: unsigned.requirements,
    evidenceFacts: unsigned.evidenceFacts,
  };
  if (detectPromptInjectionLikeText(semanticView)) {
    return {
      ok: false,
      ruleId: "SEMANTIC_JUDGE_PROMPT_INJECTION",
      packetHash: packet.packetHash,
    };
  }

  const judgeInputHash = hashSemanticJudgeInput(unsigned);
  const facing: SemanticJudgeFacingInput = { ...unsigned, judgeInputHash };
  const serialized = serializeSemanticJudgeInput(facing);
  const byteLength = serializedJudgeInputBytes(serialized);
  if (judgeInputExceedsLimit(serialized)) {
    return {
      ok: false,
      ruleId: "SEMANTIC_JUDGE_INPUT_LIMIT_EXCEEDED",
      packetHash: packet.packetHash,
    };
  }

  return { ok: true, packet, facing, serialized, byteLength };
}

function asEvidencePacket(value: unknown): SemanticEvidencePacketV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<SemanticEvidencePacketV1>;
  if (typeof row.version !== "string") return null;
  if (typeof row.packetHash !== "string") return null;
  if (typeof row.taskType !== "string") return null;
  if (!row.contract || typeof row.contract !== "object") return null;
  if (!Array.isArray(row.requirements)) return null;
  if (!Array.isArray(row.evidenceFacts)) return null;
  if (!Array.isArray(row.requirementAssessments)) return null;
  if (!Array.isArray(row.rejectedFacts)) return null;
  if (!Array.isArray(row.diagnostics)) return null;
  if (!row.privacySummary || typeof row.privacySummary !== "object") return null;
  if (!row.provenanceSummary || typeof row.provenanceSummary !== "object") return null;
  if (typeof row.status !== "string") return null;
  return value as SemanticEvidencePacketV1;
}

function packetEligibilityRule(
  packet: SemanticEvidencePacketV1,
  contract: ValidatedTaskContract,
): SemanticJudgeRuleId | null {
  if (packet.privacySummary.blocked === true || packet.privacySummary.prohibitedCount > 0) {
    return "SEMANTIC_JUDGE_PRIVACY_BLOCKED";
  }
  if (packet.status === "PRIVACY_BLOCKED") return "SEMANTIC_JUDGE_PRIVACY_BLOCKED";
  if (packet.status === "CONFLICTING") return "SEMANTIC_JUDGE_CONFLICTING_PACKET";
  if (packet.status === "INSUFFICIENT") return "SEMANTIC_JUDGE_INSUFFICIENT_PACKET";
  if (packet.status === "NOT_EVALUABLE") return "SEMANTIC_JUDGE_NOT_EVALUABLE";
  if (packet.status !== "SUFFICIENT") return "SEMANTIC_JUDGE_NOT_EVALUABLE";

  for (const requirement of contract.requirements) {
    if (!requirement.required) continue;
    const assessment = packet.requirementAssessments.find(
      (item) => item.requirementId === requirement.id,
    );
    if (!assessment || assessment.state !== "READY") {
      return "SEMANTIC_JUDGE_NOT_EVALUABLE";
    }
  }
  return null;
}

function contractPacketBindingRule(
  contract: ValidatedTaskContract,
  packet: SemanticEvidencePacketV1,
): SemanticJudgeRuleId | null {
  if (contract.taskType !== packet.taskType || packet.contract.taskType !== contract.taskType) {
    return "SEMANTIC_JUDGE_CONTRACT_TASK_TYPE_MISMATCH";
  }
  if (packet.contract.riskClass !== contract.riskClass) {
    return "SEMANTIC_JUDGE_CONTRACT_RISK_MISMATCH";
  }
  if (packet.contract.automationLevel !== contract.automationLevel) {
    return "SEMANTIC_JUDGE_CONTRACT_AUTOMATION_MISMATCH";
  }
  if (
    packet.contract.requirementCount !== contract.requirements.length ||
    packet.requirements.length !== contract.requirements.length
  ) {
    return "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH";
  }

  const packetById = new Map(packet.requirements.map((item) => [item.id, item]));
  if (packetById.size !== packet.requirements.length) {
    return "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH";
  }
  for (const requirement of contract.requirements) {
    const row = packetById.get(requirement.id);
    if (!row) return "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH";
    if (row.required !== requirement.required) {
      return "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH";
    }
    if (row.allowUnknown !== requirement.allowUnknown) {
      return "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH";
    }
    if (row.minimumEvidenceRefs !== requirement.minimumEvidenceRefs) {
      return "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH";
    }
    if (!sameKinds(row.evidenceKinds, requirement.evidenceKinds)) {
      return "SEMANTIC_JUDGE_CONTRACT_REQUIREMENT_MISMATCH";
    }
  }
  return null;
}

function sameKinds(
  left: readonly string[],
  right: readonly EvaluationEvidenceKind[],
): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

function buildJudgeTaskSpec(
  contract: ValidatedTaskContract,
): { ok: true; requirements: JudgeSafeRequirement[] } | { ok: false; ruleId: SemanticJudgeRuleId } {
  const requirements: JudgeSafeRequirement[] = [];
  for (const requirement of contract.requirements) {
    const description = requirement.normalizedDescription;
    if (containsSecretMaterial(description)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_SECRET_IN_TASK_SPEC" };
    }
    if (containsUnsafeMarkup(description)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_HTML_IN_TASK_SPEC" };
    }
    if (containsRawContentMarker(description)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_RAW_CONTENT_IN_TASK_SPEC" };
    }
    const redacted = redactPiiText(description);
    requirements.push({
      requirementId: requirement.id,
      normalizedDescription: redacted.text,
      required: requirement.required,
      criticality: requirement.criticality,
      allowUnknown: requirement.allowUnknown,
      minimumEvidenceRefs: requirement.minimumEvidenceRefs,
      evidenceKinds: [...requirement.evidenceKinds],
    });
  }
  return { ok: true, requirements };
}

function containsRawContentMarker(text: string): boolean {
  const lower = text.toLowerCase();
  for (const marker of RAW_MARKERS) {
    const token = marker.toLowerCase();
    const pattern = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(token)}([^a-z0-9_]|$)`, "i");
    if (pattern.test(lower)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildJudgeEvidenceFacts(packet: SemanticEvidencePacketV1): JudgeSafeEvidenceFact[] {
  const factsByRef = new Map(packet.evidenceFacts.map((fact) => [fact.evidenceRef, fact]));
  const seen = new Set<string>();
  const out: JudgeSafeEvidenceFact[] = [];
  for (const assessment of packet.requirementAssessments) {
    for (const evidenceRef of assessment.validEvidenceRefs) {
      if (seen.has(evidenceRef)) continue;
      const fact = factsByRef.get(evidenceRef);
      if (!fact) continue;
      if (!isJudgeEligibleFact(fact, assessment.requirementId)) continue;
      seen.add(evidenceRef);
      out.push({
        evidenceRef: fact.evidenceRef,
        requirementId: fact.requirementId,
        evidenceKind: fact.evidenceKind,
        factKey: fact.factKey,
        factSummary: fact.factSummary,
        normalizedValue: fact.normalizedValue,
      });
    }
  }
  return out;
}

function isJudgeEligibleFact(fact: EvidenceFact, requirementId: string): boolean {
  if (fact.requirementId !== requirementId) return false;
  if (fact.countsTowardRequirement !== true) return false;
  if (fact.acceptance === "BLOCKED") return false;
  if (!isJudgeEligiblePrivacyClass(fact.privacyClass)) return false;
  return true;
}

function stableRequirements(
  requirements: readonly JudgeSafeRequirement[],
): JudgeSafeRequirement[] {
  return [...requirements]
    .sort((a, b) => a.requirementId.localeCompare(b.requirementId))
    .map((item) => ({
      ...item,
      evidenceKinds: [...item.evidenceKinds].sort(),
    }));
}

function stableFacts(facts: readonly JudgeSafeEvidenceFact[]): JudgeSafeEvidenceFact[] {
  return [...facts].sort(
    (a, b) =>
      a.evidenceRef.localeCompare(b.evidenceRef) || a.requirementId.localeCompare(b.requirementId),
  );
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectStrings(child, out);
    }
  }
  return out;
}
