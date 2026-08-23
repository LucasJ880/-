/**
 * Autopilot A2-P2.2 — deterministic proposal acceptance and aggregation.
 *
 * The model never chooses global outcome or verdictState.
 * Rationale is display metadata and must not affect acceptance.
 */

import {
  canClaimSemanticSuccess,
  type EvaluationOutcomeHint,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import { canonicalJson, sha256Hex } from "./a2p2-evidence-hash";
import type { SemanticEvidencePacketV1 } from "./a2p2-evidence-types";
import type {
  ParsedRequirementProposal,
  ParsedSemanticJudgeProposal,
  SemanticConfidence,
  SemanticJudgeFacingInput,
  SemanticJudgeRuleId,
  SemanticJudgment,
} from "./a2p2-semantic-judge-types";

export type SemanticGateAccept = {
  ok: true;
  outcome: EvaluationOutcomeHint;
  verdictState: "ACCEPTED" | "ABSTAINED";
  proposalStatus: "VALID" | "ABSTAINED";
  ruleId: SemanticJudgeRuleId;
  proposalHash: string;
  requirementJudgments: readonly ParsedRequirementProposal[];
};

export type SemanticGateReject = {
  ok: false;
  ruleId: SemanticJudgeRuleId;
  proposalHash?: string;
};

export type SemanticGateResult = SemanticGateAccept | SemanticGateReject;

export function hashSemanticJudgeProposal(
  proposal: ParsedSemanticJudgeProposal,
): string {
  const canonical = {
    version: proposal.version,
    packetHash: proposal.packetHash,
    judgeInputHash: proposal.judgeInputHash,
    requirements: [...proposal.requirements]
      .sort((a, b) => a.requirementId.localeCompare(b.requirementId))
      .map((item) => ({
        requirementId: item.requirementId,
        judgment: item.judgment,
        confidence: item.confidence,
        evidenceRefs: [...item.evidenceRefs].sort(),
        reasonCode: item.reasonCode,
        rationale: item.rationale,
      })),
  };
  return sha256Hex(canonicalJson(canonical));
}

export function aggregateSemanticOutcome(
  required: readonly {
    judgment: SemanticJudgment;
    confidence: SemanticConfidence;
  }[],
): EvaluationOutcomeHint {
  if (required.length === 0) return "UNKNOWN";
  if (required.some((item) => item.judgment === "UNKNOWN")) return "UNKNOWN";
  if (required.some((item) => item.confidence !== "high")) return "UNKNOWN";
  if (required.some((item) => item.judgment === "NOT_SATISFIED")) return "FAILURE";
  if (required.some((item) => item.judgment === "PARTIAL")) return "PARTIAL_SUCCESS";
  if (required.every((item) => item.judgment === "SATISFIED")) return "TASK_SUCCESS";
  return "UNKNOWN";
}

export function acceptSemanticProposal(input: {
  contract: ValidatedTaskContract;
  packet: SemanticEvidencePacketV1;
  facing: SemanticJudgeFacingInput;
  proposal: ParsedSemanticJudgeProposal;
}): SemanticGateResult {
  const proposalHash = hashSemanticJudgeProposal(input.proposal);
  if (input.proposal.packetHash !== input.facing.packetHash) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_PACKET_HASH_ECHO_MISMATCH", proposalHash };
  }
  if (input.proposal.judgeInputHash !== input.facing.judgeInputHash) {
    return { ok: false, ruleId: "SEMANTIC_JUDGE_INPUT_HASH_ECHO_MISMATCH", proposalHash };
  }

  const coverage = coverageRule(input.contract, input.proposal);
  if (coverage) return { ok: false, ruleId: coverage, proposalHash };

  const byId = new Map(
    input.proposal.requirements.map((item) => [item.requirementId, item]),
  );
  for (const requirement of input.contract.requirements) {
    const row = byId.get(requirement.id);
    if (!row) return { ok: false, ruleId: "SEMANTIC_JUDGE_MISSING_REQUIREMENT", proposalHash };
    const grounded = groundingRule(requirement.id, requirement.minimumEvidenceRefs, row, input.facing);
    if (grounded) return { ok: false, ruleId: grounded, proposalHash };
  }

  const requiredRows = input.contract.requirements
    .filter((item) => item.required)
    .map((item) => byId.get(item.id)!)
    .map((item) => ({ judgment: item.judgment, confidence: item.confidence }));
  const outcome = aggregateSemanticOutcome(requiredRows);

  if (outcome === "TASK_SUCCESS") {
    if (!taskSuccessHardGate(input.contract, input.packet, requiredRows)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_SUCCESS_GATE_FAILED", proposalHash };
    }
    return {
      ok: true,
      outcome: "TASK_SUCCESS",
      verdictState: "ACCEPTED",
      proposalStatus: "VALID",
      ruleId: "SEMANTIC_JUDGE_ACCEPTED_TASK_SUCCESS",
      proposalHash,
      requirementJudgments: input.proposal.requirements,
    };
  }

  if (outcome === "PARTIAL_SUCCESS") {
    if (!partialSuccessHardGate(requiredRows)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED", proposalHash };
    }
    return {
      ok: true,
      outcome: "PARTIAL_SUCCESS",
      verdictState: "ACCEPTED",
      proposalStatus: "VALID",
      ruleId: "SEMANTIC_JUDGE_ACCEPTED_PARTIAL_SUCCESS",
      proposalHash,
      requirementJudgments: input.proposal.requirements,
    };
  }

  if (outcome === "FAILURE") {
    if (!failureHardGate(requiredRows)) {
      return { ok: false, ruleId: "SEMANTIC_JUDGE_PROPOSAL_REJECTED", proposalHash };
    }
    return {
      ok: true,
      outcome: "FAILURE",
      verdictState: "ACCEPTED",
      proposalStatus: "VALID",
      ruleId: "SEMANTIC_JUDGE_ACCEPTED_FAILURE",
      proposalHash,
      requirementJudgments: input.proposal.requirements,
    };
  }

  return {
    ok: true,
    outcome: "UNKNOWN",
    verdictState: "ABSTAINED",
    proposalStatus: "ABSTAINED",
    ruleId: "SEMANTIC_JUDGE_ABSTAINED",
    proposalHash,
    requirementJudgments: input.proposal.requirements,
  };
}

