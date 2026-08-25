/**
 * Autopilot A2-P2.4 A2 closure matrix — CASE 1–15.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-a2-closure-matrix.test.ts
 *
 * Harness only. Envelope code does not call Judge or recovery.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toEvaluationEvidenceStatus } from "../a2p2-evidence-adapter";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import { hashEvidencePacket, makeCanonicalFactHash, makeEvidenceRef } from "../a2p2-evidence-hash";
import type { SemanticEvidencePacketV1 } from "../a2p2-evidence-types";
import { buildExceptionEnvelope } from "../a2p2-exception-envelope";
import {
  A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION,
  type RecoveryAdapter,
  type RecoveryAdapterRequest,
  type RecoverySnapshotDelta,
} from "../a2p2-recovery-types";
import { runAutoRecoveryLoop } from "../a2p2-recovery-loop";
import { routeEvaluation } from "../a2p2-routing";
import { runSemanticJudge, toP2EvaluationState } from "../a2p2-semantic-judge";
import { resolveTaskContract } from "../a2p2-templates";
import {
  UPSTREAM_HASH_A,
  makeAnalysisResultV2,
} from "./a2p2-evidence-fixtures";
import {
  NOW,
  ZERO_BUDGET,
  cloneJson,
  satisfiedProvider,
  tenderContract,
  tenderReady,
} from "./a2p2-semantic-judge-helpers";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

const ROUTE_BUDGET = {
  judgeCallsUsed: 0,
  recoveryCyclesUsed: 0,
  externalSearchesUsed: 0,
  costUsdUsed: 0,
};

function patchContract(domainContract: ReturnType<typeof tenderContract>, patch: Record<string, unknown>) {
  return resolveTaskContract({
    now: NOW,
    explicitContract: { ...cloneJson(domainContract), ...patch },
  });
}

function envelopeOf(input: {
  contract: unknown;
  packet: unknown;
  evaluationState?: { outcome: string; verdictState: string };
  recoveryState?: { status: string; cyclesUsed?: number };
  budgetState?: typeof ROUTE_BUDGET;
  policySignals?: Record<string, boolean>;
  judge?: unknown;
}) {
  return buildExceptionEnvelope({
    taskContract: input.contract,
    packet: input.packet,
    evaluationState: input.evaluationState ?? { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
    recoveryState: input.recoveryState ?? { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: input.budgetState ?? ROUTE_BUDGET,
    policySignals: input.policySignals,
    judge: input.judge,
  });
}

function routeOf(input: Parameters<typeof routeEvaluation>[0]) {
  return routeEvaluation(input);
}

console.log("autopilot A2-P2.4 A2 closure matrix");

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const { contract, packet } = tenderReady();

  const success = await runSemanticJudge({
    taskContract: contract,
    evidencePacket: packet,
    budgetState: ZERO_BUDGET,
    provider: satisfiedProvider(),
  });
  const successEval = toP2EvaluationState(success);
  const case1Route = routeOf({
    taskContract: contract,
    evaluationState: successEval,
    evidenceState: { status: toEvaluationEvidenceStatus(packet.status) },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
  });
  const case1Env = envelopeOf({
    contract,
    packet,
    evaluationState: successEval,
    judge: success,
  });
  ok(
    success.outcome === "TASK_SUCCESS" &&
      success.verdictState === "ACCEPTED" &&
      case1Route.decision === "AUTO_FINALIZE" &&
      !case1Env.ok &&
      case1Env.envelope === null,
    "CASE 1 AUTO_FINALIZE NO exception",
    { outcome: success.outcome, decision: case1Route.decision, env: case1Env.reason },
  );
  ok(success.failureType === null, "FALSE_TASK_SUCCESS_PATHS = ZERO (legitimate success only)");

  const partial = await runSemanticJudge({
    taskContract: contract,
    evidencePacket: packet,
    budgetState: ZERO_BUDGET,
    provider: satisfiedProvider((proposal, facing) => {
      const deadline = proposal.requirements.find((row) => row.requirementId === "submission_deadline");
      if (deadline) {
        deadline.judgment = "PARTIAL";
        deadline.reasonCode = "EVIDENCE_PARTIALLY_SUPPORTS_REQUIREMENT";
        deadline.confidence = "high";
        deadline.evidenceRefs = facing.evidenceFacts
          .filter((fact) => fact.requirementId === "submission_deadline")
          .map((fact) => fact.evidenceRef)
          .slice(0, 1);
      }
    }),
  });
  const partialEval = toP2EvaluationState(partial);
  const case2Route = routeOf({
    taskContract: contract,
    evaluationState: partialEval,
    evidenceState: { status: toEvaluationEvidenceStatus(packet.status) },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
  });
  const case2Env = envelopeOf({
    contract,
    packet,
    evaluationState: partialEval,
    judge: partial,
  });
  ok(
    case2Route.decision === "AUTO_FINALIZE" && !case2Env.ok,
    "CASE 2 PARTIAL_SUCCESS follows P2.0 only",
    { outcome: partial.outcome, decision: case2Route.decision, env: case2Env.reason },
  );

  const missingPacket = buildEvidencePacket({
    contract,
    structuredSources: { tender: makeAnalysisResultV2({ facts: [] }) },
    now: NOW,
  });
  const case3Route = routeOf({
    taskContract: contract,
    evaluationState: { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
    evidenceState: { status: toEvaluationEvidenceStatus(missingPacket.status) },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
  });
  const case3Env = envelopeOf({ contract, packet: missingPacket });
  ok(
    case3Route.decision === "AUTO_RECOVER" && !case3Env.ok && case3Env.reason === "NOT_HUMAN_ESCALATE",
    "CASE 3 AUTO_RECOVER P2.4 not invoked",
    { decision: case3Route.decision, env: case3Env.reason },
  );

  function adapter(
    actionKind: RecoveryAdapter["actionKind"],
    execute: (request: RecoveryAdapterRequest) => RecoverySnapshotDelta,
  ): RecoveryAdapter {
    return { actionKind, declaredMaxCostUsd: 0, execute };
  }
  const foundDeadline = (request: RecoveryAdapterRequest): RecoverySnapshotDelta => ({
    version: A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION,
    actionKind: request.actionKind,
    requirementIds: [...request.requirementIds],
    facts:
      request.requirementIds.includes("submission_deadline")
        ? [
            {
              requirementId: "submission_deadline",
              evidenceKind: "SOURCE_FACT",
              factKey: "closing_datetime",
              normalizedValue: "2026-09-15T14:00",
              sourceId: "doc-1",
              contentHash: UPSTREAM_HASH_A,
              pageNumber: 3,
            },
          ]
        : [],
    sourceRefs: [{ sourceType: "STRUCTURED_PROJECT_INDEX", sourceId: "doc-1", contentHash: UPSTREAM_HASH_A }],
    status: "FOUND",
    externalResearchUsed: false,
    costUsd: 0,
  });
  const recovered = runAutoRecoveryLoop({
    contract,
    structuredSources: { tender: makeAnalysisResultV2({ facts: [] }) },
    adapters: [adapter("SEARCH_PROJECT_DOCUMENTS", foundDeadline)],
    now: NOW,
  });
  ok(
    recovered.outcome === "EVIDENCE_READY_FOR_REEVALUATION" && recovered.packetStatus === "SUFFICIENT",
    "CASE 4 recovery SUFFICIENT EVIDENCE_READY_FOR_REEVALUATION",
    { outcome: recovered.outcome, status: recovered.packetStatus },
  );
  const case4Env = envelopeOf({
    contract,
    packet: recovered.packet,
    recoveryState: {
      status: recovered.recoveryState.status,
      cyclesUsed: recovered.recoveryState.cyclesUsed,
    },
    budgetState: recovered.budgetState,
  });
  ok(!case4Env.ok, "CASE 4 P2.4 not invoked", case4Env.reason);

  const exhaustedLow = routeOf({
    taskContract: contract,
    evaluationState: { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
    evidenceState: { status: "INSUFFICIENT" },
    recoveryState: { status: "EXHAUSTED", cyclesUsed: 3 },
    budgetState: { ...ROUTE_BUDGET, recoveryCyclesUsed: 3 },
  });
  const case5Env = envelopeOf({
    contract,
    packet: missingPacket,
    recoveryState: { status: "EXHAUSTED", cyclesUsed: 3 },
    budgetState: { ...ROUTE_BUDGET, recoveryCyclesUsed: 3 },
  });
  ok(
    exhaustedLow.decision === "AUTO_ABSTAIN" && !case5Env.ok,
    "CASE 5 LOW UNKNOWN exhausted AUTO_ABSTAIN not automatically human",
    { decision: exhaustedLow.decision, env: case5Env.reason },
  );

  const conflictPacket = conflictingPacket(packet);
  const case6Route = routeOf({
    taskContract: contract,
    evaluationState: { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
    evidenceState: { status: toEvaluationEvidenceStatus(conflictPacket.status) },
    recoveryState: { status: "EXHAUSTED", cyclesUsed: 3 },
    budgetState: { ...ROUTE_BUDGET, recoveryCyclesUsed: 3 },
  });
  const case6Env = envelopeOf({
    contract,
    packet: conflictPacket,
    recoveryState: { status: "EXHAUSTED", cyclesUsed: 3 },
    budgetState: { ...ROUTE_BUDGET, recoveryCyclesUsed: 3 },
  });
  ok(
    case6Route.decision === "HUMAN_ESCALATE" &&
      case6Route.reasonCode === "HUMAN_ESCALATION_EVIDENCE_CONFLICT" &&
      case6Env.ok &&
      case6Env.envelope !== null,
    "CASE 6 conflict after recovery one envelope",
    { decision: case6Route.decision, env: case6Env.ok ? case6Env.envelope.routeReasonCode : case6Env.reason },
  );

  const highContract = patchContract(contract, { riskClass: "HIGH" });
  const highPacket = buildEvidencePacket({
    contract: highContract,
    structuredSources: { tender: makeAnalysisResultV2() },
    now: NOW,
  });
  const highSuccess = await runSemanticJudge({
    taskContract: highContract,
    evidencePacket: highPacket,
    budgetState: ZERO_BUDGET,
    provider: satisfiedProvider(),
  });
  const highEval = toP2EvaluationState(highSuccess);
  const case7Route = routeOf({
    taskContract: highContract,
    evaluationState: highEval,
    evidenceState: { status: toEvaluationEvidenceStatus(highPacket.status) },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
  });
  const case7Env = envelopeOf({
    contract: highContract,
    packet: highPacket,
    evaluationState: highEval,
    judge: highSuccess,
  });
  ok(
    case7Route.decision === "HUMAN_ESCALATE" &&
      case7Route.reasonCode === "HUMAN_ESCALATION_HIGH_RISK" &&
      case7Env.ok &&
      case7Env.envelope !== null &&
      case7Route.decision !== "AUTO_FINALIZE",
    "CASE 7 HIGH HUMAN_ESCALATE exactly one envelope",
    { decision: case7Route.decision, envOk: case7Env.ok },
  );

  const restrictedContract = patchContract(contract, { riskClass: "RESTRICTED" });
  const restrictedPacket = buildEvidencePacket({
    contract: restrictedContract,
    structuredSources: { tender: makeAnalysisResultV2() },
    now: NOW,
  });
  const case8Route = routeOf({
    taskContract: restrictedContract,
    evaluationState: { outcome: "TASK_SUCCESS", verdictState: "ACCEPTED" },
    evidenceState: { status: toEvaluationEvidenceStatus(restrictedPacket.status) },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
  });
  const case8Env = envelopeOf({
    contract: restrictedContract,
    packet: restrictedPacket,
    evaluationState: { outcome: "TASK_SUCCESS", verdictState: "ACCEPTED" },
  });
  ok(
    case8Route.decision === "HUMAN_ESCALATE" &&
      case8Env.ok &&
      case8Env.envelope !== null &&
      case8Route.decision !== "AUTO_FINALIZE",
    "CASE 8 RESTRICTED HUMAN_ESCALATE one envelope",
    { decision: case8Route.decision, reason: case8Route.reasonCode },
  );

  for (const signal of [
    "legalCommitment",
    "financialCommitment",
    "externalSideEffect",
    "irreversibleAction",
  ] as const) {
    const routed = routeOf({
      taskContract: contract,
      evaluationState: successEval,
      evidenceState: { status: "SUFFICIENT" },
      recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
      budgetState: ROUTE_BUDGET,
      policySignals: { [signal]: true },
    });
    const env = envelopeOf({
      contract,
      packet,
      evaluationState: successEval,
      judge: success,
      policySignals: { [signal]: true },
    });
    ok(
      routed.decision === "HUMAN_ESCALATE" && env.ok && env.envelope !== null,
      `CASE 9 ${signal} HUMAN_ESCALATE one envelope`,
      { decision: routed.decision, reason: routed.reasonCode },
    );
  }

  const privacyRoute = routeOf({
    taskContract: contract,
    evaluationState: successEval,
    evidenceState: { status: "PRIVACY_BLOCKED" },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
    policySignals: { privacyBlocked: true },
  });
  const privacyEnv = envelopeOf({
    contract,
    packet,
    evaluationState: successEval,
    judge: success,
    policySignals: { privacyBlocked: true },
  });
  ok(
    privacyRoute.decision === "POLICY_BLOCKED" &&
      privacyRoute.reasonCode === "POLICY_BLOCKED_PRIVACY" &&
      !privacyEnv.ok &&
      privacyEnv.envelope === null,
    "CASE 10 privacy blocked no envelope",
    { decision: privacyRoute.decision, env: privacyEnv.reason },
  );

  const unavailable = await runSemanticJudge({
    taskContract: contract,
    evidencePacket: packet,
    budgetState: ZERO_BUDGET,
    provider: async () => {
      throw new Error("provider down");
    },
  });
  const unavailableEval = toP2EvaluationState(unavailable);
  const case11Route = routeOf({
    taskContract: contract,
    evaluationState: unavailableEval,
    evidenceState: { status: toEvaluationEvidenceStatus(packet.status) },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
  });
  const case11Env = envelopeOf({
    contract,
    packet,
    evaluationState: unavailableEval,
    judge: unavailable,
  });
  ok(
    unavailable.providerStatus === "UNAVAILABLE" &&
      unavailable.outcome === "UNKNOWN" &&
      unavailable.verdictState === "NOT_EVALUATED" &&
      unavailable.failureType === null &&
      case11Route.decision !== "HUMAN_ESCALATE" &&
      !case11Env.ok,
    "CASE 11 provider unavailable is not task failure and not auto-human",
    { decision: case11Route.decision, outcome: unavailable.outcome },
  );

  const malformed = await runSemanticJudge({
    taskContract: contract,
    evidencePacket: packet,
    budgetState: ZERO_BUDGET,
    provider: async () => ({ text: "{not-json" }),
  });
  const malformedEval = toP2EvaluationState(malformed);
  const case12Route = routeOf({
    taskContract: contract,
    evaluationState: malformedEval,
    evidenceState: { status: toEvaluationEvidenceStatus(packet.status) },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: ROUTE_BUDGET,
  });
  ok(
    malformed.proposalStatus === "REJECTED" &&
      malformed.failureType === null &&
      case12Route.decision !== "HUMAN_ESCALATE",
    "CASE 12 malformed Judge is not HUMAN_ESCALATE",
    { decision: case12Route.decision, status: malformed.proposalStatus },
  );

  let adapterCalls = 0;
  const malformedDelta = runAutoRecoveryLoop({
    contract,
    structuredSources: { tender: makeAnalysisResultV2({ facts: [] }) },
    adapters: [
      adapter("SEARCH_PROJECT_DOCUMENTS", () => {
        adapterCalls += 1;
        return { hostile: true } as unknown as RecoverySnapshotDelta;
      }),
    ],
    now: NOW,
  });
  ok(
    malformedDelta.judgeCallCount === 0 &&
      !("failureType" in malformedDelta) &&
      malformedDelta.packetStatus !== "SUFFICIENT",
    "CASE 13 malformed recovery delta is not task failure",
    { status: malformedDelta.packetStatus, outcome: malformedDelta.outcome },
  );

  let errorCalls = 0;
  const adapterError = runAutoRecoveryLoop({
    contract,
    structuredSources: { tender: makeAnalysisResultV2({ facts: [] }) },
    adapters: [
      adapter("SEARCH_PROJECT_DOCUMENTS", () => {
        errorCalls += 1;
        throw new Error("adapter exploded");
      }),
    ],
    now: NOW,
  });
  ok(
    errorCalls >= 1 &&
      adapterError.ledger.some((row) => row.adapterStatus === "ERROR") &&
      adapterError.judgeCallCount === 0,
    "CASE 14 adapter error is not task failure",
    { errorCalls, status: adapterError.recoveryState.status },
  );

  const research = resolveTaskContract({ domainHint: "RESEARCH", now: NOW });
  const researchPacket = buildEvidencePacket({ contract: research, now: NOW });
  const researchLoop = runAutoRecoveryLoop({
    contract: research,
    adapters: [adapter("SEARCH_PROJECT_DOCUMENTS", foundDeadline)],
    now: NOW,
  });
  const researchRoute = routeOf({
    taskContract: research,
    evaluationState: { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
    evidenceState: { status: toEvaluationEvidenceStatus(researchPacket.status) },
    recoveryState: {
      status: researchLoop.recoveryState.status,
      cyclesUsed: researchLoop.recoveryState.cyclesUsed,
    },
    budgetState: researchLoop.budgetState,
  });
  const researchEnv = envelopeOf({
    contract: research,
    packet: researchPacket,
    recoveryState: {
      status: researchLoop.recoveryState.status,
      cyclesUsed: researchLoop.recoveryState.cyclesUsed,
    },
    budgetState: researchLoop.budgetState,
  });
  ok(
    researchLoop.recoveryState.status === "NOT_ALLOWED" &&
      researchRoute.decision !== "HUMAN_ESCALATE" &&
      !researchEnv.ok,
    "CASE 15 unsupported recovery domain no accidental human",
    { recovery: researchLoop.recoveryState.status, decision: researchRoute.decision },
  );

  const fabricated = runAutoRecoveryLoop({
    contract,
    structuredSources: {},
    adapters: [adapter("SEARCH_PROJECT_DOCUMENTS", foundDeadline)],
    now: NOW,
  });
  ok(
    fabricated.packetStatus !== "SUFFICIENT" && recovered.packetStatus === "SUFFICIENT",
    "FALSE_RECOVERY_SUFFICIENCY_PATHS = ZERO",
    { fabricated: fabricated.packetStatus, truthful: recovered.packetStatus },
  );
  ok(
    recovered.recoveryState.cyclesUsed <= contract.evaluationBudget.maxRecoveryCycles &&
      malformedDelta.recoveryState.cyclesUsed <= contract.evaluationBudget.maxRecoveryCycles,
    "UNBOUNDED_RECOVERY_PATHS = ZERO",
  );

  ok(case1Route.decision !== "HUMAN_ESCALATE", "MODEL_ROUTE_AUTHORITY = NO");
  ok(case11Route.decision !== "HUMAN_ESCALATE", "UNKNOWN_AUTO_ESCALATION_HEURISTIC = ZERO");
  ok(case7Route.decision !== "AUTO_FINALIZE", "HIGH_RISK_AUTO_FINALIZE_PATHS = ZERO");
  ok(case8Route.decision !== "AUTO_FINALIZE", "RESTRICTED_RISK_AUTO_FINALIZE_PATHS = ZERO");
  ok(case7Env.ok && case8Env.ok, "HIGH_RISK_AUTO_ACTION_PATHS = ZERO / RESTRICTED_RISK_AUTO_ACTION_PATHS = ZERO");
  ok(
    privacyEnv.envelope === null &&
      (!case7Env.envelope ||
        JSON.stringify(case7Env.envelope).includes("HUMAN_ESCALATION_HIGH_RISK")),
    "PRIVACY_LEAK_PATHS = ZERO",
  );
  ok(!case7Env.envelope || !JSON.stringify(case7Env.envelope).includes("SNIPPET_TEXT_MUST_NOT_LEAK"), "no tender snippet in envelope");
  ok(unavailable.failureType === null, "PROVIDER_FAILURE_EQUALS_TASK_FAILURE = NO");
  ok(adapterError.judgeCallCount === 0, "ADAPTER_FAILURE_EQUALS_TASK_FAILURE = NO");

  const src = [
    readFileSync(join(__dirname, "../a2p2-exception-envelope.ts"), "utf8"),
    readFileSync(join(__dirname, "../a2p2-exception-types.ts"), "utf8"),
  ].join("\n");
  ok(!src.includes("runSemanticJudge"), "envelope sources do not call Judge");
  ok(!src.includes("runAutoRecoveryLoop"), "envelope sources do not call recovery loop");

  if (fail > 0) {
    console.error(`FAIL ${fail}  PASS ${pass}`);
    process.exit(1);
  }
  console.log(`PASS ${pass}`);
}

function conflictingPacket(packet: SemanticEvidencePacketV1): SemanticEvidencePacketV1 {
  const next = cloneJson(packet);
  const original = next.evidenceFacts.find(
    (item) => item.requirementId === "submission_deadline" && item.countsTowardRequirement,
  );
  if (!original) {
    next.status = "CONFLICTING";
    next.packetHash = hashEvidencePacket(next);
    return next;
  }
  const twin = cloneJson(original);
  twin.normalizedValue = "2026-09-20";
  twin.canonicalFactHash = makeCanonicalFactHash({
    evidenceKind: twin.evidenceKind,
    requirementId: twin.requirementId,
    factKey: twin.factKey,
    normalizedValue: twin.normalizedValue,
    sourceType: twin.source.sourceType,
    sourceId: `${twin.source.sourceId}-twin`,
  });
  twin.evidenceRef = makeEvidenceRef({
    evidenceKind: twin.evidenceKind,
    requirementId: twin.requirementId,
    factKey: twin.factKey,
    sourceType: twin.source.sourceType,
    sourceId: `${twin.source.sourceId}-twin`,
    canonicalFactHash: twin.canonicalFactHash,
  });
  twin.source = { ...twin.source, sourceId: `${twin.source.sourceId}-twin` };
  next.evidenceFacts.push(twin);
  const assessment = next.requirementAssessments.find(
    (item) => item.requirementId === "submission_deadline",
  );
  if (assessment) {
    assessment.state = "CONFLICTING";
    assessment.reasonCode = "EVIDENCE_STRUCTURAL_CONFLICT";
    assessment.validEvidenceRefs = [original.evidenceRef, twin.evidenceRef];
  }
  next.status = "CONFLICTING";
  next.provenanceSummary.factCount = next.evidenceFacts.length;
  next.packetHash = hashEvidencePacket(next);
  return next;
}
