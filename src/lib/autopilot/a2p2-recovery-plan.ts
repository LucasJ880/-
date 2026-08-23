/**
 * Autopilot A2-P2.3 — deterministic recovery planner.
 *
 * Executable action = router ∩ contract ∩ P2.3 supported, minus used keys
 * and non-zero-cost adapters. Never invents a route.
 */

import {
  isExternalResearchAction,
  isForbiddenSideEffectAction,
  type EvaluationEvidenceKind,
  type EvaluationRecoveryActionKind,
  type EvaluationRouteReasonCode,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import type { SemanticEvidencePacketV1 } from "./a2p2-evidence-types";
import {
  isP23SupportedAction,
  P2_3_SUPPORTED_ACTIONS,
  type RecoveryAdapter,
} from "./a2p2-recovery-types";

const SOURCE_FACT_ORDER: readonly EvaluationRecoveryActionKind[] = [
  "SEARCH_PROJECT_DOCUMENTS",
  "READ_EXISTING_DOCUMENT",
  "SEARCH_INTERNAL_FACTS",
  "REFRESH_SOURCE_FACTS",
  "SEARCH_AWARD_HISTORY",
  "SEARCH_PUBLIC_WEB",
];

const ARTIFACT_FACT_ORDER: readonly EvaluationRecoveryActionKind[] = [
  "SEARCH_PROJECT_DOCUMENTS",
  "READ_EXISTING_DOCUMENT",
  "REFRESH_SOURCE_FACTS",
];

const TOOL_RESULT_ORDER: readonly EvaluationRecoveryActionKind[] = [
  "RECHECK_TOOL_RESULT",
  "REFRESH_SOURCE_FACTS",
];

const BUSINESS_STATE_ORDER: readonly EvaluationRecoveryActionKind[] = [
  "SEARCH_INTERNAL_FACTS",
  "REFRESH_SOURCE_FACTS",
];

const RUNTIME_FACT_ORDER: readonly EvaluationRecoveryActionKind[] = [
  "REFRESH_SOURCE_FACTS",
  "RECHECK_TOOL_RESULT",
];

const CONFLICT_ORDER: readonly EvaluationRecoveryActionKind[] = [
  "REFRESH_SOURCE_FACTS",
  "RECHECK_TOOL_RESULT",
];

function orderForKind(
  kind: EvaluationEvidenceKind,
): readonly EvaluationRecoveryActionKind[] {
  switch (kind) {
    case "SOURCE_FACT":
      return SOURCE_FACT_ORDER;
    case "ARTIFACT_FACT":
      return ARTIFACT_FACT_ORDER;
    case "TOOL_RESULT":
      return TOOL_RESULT_ORDER;
    case "BUSINESS_STATE":
      return BUSINESS_STATE_ORDER;
    case "RUNTIME_FACT":
      return RUNTIME_FACT_ORDER;
    default:
      return [];
  }
}

export type RecoveryPlan = {
  actionKind: EvaluationRecoveryActionKind;
  requirementIds: readonly string[];
};

export function tripleActionIntersection(input: {
  allowedNextActions: readonly EvaluationRecoveryActionKind[];
  contract: ValidatedTaskContract;
}): EvaluationRecoveryActionKind[] {
  const policy = input.contract.recoveryPolicy;
  if (!policy.enabled) return [];
  const allowed = new Set(policy.allowedActions);
  const routed = new Set(input.allowedNextActions);
  const out: EvaluationRecoveryActionKind[] = [];
  for (const action of P2_3_SUPPORTED_ACTIONS) {
    if (!routed.has(action) || !allowed.has(action)) continue;
    if (isForbiddenSideEffectAction(action)) continue;
    if (!isP23SupportedAction(action)) continue;
    if (!policy.allowExternalResearch && isExternalResearchAction(action)) {
      continue;
    }
    out.push(action);
  }
  return out;
}

export function zeroCostExecutableActions(input: {
  intersection: readonly EvaluationRecoveryActionKind[];
  adapters: readonly RecoveryAdapter[];
}): EvaluationRecoveryActionKind[] {
  const byKind = new Map(
    input.adapters.map((adapter) => [adapter.actionKind, adapter]),
  );
  return input.intersection.filter((action) => {
    const adapter = byKind.get(action);
    if (!adapter) return false;
    return adapter.declaredMaxCostUsd === 0;
  });
}

export function planNextRecoveryAction(input: {
  contract: ValidatedTaskContract;
  packet: SemanticEvidencePacketV1;
  reasonCode: EvaluationRouteReasonCode;
  executable: readonly EvaluationRecoveryActionKind[];
  blockedActionKinds: ReadonlySet<string>;
}): RecoveryPlan | null {
  const executable = new Set(input.executable);
  if (executable.size === 0) return null;

  const conflict =
    input.reasonCode === "AUTO_RECOVERY_SOURCE_CONFLICT" ||
    input.packet.status === "CONFLICTING";

  for (const requirement of input.contract.requirements) {
    if (!requirement.required) continue;
    const assessment = input.packet.requirementAssessments.find(
      (item) => item.requirementId === requirement.id,
    );
    if (!assessment) continue;
    if (assessment.state === "READY") continue;
    if (
      assessment.state === "PRIVACY_BLOCKED" ||
      assessment.state === "NOT_EVALUABLE"
    ) {
      continue;
    }

    const orders: EvaluationRecoveryActionKind[][] = [];
    if (conflict || assessment.state === "CONFLICTING") {
      orders.push([...CONFLICT_ORDER]);
    } else {
      for (const kind of requirement.evidenceKinds) {
        orders.push([...orderForKind(kind)]);
      }
    }

    for (const order of orders) {
      for (const action of order) {
        if (!executable.has(action)) continue;
        if (input.blockedActionKinds.has(action)) continue;
        return { actionKind: action, requirementIds: [requirement.id] };
      }
    }
  }

  for (const action of input.executable) {
    if (input.blockedActionKinds.has(action)) continue;
    return { actionKind: action, requirementIds: [] };
  }
  return null;
}
