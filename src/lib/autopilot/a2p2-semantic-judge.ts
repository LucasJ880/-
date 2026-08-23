/**
 * Autopilot A2-P2.2 — Grounded Semantic Judge entrypoint.
 *
 * LLM proposes. Deterministic code decides.
 * Injected provider seam only. No Production runtime caller.
 * Maximum one provider call per invocation. No retry loop.
 */

import {
  canClaimSemanticSuccess,
  parseTaskContract,
  type EvaluationOutcomeHint,
  type EvaluationVerdictState,
} from "./a2p2-contract";
import { prepareSemanticJudgeInput } from "./a2p2-semantic-judge-input";
import { acceptSemanticProposal } from "./a2p2-semantic-judge-gate";
import { parseSemanticJudgeProposal } from "./a2p2-semantic-judge-parser";
import { A2P2_SEMANTIC_JUDGE_SYSTEM_PROMPT } from "./a2p2-semantic-judge-prompt";
import {
  A2P2_SEMANTIC_JUDGE_PROMPT_VERSION,
  A2P2_SEMANTIC_JUDGE_VERSION,
  MAX_SEMANTIC_JUDGE_REQUIREMENTS,
  SEMANTIC_JUDGE_PROPOSAL_JSON_SCHEMA,
  SEMANTIC_JUDGE_TOOL_COUNT,
  type SemanticJudgeBudgetState,
  type SemanticJudgeDecision,
  type SemanticJudgeProviderRequest,
  type SemanticJudgeRuleId,
  type SemanticJudgeRunInput,
} from "./a2p2-semantic-judge-types";

export {
  A2P2_SEMANTIC_JUDGE_INPUT_VERSION,
  A2P2_SEMANTIC_JUDGE_PROMPT_VERSION,
  A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
  A2P2_SEMANTIC_JUDGE_VERSION,
  MAX_SEMANTIC_JUDGE_INPUT_BYTES,
  MAX_SEMANTIC_JUDGE_OUTPUT_BYTES,
  SEMANTIC_JUDGE_TOOL_COUNT,
} from "./a2p2-semantic-judge-types";

export async function runSemanticJudge(
  input: SemanticJudgeRunInput,
): Promise<SemanticJudgeDecision> {
  const parsed = parseTaskContract(input.taskContract);
  if (!parsed.ok) {
    return skipped("SEMANTIC_JUDGE_UNVALIDATED_CONTRACT");
  }
  const contract = parsed.contract;
  if (contract.requirements.length === 0) {
    return skipped("SEMANTIC_JUDGE_GENERIC_EMPTY");
  }
  if (contract.requirements.length > MAX_SEMANTIC_JUDGE_REQUIREMENTS) {
    return skipped("SEMANTIC_JUDGE_REQUIREMENT_LIMIT_EXCEEDED");
  }

  const budgetRule = budgetPreflight(contract.evaluationBudget, input.budgetState);
  if (budgetRule) return skipped(budgetRule);

  const prepared = prepareSemanticJudgeInput({
    contract,
    evidencePacket: input.evidencePacket,
  });
  if (!prepared.ok) {
    return skipped(prepared.ruleId, { packetHash: prepared.packetHash ?? null });
  }

  if (SEMANTIC_JUDGE_TOOL_COUNT !== 0) {
    return skipped("SEMANTIC_JUDGE_PROPOSAL_REJECTED", {
      packetHash: prepared.facing.packetHash,
      judgeInputHash: prepared.facing.judgeInputHash,
    });
  }

  const request: SemanticJudgeProviderRequest = {
    systemPrompt: A2P2_SEMANTIC_JUDGE_SYSTEM_PROMPT,
    userContent: prepared.serialized,
    tools: [],
    toolChoice: "none",
    jsonSchema: SEMANTIC_JUDGE_PROPOSAL_JSON_SCHEMA,
  };

  let providerText: string;
  try {
    const result = await input.provider(request);
    if (!result || typeof result.text !== "string") {
      return unavailable(prepared.facing.packetHash, prepared.facing.judgeInputHash);
    }
    providerText = result.text;
  } catch {
    return unavailable(prepared.facing.packetHash, prepared.facing.judgeInputHash);
  }

  const parsedProposal = parseSemanticJudgeProposal(providerText);
  if (!parsedProposal.ok) {
    return {
      ...baseDecision({
        packetHash: prepared.facing.packetHash,
        judgeInputHash: prepared.facing.judgeInputHash,
      }),
      providerStatus: "RETURNED",
      proposalStatus: "REJECTED",
      ruleId: parsedProposal.ruleId,
    };
  }

  const accepted = acceptSemanticProposal({
    contract,
    packet: prepared.packet,
    facing: prepared.facing,
    proposal: parsedProposal.proposal,
  });
  if (!accepted.ok) {
    return {
      ...baseDecision({
        packetHash: prepared.facing.packetHash,
        judgeInputHash: prepared.facing.judgeInputHash,
        proposalHash: accepted.proposalHash,
      }),
      providerStatus: "RETURNED",
      proposalStatus: "REJECTED",
      ruleId: accepted.ruleId,
    };
  }

  if (
    accepted.outcome === "TASK_SUCCESS" &&
    !canClaimSemanticSuccess(contract, accepted.outcome)
  ) {
    return {
      ...baseDecision({
        packetHash: prepared.facing.packetHash,
        judgeInputHash: prepared.facing.judgeInputHash,
        proposalHash: accepted.proposalHash,
      }),
      providerStatus: "RETURNED",
      proposalStatus: "REJECTED",
      ruleId: "SEMANTIC_JUDGE_SUCCESS_GATE_FAILED",
    };
  }

  return {
    judgeVersion: A2P2_SEMANTIC_JUDGE_VERSION,
    promptVersion: A2P2_SEMANTIC_JUDGE_PROMPT_VERSION,
    packetHash: prepared.facing.packetHash,
    judgeInputHash: prepared.facing.judgeInputHash,
    proposalHash: accepted.proposalHash,
    providerStatus: "RETURNED",
    proposalStatus: accepted.proposalStatus,
    requirementJudgments: accepted.requirementJudgments,
    outcome: accepted.outcome,
    verdictState: accepted.verdictState,
    ruleId: accepted.ruleId,
    failureType: null,
  };
}

