/**
 * Shared fixtures for A2-P2.2 Grounded Semantic Judge tests.
 */

import { hashEvidencePacket } from "../a2p2-evidence-hash";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import type { SemanticEvidencePacketV1 } from "../a2p2-evidence-types";
import { resolveTaskContract } from "../a2p2-templates";
import type { ValidatedTaskContract } from "../a2p2-contract";
import { A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION } from "../a2p2-semantic-judge-types";
import type {
  SemanticJudgeFacingInput,
  SemanticJudgeProvider,
  SemanticJudgeProviderRequest,
} from "../a2p2-semantic-judge-types";
import { makeAnalysisResultV2 } from "./a2p2-evidence-fixtures";

export const NOW = new Date("2026-01-01T00:00:00.000Z");
export const ZERO_BUDGET = { judgeCallsUsed: 0, costUsdUsed: 0 };

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function tenderContract(): ValidatedTaskContract {
  return resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
}

export function tenderReady(): {
  contract: ValidatedTaskContract;
  packet: SemanticEvidencePacketV1;
} {
  const contract = tenderContract();
  const packet = buildEvidencePacket({
    contract,
    structuredSources: { tender: makeAnalysisResultV2() },
    now: NOW,
  });
  return { contract, packet };
}

export function rehashPacket(
  packet: SemanticEvidencePacketV1,
): SemanticEvidencePacketV1 {
  const next = cloneJson(packet);
  next.packetHash = hashEvidencePacket(next);
  return next;
}

export function countingProvider(inner: SemanticJudgeProvider): {
  provider: SemanticJudgeProvider;
  calls: () => number;
  lastRequest: () => SemanticJudgeProviderRequest | null;
} {
  let calls = 0;
  let lastRequest: SemanticJudgeProviderRequest | null = null;
  return {
    provider: async (request) => {
      calls += 1;
      lastRequest = request;
      return inner(request);
    },
    calls: () => calls,
    lastRequest: () => lastRequest,
  };
}

export type ProposalMutator = (
  proposal: Record<string, unknown> & {
    requirements: Array<Record<string, unknown>>;
  },
  facing: SemanticJudgeFacingInput,
) => void;

export function proposalFromRequest(
  request: SemanticJudgeProviderRequest,
  mutate?: ProposalMutator,
): Record<string, unknown> {
  const facing = JSON.parse(request.userContent) as SemanticJudgeFacingInput;
  const proposal = {
    version: A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
    packetHash: facing.packetHash,
    judgeInputHash: facing.judgeInputHash,
    requirements: facing.requirements.map((requirement) => {
      const refs = facing.evidenceFacts
        .filter((fact) => fact.requirementId === requirement.requirementId)
        .map((fact) => fact.evidenceRef);
      if (requirement.required) {
        return {
          requirementId: requirement.requirementId,
          judgment: "SATISFIED",
          confidence: "high",
          evidenceRefs: refs.slice(0, Math.max(requirement.minimumEvidenceRefs, 1)),
          reasonCode: "EVIDENCE_SUPPORTS_REQUIREMENT",
          rationale: "grounded by provided facts",
        };
      }
      return {
        requirementId: requirement.requirementId,
        judgment: "UNKNOWN",
        confidence: "high",
        evidenceRefs: [],
        reasonCode: "SEMANTIC_UNCERTAINTY",
        rationale: "optional not required",
      };
    }),
  };
  mutate?.(proposal, facing);
  return proposal;
}

export function satisfiedProvider(mutate?: ProposalMutator): SemanticJudgeProvider {
  return async (request) => ({
    text: JSON.stringify(proposalFromRequest(request, mutate)),
  });
}

export function refsFor(
  facing: SemanticJudgeFacingInput,
  requirementId: string,
): string[] {
  return facing.evidenceFacts
    .filter((fact) => fact.requirementId === requirementId)
    .map((fact) => fact.evidenceRef);
}