function coverageRule(
  contract: ValidatedTaskContract,
  proposal: ParsedSemanticJudgeProposal,
): SemanticJudgeRuleId | null {
  const expected = contract.requirements.map((item) => item.id);
  const got = proposal.requirements.map((item) => item.requirementId);
  if (got.length !== expected.length) {
    const extra = got.filter((id) => !expected.includes(id));
    if (extra.length > 0) return "SEMANTIC_JUDGE_UNKNOWN_REQUIREMENT";
    return "SEMANTIC_JUDGE_MISSING_REQUIREMENT";
  }
  const expectedSet = new Set(expected);
  const gotSet = new Set(got);
  if (gotSet.size !== got.length) return "SEMANTIC_JUDGE_DUPLICATE_REQUIREMENT";
  for (const id of expectedSet) {
    if (!gotSet.has(id)) return "SEMANTIC_JUDGE_MISSING_REQUIREMENT";
  }
  for (const id of gotSet) {
    if (!expectedSet.has(id)) return "SEMANTIC_JUDGE_UNKNOWN_REQUIREMENT";
  }
  return null;
}

function groundingRule(
  requirementId: string,
  minimumEvidenceRefs: number,
  row: ParsedRequirementProposal,
  facing: SemanticJudgeFacingInput,
): SemanticJudgeRuleId | null {
  const allowed = new Set(
    facing.evidenceFacts
      .filter((fact) => fact.requirementId === requirementId)
      .map((fact) => fact.evidenceRef),
  );
  const seen = new Set<string>();
  for (const evidenceRef of row.evidenceRefs) {
    if (seen.has(evidenceRef)) return "SEMANTIC_JUDGE_DUPLICATE_EVIDENCE_REF";
    seen.add(evidenceRef);
    const fact = facing.evidenceFacts.find((item) => item.evidenceRef === evidenceRef);
    if (!fact) return "SEMANTIC_JUDGE_UNKNOWN_EVIDENCE_REF";
    if (fact.requirementId !== requirementId || !allowed.has(evidenceRef)) {
      return "SEMANTIC_JUDGE_CROSS_REQUIREMENT_EVIDENCE_REF";
    }
  }
  if (row.judgment === "UNKNOWN") return null;
  if (row.evidenceRefs.length < minimumEvidenceRefs) {
    if (row.judgment === "SATISFIED") return "SEMANTIC_JUDGE_UNGROUNDED_SATISFIED";
    if (row.judgment === "PARTIAL") return "SEMANTIC_JUDGE_UNGROUNDED_PARTIAL";
    return "SEMANTIC_JUDGE_UNGROUNDED_NOT_SATISFIED";
  }
  return null;
}

function taskSuccessHardGate(
  contract: ValidatedTaskContract,
  packet: SemanticEvidencePacketV1,
  required: readonly { judgment: SemanticJudgment; confidence: SemanticConfidence }[],
): boolean {
  if (packet.status !== "SUFFICIENT") return false;
  if (!canClaimSemanticSuccess(contract, "TASK_SUCCESS")) return false;
  if (required.length === 0) return false;
  return required.every(
    (item) => item.judgment === "SATISFIED" && item.confidence === "high",
  );
}

function partialSuccessHardGate(
  required: readonly { judgment: SemanticJudgment; confidence: SemanticConfidence }[],
): boolean {
  if (required.length === 0) return false;
  if (required.some((item) => item.judgment === "UNKNOWN")) return false;
  if (required.some((item) => item.judgment === "NOT_SATISFIED")) return false;
  if (required.some((item) => item.confidence !== "high")) return false;
  if (!required.some((item) => item.judgment === "PARTIAL")) return false;
  return required.every(
    (item) => item.judgment === "PARTIAL" || item.judgment === "SATISFIED",
  );
}

function failureHardGate(
  required: readonly { judgment: SemanticJudgment; confidence: SemanticConfidence }[],
): boolean {
  if (required.some((item) => item.judgment === "UNKNOWN")) return false;
  if (required.some((item) => item.confidence !== "high")) return false;
  return required.some((item) => item.judgment === "NOT_SATISFIED");
}