export function toP2EvaluationState(decision: SemanticJudgeDecision): {
  verdictState: EvaluationVerdictState;
  outcome: EvaluationOutcomeHint;
} {
  if (decision.verdictState === "ACCEPTED") {
    return { verdictState: "ACCEPTED", outcome: decision.outcome };
  }
  if (decision.verdictState === "ABSTAINED") {
    return { verdictState: "ABSTAINED", outcome: "UNKNOWN" };
  }
  return { verdictState: "NOT_EVALUATED", outcome: "UNKNOWN" };
}

function budgetPreflight(
  budget: { maxJudgeCalls: number; maxCostUsd: number },
  used: SemanticJudgeBudgetState,
): SemanticJudgeRuleId | null {
  if (
    !Number.isFinite(used.judgeCallsUsed) ||
    used.judgeCallsUsed < 0 ||
    !Number.isFinite(used.costUsdUsed) ||
    used.costUsdUsed < 0
  ) {
    return "SEMANTIC_JUDGE_BUDGET_EXHAUSTED";
  }
  if (used.judgeCallsUsed >= budget.maxJudgeCalls) {
    return "SEMANTIC_JUDGE_BUDGET_EXHAUSTED";
  }
  if (used.costUsdUsed >= budget.maxCostUsd) {
    return "SEMANTIC_JUDGE_COST_BUDGET_EXHAUSTED";
  }
  return null;
}

function skipped(
  ruleId: SemanticJudgeRuleId,
  extra?: { packetHash?: string | null; judgeInputHash?: string | null },
): SemanticJudgeDecision {
  return {
    ...baseDecision({
      packetHash: extra?.packetHash ?? null,
      judgeInputHash: extra?.judgeInputHash ?? null,
    }),
    providerStatus: "NOT_CALLED",
    proposalStatus: "REJECTED",
    ruleId,
  };
}

function unavailable(
  packetHash: string,
  judgeInputHash: string,
): SemanticJudgeDecision {
  return {
    ...baseDecision({ packetHash, judgeInputHash }),
    providerStatus: "UNAVAILABLE",
    proposalStatus: "REJECTED",
    ruleId: "SEMANTIC_JUDGE_PROVIDER_UNAVAILABLE",
  };
}

function baseDecision(extra: {
  packetHash: string | null;
  judgeInputHash: string | null;
  proposalHash?: string;
}): Omit<SemanticJudgeDecision, "providerStatus" | "proposalStatus" | "ruleId"> {
  return {
    judgeVersion: A2P2_SEMANTIC_JUDGE_VERSION,
    promptVersion: A2P2_SEMANTIC_JUDGE_PROMPT_VERSION,
    packetHash: extra.packetHash,
    judgeInputHash: extra.judgeInputHash,
    proposalHash: extra.proposalHash,
    requirementJudgments: [],
    outcome: "UNKNOWN",
    verdictState: "NOT_EVALUATED",
    failureType: null,
  };
}
