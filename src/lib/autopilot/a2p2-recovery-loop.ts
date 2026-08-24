/**
 * Autopilot A2-P2.3 — bounded auto-recovery loop.
 *
 * EVERY CYCLE RE-ROUTES FIRST.
 * Terminal authority = routeEvaluation() only.
 * Packet rebuild = buildEvidencePacket() only.
 * Never calls runSemanticJudge().
 */

import {
  isForbiddenSideEffectAction,
  parseTaskContract,
  type EvaluationRecoveryActionKind,
  type EvaluationRecoveryStatus,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import { toEvaluationEvidenceStatus } from "./a2p2-evidence-adapter";
import { buildEvidencePacket } from "./a2p2-evidence-builder";
import { parseStructuredSourcesSnapshot } from "./a2p2-evidence-sources";
import type { SemanticEvidencePacketV1 } from "./a2p2-evidence-types";
import { routeEvaluation, type EvaluationRouteDecision } from "./a2p2-routing";
import {
  planNextRecoveryAction,
  tripleActionIntersection,
  zeroCostExecutableActions,
} from "./a2p2-recovery-plan";
import {
  cloneStructuredSources,
  hashStructuredSources,
  projectRecoveryDelta,
} from "./a2p2-recovery-merge";
import {
  bindRecoveryDeltaToPlan,
  computeRecoveryAttemptKey,
  parseRecoverySnapshotDelta,
  type AutoRecoveryLoopResult,
  type RecoveryAdapter,
  type RecoveryLedgerEntry,
  type RecoverySnapshotDelta,
} from "./a2p2-recovery-types";

export type RunAutoRecoveryLoopInput = {
  contract: unknown;
  structuredSources?: unknown;
  evaluationState?: {
    outcome?: "TASK_SUCCESS" | "PARTIAL_SUCCESS" | "FAILURE" | "UNKNOWN";
    verdictState?: "NOT_EVALUATED" | "PROPOSED" | "ACCEPTED" | "ABSTAINED";
  };
  recoveryState?: {
    status: EvaluationRecoveryStatus;
    cyclesUsed?: number;
  };
  budgetState?: {
    judgeCallsUsed?: number;
    recoveryCyclesUsed?: number;
    externalSearchesUsed?: number;
    costUsdUsed?: number;
  };
  policySignals?: Parameters<typeof routeEvaluation>[0]["policySignals"];
  adapters?: readonly RecoveryAdapter[];
  now?: Date;
};

function frozenPacket(packet: SemanticEvidencePacketV1): SemanticEvidencePacketV1 {
  return JSON.parse(JSON.stringify(packet)) as SemanticEvidencePacketV1;
}

function terminalOf(route: EvaluationRouteDecision): AutoRecoveryLoopResult["terminalRoute"] {
  return {
    decision: route.decision,
    reasonCode: route.reasonCode,
    allowedNextActions: route.allowedNextActions,
  };
}

function routeFor(
  contract: unknown,
  packet: SemanticEvidencePacketV1,
  recoveryStatus: EvaluationRecoveryStatus,
  cyclesUsed: number,
  budget: {
    judgeCallsUsed: number;
    recoveryCyclesUsed: number;
    externalSearchesUsed: number;
    costUsdUsed: number;
  },
  evaluationState: RunAutoRecoveryLoopInput["evaluationState"],
  policySignals: RunAutoRecoveryLoopInput["policySignals"],
): EvaluationRouteDecision {
  return routeEvaluation({
    taskContract: contract,
    evaluationState: {
      outcome: evaluationState?.outcome ?? "UNKNOWN",
      verdictState: evaluationState?.verdictState,
    },
    evidenceState: {
      status: toEvaluationEvidenceStatus(packet.status),
      privacyClass: packet.privacySummary.blocked ? "PROHIBITED" : "INTERNAL",
    },
    recoveryState: { status: recoveryStatus, cyclesUsed },
    budgetState: {
      judgeCallsUsed: budget.judgeCallsUsed,
      recoveryCyclesUsed: Math.max(budget.recoveryCyclesUsed, cyclesUsed),
      externalSearchesUsed: budget.externalSearchesUsed,
      costUsdUsed: budget.costUsdUsed,
    },
    policySignals,
  });
}

function finish(input: {
  outcome: AutoRecoveryLoopResult["outcome"];
  route: EvaluationRouteDecision | null;
  recoveryStatus: EvaluationRecoveryStatus;
  cyclesUsed: number;
  attemptKeys: readonly string[];
  budget: {
    judgeCallsUsed: number;
    recoveryCyclesUsed: number;
    externalSearchesUsed: number;
    costUsdUsed: number;
  };
  packet: SemanticEvidencePacketV1;
  structuredSources: unknown;
  ledger: RecoveryLedgerEntry[];
  adapterCallCount: number;
  routeCallCount: number;
}): AutoRecoveryLoopResult {
  return {
    outcome: input.outcome,
    terminalRoute: input.route ? terminalOf(input.route) : null,
    recoveryState: {
      status: input.recoveryStatus,
      cyclesUsed: input.cyclesUsed,
      attemptKeys: input.attemptKeys,
    },
    budgetState: {
      ...input.budget,
      recoveryCyclesUsed: input.cyclesUsed,
    },
    packet: frozenPacket(input.packet),
    packetHash: input.packet.packetHash,
    packetStatus: input.packet.status,
    structuredSources: cloneStructuredSources(input.structuredSources),
    ledger: input.ledger,
    adapterCallCount: input.adapterCallCount,
    routeCallCount: input.routeCallCount,
    judgeCallCount: 0,
  };
}

function adapterFor(
  adapters: readonly RecoveryAdapter[],
  actionKind: EvaluationRecoveryActionKind,
): RecoveryAdapter | undefined {
  return adapters.find((item) => item.actionKind === actionKind);
}

export function runAutoRecoveryLoop(
  input: RunAutoRecoveryLoopInput,
): AutoRecoveryLoopResult {
  const adapters = input.adapters ?? [];
  const budget = {
    judgeCallsUsed: input.budgetState?.judgeCallsUsed ?? 0,
    recoveryCyclesUsed: input.budgetState?.recoveryCyclesUsed ?? 0,
    externalSearchesUsed: input.budgetState?.externalSearchesUsed ?? 0,
    costUsdUsed: input.budgetState?.costUsdUsed ?? 0,
  };
  const evaluationState = input.evaluationState;
  const policySignals = input.policySignals;
  const ledger: RecoveryLedgerEntry[] = [];
  const attemptKeys: string[] = [];
  const skippedAttemptKeys = new Set<string>();
  let adapterCallCount = 0;
  let routeCallCount = 0;
  let cyclesUsed = Math.max(
    input.recoveryState?.cyclesUsed ?? 0,
    budget.recoveryCyclesUsed,
  );
  let structuredSources = cloneStructuredSources(input.structuredSources ?? {});
  let attemptsUsed = false;

  const parsed = parseTaskContract(input.contract);
  const now = input.now ?? new Date("2026-01-01T00:00:00.000Z");

  const build = (sources: unknown) =>
    buildEvidencePacket({
      contract: parsed.ok ? parsed.contract : input.contract,
      structuredSources: sources,
      now,
    });

  let packet = build(structuredSources);

  if (!parsed.ok) {
    routeCallCount += 1;
    const route = routeFor(
      input.contract,
      packet,
      "NOT_ALLOWED",
      cyclesUsed,
      budget,
      evaluationState,
      policySignals,
    );
    return finish({
      outcome: "CONTRACT_INVALID",
      route,
      recoveryStatus: "NOT_ALLOWED",
      cyclesUsed,
      attemptKeys,
      budget,
      packet,
      structuredSources,
      ledger,
      adapterCallCount,
      routeCallCount,
    });
  }

  const contract: ValidatedTaskContract = parsed.contract;
  const incomingStatus = input.recoveryState?.status ?? "AVAILABLE";

  if (incomingStatus === "IN_PROGRESS") {
    routeCallCount += 1;
    const route = routeFor(
      contract,
      packet,
      "IN_PROGRESS",
      cyclesUsed,
      budget,
      evaluationState,
      policySignals,
    );
    return finish({
      outcome: "REFUSED_IN_PROGRESS",
      route,
      recoveryStatus: "IN_PROGRESS",
      cyclesUsed,
      attemptKeys,
      budget,
      packet,
      structuredSources,
      ledger,
      adapterCallCount,
      routeCallCount,
    });
  }

  if (contract.taskType !== "TENDER_ANALYSIS") {
    routeCallCount += 1;
    const route = routeFor(
      contract,
      packet,
      "NOT_ALLOWED",
      cyclesUsed,
      budget,
      evaluationState,
      policySignals,
    );
    return finish({
      outcome: "ROUTED",
      route,
      recoveryStatus: "NOT_ALLOWED",
      cyclesUsed,
      attemptKeys,
      budget,
      packet,
      structuredSources,
      ledger,
      adapterCallCount,
      routeCallCount,
    });
  }

  const sourceInspect = parseStructuredSourcesSnapshot(input.structuredSources ?? {});
  if (!sourceInspect.ok) {
    structuredSources = {};
    packet = build({});
    routeCallCount += 1;
    const route = routeFor(
      contract,
      packet,
      "NOT_ALLOWED",
      cyclesUsed,
      budget,
      evaluationState,
      policySignals,
    );
    return finish({
      outcome: "ROUTED",
      route,
      recoveryStatus: "NOT_ALLOWED",
      cyclesUsed,
      attemptKeys,
      budget,
      packet,
      structuredSources,
      ledger,
      adapterCallCount,
      routeCallCount,
    });
  }

  const maxCycles = Math.min(
    contract.evaluationBudget.maxRecoveryCycles,
    contract.recoveryPolicy.maxRecoveryCycles,
  );
  const maxCostUsd = contract.evaluationBudget.maxCostUsd;
  const maxIterations = maxCycles * 4 + 8;
  let iterations = 0;

  const pushLedger = (
    cycleIndex: number,
    routeBefore: EvaluationRouteDecision,
    patch: Partial<RecoveryLedgerEntry>,
  ) => {
    ledger.push({
      cycleIndex,
      recoveryAttemptKey: null,
      actionKind: null,
      requirementIds: [],
      adapterStatus: "NOT_CALLED",
      deltaAccepted: false,
      sourceSnapshotHashAfter: hashStructuredSources(structuredSources),
      packetHashAfter: packet.packetHash,
      packetStatusAfter: packet.status,
      routeDecisionBefore: routeBefore.decision,
      routeDecisionAfter: null,
      externalResearchUsed: false,
      costUsd: 0,
      noProgress: false,
      ...patch,
    });
  };

  while (iterations < maxIterations) {
    iterations += 1;
    if (cyclesUsed >= maxCycles || budget.costUsdUsed >= maxCostUsd) {
      routeCallCount += 1;
      const route = routeFor(
        contract,
        packet,
        "EXHAUSTED",
        cyclesUsed,
        budget,
        evaluationState,
        policySignals,
      );
      return finish({
        outcome: "ROUTED",
        route,
        recoveryStatus: "EXHAUSTED",
        cyclesUsed,
        attemptKeys,
        budget,
        packet,
        structuredSources,
        ledger,
        adapterCallCount,
        routeCallCount,
      });
    }

    routeCallCount += 1;
    const route = routeFor(
      contract,
      packet,
      attemptsUsed
        ? "AVAILABLE"
        : incomingStatus === "NOT_ATTEMPTED"
          ? "AVAILABLE"
          : incomingStatus,
      cyclesUsed,
      budget,
      evaluationState,
      policySignals,
    );

    if (route.decision !== "AUTO_RECOVER") {
      pushLedger(ledger.length, route, {
        adapterStatus: "NOT_CALLED",
        routeDecisionAfter: route.decision,
      });
      return finish({
        outcome: "ROUTED",
        route,
        recoveryStatus:
          incomingStatus === "EXHAUSTED"
            ? "EXHAUSTED"
            : incomingStatus === "NOT_ALLOWED"
              ? "NOT_ALLOWED"
              : attemptsUsed
                ? "AVAILABLE"
                : incomingStatus,
        cyclesUsed,
        attemptKeys,
        budget,
        packet,
        structuredSources,
        ledger,
        adapterCallCount,
        routeCallCount,
      });
    }

    if (packet.status === "SUFFICIENT") {
      return finish({
        outcome: "EVIDENCE_READY_FOR_REEVALUATION",
        route,
        recoveryStatus: attemptsUsed ? "AVAILABLE" : incomingStatus,
        cyclesUsed,
        attemptKeys,
        budget,
        packet,
        structuredSources,
        ledger,
        adapterCallCount,
        routeCallCount,
      });
    }

    if (packet.status === "PRIVACY_BLOCKED") {
      return finish({
        outcome: "ROUTED",
        route,
        recoveryStatus: "NOT_ALLOWED",
        cyclesUsed,
        attemptKeys,
        budget,
        packet,
        structuredSources,
        ledger,
        adapterCallCount,
        routeCallCount,
      });
    }

    const intersection = tripleActionIntersection({
      allowedNextActions: route.allowedNextActions,
      contract,
    }).filter((action) => !isForbiddenSideEffectAction(action));

    const executable = zeroCostExecutableActions({
      intersection,
      adapters,
    });

    const plan = planNextRecoveryAction({
      contract,
      packet,
      reasonCode: route.reasonCode,
      executable,
      usedAttemptKeys: new Set([...attemptKeys, ...skippedAttemptKeys]),
      attemptKeySeed: {
        semanticContractHash: packet.contract.semanticContractHash,
        packetHash: packet.packetHash,
        reasonCode: route.reasonCode,
      },
    });

    if (!plan) {
      const recoveryStatus: EvaluationRecoveryStatus = attemptsUsed
        ? "EXHAUSTED"
        : "NOT_ALLOWED";
      routeCallCount += 1;
      const terminal = routeFor(
        contract,
        packet,
        recoveryStatus,
        cyclesUsed,
        budget,
        evaluationState,
        policySignals,
      );
      pushLedger(ledger.length, route, {
        adapterStatus: "NOT_CALLED",
        routeDecisionAfter: terminal.decision,
        noProgress: attemptsUsed,
      });
      return finish({
        outcome: "ROUTED",
        route: terminal,
        recoveryStatus,
        cyclesUsed,
        attemptKeys,
        budget,
        packet,
        structuredSources,
        ledger,
        adapterCallCount,
        routeCallCount,
      });
    }

    const recoveryAttemptKey = computeRecoveryAttemptKey({
      semanticContractHash: packet.contract.semanticContractHash,
      packetHash: packet.packetHash,
      reasonCode: route.reasonCode,
      actionKind: plan.actionKind,
      requirementIds: plan.requirementIds,
    });

    const adapter = adapterFor(adapters, plan.actionKind);
    if (!adapter || adapter.declaredMaxCostUsd !== 0) {
      skippedAttemptKeys.add(recoveryAttemptKey);
      continue;
    }

    if (attemptKeys.includes(recoveryAttemptKey) || skippedAttemptKeys.has(recoveryAttemptKey)) {
      skippedAttemptKeys.add(recoveryAttemptKey);
      continue;
    }

    const beforeSourceHash = hashStructuredSources(structuredSources);
    const beforePacketHash = packet.packetHash;
    let delta: RecoverySnapshotDelta | null = null;
    let adapterStatus: RecoveryLedgerEntry["adapterStatus"] = "CALLED";
    let noProgress = false;
    let deltaAccepted = false;

    try {
      adapterCallCount += 1;
      attemptsUsed = true;
      const raw = adapter.execute({
        actionKind: plan.actionKind,
        requirementIds: plan.requirementIds,
        recoveryAttemptKey,
        reasonCode: route.reasonCode,
        packetHash: packet.packetHash,
      });
      const parsedDelta = parseRecoverySnapshotDelta(raw);
      if (!parsedDelta.ok) {
        adapterStatus = "REJECTED";
        noProgress = true;
      } else if (
        parsedDelta.delta.costUsd !== 0 ||
        parsedDelta.delta.externalResearchUsed
      ) {
        adapterStatus = "REJECTED";
        noProgress = true;
        delta = parsedDelta.delta;
      } else {
        delta = parsedDelta.delta;
      }
    } catch {
      adapterStatus = "ERROR";
      noProgress = true;
    }

    cyclesUsed += 1;
    attemptKeys.push(recoveryAttemptKey);

    if (delta && adapterStatus === "CALLED") {
      const bound = bindRecoveryDeltaToPlan({
        delta,
        plan: {
          actionKind: plan.actionKind,
          requirementIds: plan.requirementIds,
        },
      });
      if (!bound.ok) {
        adapterStatus = "REJECTED";
        noProgress = true;
        delta = null;
      }
    }

    if (delta && adapterStatus === "CALLED") {
      const projected = projectRecoveryDelta({
        currentSources: structuredSources,
        delta,
        plan: {
          actionKind: plan.actionKind,
          requirementIds: plan.requirementIds,
        },
      });
      if (!projected.ok) {
        adapterStatus =
          projected.reason === "PROJECT_REJECTED" ? "REJECTED" : "NO_PROGRESS";
        noProgress = true;
      } else if (projected.sourceHash === beforeSourceHash) {
        adapterStatus = "NO_PROGRESS";
        noProgress = true;
      } else {
        structuredSources = projected.structuredSources;
        packet = build(structuredSources);
        if (packet.packetHash === beforePacketHash) {
          adapterStatus = "NO_PROGRESS";
          noProgress = true;
        } else {
          adapterStatus = "APPLIED";
          deltaAccepted = true;
        }
      }
    }

    pushLedger(ledger.length, route, {
      recoveryAttemptKey,
      actionKind: plan.actionKind,
      requirementIds: plan.requirementIds,
      adapterStatus,
      deltaAccepted,
      sourceSnapshotHashAfter: hashStructuredSources(structuredSources),
      packetHashAfter: packet.packetHash,
      packetStatusAfter: packet.status,
      externalResearchUsed: delta?.externalResearchUsed ?? false,
      costUsd: delta?.costUsd ?? 0,
      noProgress,
    });

    if (deltaAccepted && packet.status === "SUFFICIENT") {
      return finish({
        outcome: "EVIDENCE_READY_FOR_REEVALUATION",
        route,
        recoveryStatus: "AVAILABLE",
        cyclesUsed,
        attemptKeys,
        budget,
        packet,
        structuredSources,
        ledger,
        adapterCallCount,
        routeCallCount,
      });
    }

    if (deltaAccepted && packet.status === "PRIVACY_BLOCKED") {
      routeCallCount += 1;
      const terminal = routeFor(
        contract,
        packet,
        "NOT_ALLOWED",
        cyclesUsed,
        budget,
        evaluationState,
        policySignals,
      );
      return finish({
        outcome: "ROUTED",
        route: terminal,
        recoveryStatus: "NOT_ALLOWED",
        cyclesUsed,
        attemptKeys,
        budget,
        packet,
        structuredSources,
        ledger,
        adapterCallCount,
        routeCallCount,
      });
    }
  }

  routeCallCount += 1;
  const route = routeFor(
    contract,
    packet,
    attemptsUsed ? "EXHAUSTED" : "NOT_ALLOWED",
    cyclesUsed,
    budget,
    evaluationState,
    policySignals,
  );
  return finish({
    outcome: "ROUTED",
    route,
    recoveryStatus: attemptsUsed ? "EXHAUSTED" : "NOT_ALLOWED",
    cyclesUsed,
    attemptKeys,
    budget,
    packet,
    structuredSources,
    ledger,
    adapterCallCount,
    routeCallCount,
  });
}
