/**
 * Autopilot A2-P2.4 — exception envelope materialization.
 *
 * Calls existing routeEvaluation() on one bound snapshot.
 * Never routes, judges, recovers, approves, or persists.
 * Never-throw for arbitrary unknown input.
 */

import {
  A2P2_ROUTER_VERSION,
  EVALUATION_EVIDENCE_KINDS,
  EVALUATION_OUTCOMES,
  EVALUATION_RECOVERY_STATES,
  EVALUATION_ROUTE_DECISIONS,
  EVALUATION_ROUTE_REASON_CODES,
  EVALUATION_VERDICT_STATES,
  isEvaluationRecoveryActionKind,
  parseTaskContract,
  type EvaluationEvidenceKind,
  type EvaluationEvidenceStatus,
  type EvaluationOutcomeHint,
  type EvaluationPrivacyClass,
  type EvaluationRecoveryActionKind,
  type EvaluationRecoveryStatus,
  type EvaluationRouteReasonCode,
  type EvaluationVerdictState,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import { toEvaluationEvidenceStatus } from "./a2p2-evidence-adapter";
import {
  canonicalJson,
  computeSemanticContractHash,
  sha256Hex,
} from "./a2p2-evidence-hash";
import type { EvidenceFact, SemanticEvidencePacketV1 } from "./a2p2-evidence-types";
import {
  routeEvaluation,
  type EvaluationPolicySignals,
  type EvaluationRouteDecision,
  type EvaluationRouteInput,
} from "./a2p2-routing";
import { validateEvidencePacketForSemanticJudge } from "./a2p2-semantic-judge-packet";
import {
  A2P2_EXCEPTION_ENVELOPE_VERSION,
  A2P2_EXCEPTION_IDENTITY_VERSION,
  MAX_PROBLEM_REQUIREMENT_IDS,
  MAX_RECOVERY_ATTEMPT_KEYS,
  MAX_REQUIRED_REQUIREMENT_IDS,
  MAX_SAFE_EVIDENCE_REFS,
  MAX_SAFE_SUMMARY_CHARS,
  P2_4_HUMAN_ESCALATION_REASON_CODES,
  type A2P2ExceptionEnvelopeV1,
  type BuildExceptionEnvelopeReason,
  type BuildExceptionEnvelopeResult,
  type ExceptionIdentityInput,
  type P24HumanEscalationReasonCode,
  type SafeExceptionEvidenceRef,
} from "./a2p2-exception-types";

const HEX_64 = /^[a-f0-9]{64}$/i;
const ISO_OBSERVED_AT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const INPUT_KEYS = [
  "taskContract",
  "packet",
  "evaluationState",
  "evidenceState",
  "recoveryState",
  "budgetState",
  "policySignals",
  "judge",
  "expectedRoute",
  "observedAt",
] as const;
const EVAL_STATE_KEYS = ["outcome", "verdictState"] as const;
const EVIDENCE_STATE_KEYS = ["status", "privacyClass"] as const;
const RECOVERY_STATE_KEYS = ["status", "cyclesUsed", "attemptKeys"] as const;
const BUDGET_STATE_KEYS = [
  "judgeCallsUsed",
  "recoveryCyclesUsed",
  "externalSearchesUsed",
  "costUsdUsed",
] as const;
const POLICY_SIGNAL_KEYS = [
  "privacyBlocked",
  "restrictedAction",
  "legalCommitment",
  "financialCommitment",
  "externalSideEffect",
  "irreversibleAction",
  "goalAmbiguous",
] as const;
const EXPECTED_ROUTE_KEYS = [
  "routerVersion",
  "decision",
  "reasonCode",
  "allowedNextActions",
] as const;
const SAFE_REF_KEYS = [
  "evidenceRef",
  "requirementId",
  "evidenceKind",
  "canonicalFactHash",
] as const;

const PRIVACY_CLASSES = ["PUBLIC", "INTERNAL", "SENSITIVE", "PROHIBITED"] as const;

function failed(reason: BuildExceptionEnvelopeReason): BuildExceptionEnvelopeResult {
  return { ok: false, reason, envelope: null };
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function boundedPrefix<T>(
  sorted: readonly T[],
  max: number,
): { displayed: readonly T[]; count: number; truncated: boolean } {
  return {
    displayed: sorted.slice(0, max),
    count: sorted.length,
    truncated: sorted.length > max,
  };
}

function contractHashOf(contract: ValidatedTaskContract): string {
  return computeSemanticContractHash({
    taskType: contract.taskType,
    requirements: contract.requirements,
  });
}

export function computeExceptionIdentity(input: ExceptionIdentityInput): string {
  return sha256Hex(
    canonicalJson({
      version: A2P2_EXCEPTION_IDENTITY_VERSION,
      routerVersion: input.routerVersion,
      semanticContractHash: input.semanticContractHash,
      packetHash: input.packetHash,
      routeReasonCode: input.routeReasonCode,
      evaluationOutcome: input.evaluationOutcome,
      verdictState: input.verdictState,
      judgeProposalHash: input.judgeProposalHash,
      recoveryStatus: input.recoveryStatus,
    }),
  );
}

function parseEvaluationState(value: unknown): {
  outcome: EvaluationOutcomeHint;
  verdictState: EvaluationVerdictState;
} | null {
  if (!isPlainObject(value) || extraKeys(value, EVAL_STATE_KEYS).length > 0) return null;
  if (!isEnum(value.outcome, EVALUATION_OUTCOMES)) return null;
  if (!isEnum(value.verdictState, EVALUATION_VERDICT_STATES)) return null;
  return { outcome: value.outcome, verdictState: value.verdictState };
}

function parseEvidenceState(value: unknown): {
  status: EvaluationEvidenceStatus;
  privacyClass?: EvaluationPrivacyClass;
} | null {
  if (!isPlainObject(value) || extraKeys(value, EVIDENCE_STATE_KEYS).length > 0) return null;
  if (
    value.status !== "SUFFICIENT" &&
    value.status !== "INSUFFICIENT" &&
    value.status !== "CONFLICTING" &&
    value.status !== "PRIVACY_BLOCKED"
  ) {
    return null;
  }
  if (value.privacyClass !== undefined && !isEnum(value.privacyClass, PRIVACY_CLASSES)) {
    return null;
  }
  return {
    status: value.status,
    privacyClass: value.privacyClass,
  };
}

function parseRecoveryState(value: unknown): {
  status: EvaluationRecoveryStatus;
  cyclesUsed: number;
  attemptKeys: readonly string[];
} | null {
  if (!isPlainObject(value) || extraKeys(value, RECOVERY_STATE_KEYS).length > 0) return null;
  if (!isEnum(value.status, EVALUATION_RECOVERY_STATES)) return null;
  const cyclesUsed = value.cyclesUsed === undefined ? 0 : value.cyclesUsed;
  if (!isNonNegativeInt(cyclesUsed)) return null;
    const attemptKeys: string[] = [];
    if (value.attemptKeys !== undefined) {
      if (!Array.isArray(value.attemptKeys)) return null;
      for (const item of value.attemptKeys) {
        if (typeof item !== "string" || !HEX_64.test(item)) return null;
        attemptKeys.push(item.toLowerCase());
      }
    }
  return { status: value.status, cyclesUsed, attemptKeys };
}

function parseBudgetState(value: unknown): EvaluationRouteInput["budgetState"] | null {
  if (!isPlainObject(value) || extraKeys(value, BUDGET_STATE_KEYS).length > 0) return null;
  if (
    !isNonNegativeInt(value.judgeCallsUsed) ||
    !isNonNegativeInt(value.recoveryCyclesUsed) ||
    !isNonNegativeInt(value.externalSearchesUsed) ||
    !isFiniteNumber(value.costUsdUsed) ||
    value.costUsdUsed < 0
  ) {
    return null;
  }
  return {
    judgeCallsUsed: value.judgeCallsUsed,
    recoveryCyclesUsed: value.recoveryCyclesUsed,
    externalSearchesUsed: value.externalSearchesUsed,
    costUsdUsed: value.costUsdUsed,
  };
}

function parsePolicySignals(value: unknown): EvaluationPolicySignals | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || extraKeys(value, POLICY_SIGNAL_KEYS).length > 0) return "invalid";
  const out: EvaluationPolicySignals = {};
  for (const key of POLICY_SIGNAL_KEYS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") return "invalid";
    out[key] = value[key];
  }
  return out;
}

function parseExpectedRoute(value: unknown): EvaluationRouteDecision | null {
  if (!isPlainObject(value) || extraKeys(value, EXPECTED_ROUTE_KEYS).length > 0) return null;
  if (value.routerVersion !== A2P2_ROUTER_VERSION) return null;
  if (!isEnum(value.decision, EVALUATION_ROUTE_DECISIONS)) return null;
  if (!isEnum(value.reasonCode, EVALUATION_ROUTE_REASON_CODES)) return null;
  if (!Array.isArray(value.allowedNextActions)) return null;
  const actions: EvaluationRecoveryActionKind[] = [];
  for (const item of value.allowedNextActions) {
    if (typeof item !== "string" || !isEvaluationRecoveryActionKind(item)) return null;
    actions.push(item);
  }
  return {
    routerVersion: A2P2_ROUTER_VERSION,
    decision: value.decision,
    reasonCode: value.reasonCode,
    allowedNextActions: actions,
  };
}

function routesEqual(a: EvaluationRouteDecision, b: EvaluationRouteDecision): boolean {
  if (a.routerVersion !== b.routerVersion) return false;
  if (a.decision !== b.decision) return false;
  if (a.reasonCode !== b.reasonCode) return false;
  if (a.allowedNextActions.length !== b.allowedNextActions.length) return false;
  return a.allowedNextActions.every((item, index) => item === b.allowedNextActions[index]);
}

type JudgeSnapshot = {
  proposalStatus: string | null;
  proposalHash: string | null;
  packetHash: string | null;
  outcome: EvaluationOutcomeHint | null;
  verdictState: EvaluationVerdictState | null;
  unsatisfiedRequiredIds: readonly string[];
};

function parseJudge(value: unknown): JudgeSnapshot | "invalid" {
  if (!isPlainObject(value)) return "invalid";
  const proposalStatus =
    value.proposalStatus === undefined
      ? null
      : typeof value.proposalStatus === "string"
        ? value.proposalStatus
        : "invalid";
  if (proposalStatus === "invalid") return "invalid";
  let proposalHash: string | null = null;
  if (value.proposalHash !== undefined && value.proposalHash !== null) {
    if (typeof value.proposalHash !== "string" || !HEX_64.test(value.proposalHash)) {
      return "invalid";
    }
    proposalHash = value.proposalHash.toLowerCase();
  }
  let packetHash: string | null = null;
  if (value.packetHash !== undefined && value.packetHash !== null) {
    if (typeof value.packetHash !== "string" || !HEX_64.test(value.packetHash)) {
      return "invalid";
    }
    packetHash = value.packetHash.toLowerCase();
  }
  const outcome =
    value.outcome === undefined
      ? null
      : isEnum(value.outcome, EVALUATION_OUTCOMES)
        ? value.outcome
        : "invalid";
  if (outcome === "invalid") return "invalid";
  const verdictState =
    value.verdictState === undefined
      ? null
      : isEnum(value.verdictState, EVALUATION_VERDICT_STATES)
        ? value.verdictState
        : "invalid";
  if (verdictState === "invalid") return "invalid";
  if (proposalStatus === "VALID" && (proposalHash === null || !HEX_64.test(proposalHash))) {
    return "invalid";
  }
  const unsatisfiedRequiredIds: string[] = [];
  if (value.requirementJudgments !== undefined) {
    if (!Array.isArray(value.requirementJudgments)) return "invalid";
    for (const row of value.requirementJudgments) {
      if (!isPlainObject(row)) return "invalid";
      if (typeof row.requirementId !== "string") return "invalid";
      if (typeof row.judgment !== "string") return "invalid";
      if (row.judgment !== "SATISFIED") unsatisfiedRequiredIds.push(row.requirementId);
    }
  }
  return {
    proposalStatus,
    proposalHash,
    packetHash,
    outcome,
    verdictState,
    unsatisfiedRequiredIds,
  };
}

function evaluationFromJudge(judge: JudgeSnapshot): {
  outcome: EvaluationOutcomeHint;
  verdictState: EvaluationVerdictState;
} | null {
  if (judge.verdictState === "ACCEPTED") {
    return { verdictState: "ACCEPTED", outcome: judge.outcome ?? "UNKNOWN" };
  }
  if (judge.verdictState === "ABSTAINED") {
    return { verdictState: "ABSTAINED", outcome: "UNKNOWN" };
  }
  if (judge.verdictState === "NOT_EVALUATED" || judge.verdictState === null) {
    return { verdictState: "NOT_EVALUATED", outcome: "UNKNOWN" };
  }
  if (judge.verdictState === "PROPOSED") {
    return { verdictState: "PROPOSED", outcome: judge.outcome ?? "UNKNOWN" };
  }
  return null;
}

function problemIds(input: {
  contract: ValidatedTaskContract;
  packet: SemanticEvidencePacketV1;
  judge: JudgeSnapshot | null;
}): string[] {
  const required = new Set(
    input.contract.requirements.filter((item) => item.required).map((item) => item.id),
  );
  const fromAssessments = input.packet.requirementAssessments
    .filter((item) => required.has(item.requirementId) && item.state !== "READY")
    .map((item) => item.requirementId);
  const fromJudge =
    input.judge && input.judge.proposalStatus === "VALID"
      ? input.judge.unsatisfiedRequiredIds.filter((id) => required.has(id))
      : [];
  return uniqueSorted([...fromAssessments, ...fromJudge]);
}

function requiredIds(contract: ValidatedTaskContract): string[] {
  return uniqueSorted(
    contract.requirements.filter((item) => item.required).map((item) => item.id),
  );
}

function safeRefsForDisplayedProblems(
  packet: SemanticEvidencePacketV1,
  displayedProblems: readonly string[],
): SafeExceptionEvidenceRef[] {
  if (displayedProblems.length === 0) return [];
  const allowed = new Set(displayedProblems);
  const eligible: SafeExceptionEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const fact of packet.evidenceFacts) {
    if (fact.acceptance !== "COLLECTED" && fact.acceptance !== "REDACTED") continue;
    if (!allowed.has(fact.requirementId)) continue;
    if (!HEX_64.test(fact.evidenceRef) || !HEX_64.test(fact.canonicalFactHash)) continue;
    if (!isEnum(fact.evidenceKind, EVALUATION_EVIDENCE_KINDS)) continue;
    const key = `${fact.evidenceRef}:${fact.requirementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    eligible.push({
      evidenceRef: fact.evidenceRef,
      requirementId: fact.requirementId,
      evidenceKind: fact.evidenceKind as EvaluationEvidenceKind,
      canonicalFactHash: fact.canonicalFactHash,
    });
  }
  eligible.sort(
    (a, b) =>
      a.evidenceRef.localeCompare(b.evidenceRef) ||
      a.requirementId.localeCompare(b.requirementId),
  );
  return eligible;
}

function exactSafeRef(value: SafeExceptionEvidenceRef): SafeExceptionEvidenceRef {
  return {
    evidenceRef: value.evidenceRef,
    requirementId: value.requirementId,
    evidenceKind: value.evidenceKind,
    canonicalFactHash: value.canonicalFactHash,
  };
}

function factsOrphaned(packet: SemanticEvidencePacketV1): boolean {
  const ids = new Set(packet.requirementAssessments.map((item) => item.requirementId));
  for (const fact of packet.evidenceFacts as readonly EvidenceFact[]) {
    if (!ids.has(fact.requirementId) && packet.requirements.every((req) => req.id !== fact.requirementId)) {
      return true;
    }
  }
  return false;
}

/**
 * Total / never-throw. Reconstructs EvaluationRouteInput and calls
 * existing routeEvaluation(). A route-shaped object is not authority.
 */
export function buildExceptionEnvelope(raw: unknown): BuildExceptionEnvelopeResult {
  try {
    return buildInner(raw);
  } catch {
    return failed("ENVELOPE_INPUT_INVALID");
  }
}

function buildInner(raw: unknown): BuildExceptionEnvelopeResult {
  if (!isPlainObject(raw) || extraKeys(raw, INPUT_KEYS).length > 0) {
    return failed("ENVELOPE_INPUT_INVALID");
  }

  const parsedContract = parseTaskContract(raw.taskContract);
  if (!parsedContract.ok) return failed("ENVELOPE_INPUT_INVALID");
  const contract = parsedContract.contract;

  const packetCheck = validateEvidencePacketForSemanticJudge(raw.packet);
  if (!packetCheck.ok) return failed("ENVELOPE_INPUT_INVALID");
  const packet = packetCheck.packet;

  const expectedHash = contractHashOf(contract);
  if (
    packet.contract.semanticContractHash !== expectedHash ||
    packet.taskType !== contract.taskType ||
    packet.contract.taskType !== contract.taskType ||
    packet.contract.riskClass !== contract.riskClass ||
    packet.contract.automationLevel !== contract.automationLevel
  ) {
    return failed("MIXED_AUTHORITY_SNAPSHOTS");
  }

  const judge = raw.judge === undefined ? null : parseJudge(raw.judge);
  if (judge === "invalid") return failed("ENVELOPE_INPUT_INVALID");
  if (judge && judge.packetHash !== null && judge.packetHash !== packet.packetHash) {
    return failed("MIXED_AUTHORITY_SNAPSHOTS");
  }

  let evaluationState: { outcome: EvaluationOutcomeHint; verdictState: EvaluationVerdictState };
  if (judge) {
    const fromJudge = evaluationFromJudge(judge);
    if (!fromJudge) return failed("ENVELOPE_INPUT_INVALID");
    if (raw.evaluationState !== undefined) {
      const supplied = parseEvaluationState(raw.evaluationState);
      if (!supplied) return failed("ENVELOPE_INPUT_INVALID");
      if (
        supplied.outcome !== fromJudge.outcome ||
        supplied.verdictState !== fromJudge.verdictState
      ) {
        return failed("MIXED_AUTHORITY_SNAPSHOTS");
      }
    }
    evaluationState = fromJudge;
  } else {
    const supplied = parseEvaluationState(raw.evaluationState);
    if (!supplied) return failed("ENVELOPE_INPUT_INVALID");
    evaluationState = supplied;
  }

  const derivedEvidence = {
    status: toEvaluationEvidenceStatus(packet.status),
    privacyClass: undefined as EvaluationPrivacyClass | undefined,
  };
  if (raw.evidenceState !== undefined) {
    const supplied = parseEvidenceState(raw.evidenceState);
    if (!supplied) return failed("ENVELOPE_INPUT_INVALID");
    if (supplied.status !== derivedEvidence.status) {
      return failed("MIXED_AUTHORITY_SNAPSHOTS");
    }
    derivedEvidence.privacyClass = supplied.privacyClass;
  }

  const recoveryState = parseRecoveryState(raw.recoveryState);
  if (!recoveryState) return failed("ENVELOPE_INPUT_INVALID");
  const budgetState = parseBudgetState(raw.budgetState);
  if (!budgetState) return failed("ENVELOPE_INPUT_INVALID");
  if (
    raw.recoveryState &&
    isPlainObject(raw.recoveryState) &&
    raw.recoveryState.cyclesUsed !== undefined &&
    budgetState.recoveryCyclesUsed !== recoveryState.cyclesUsed
  ) {
    return failed("MIXED_AUTHORITY_SNAPSHOTS");
  }

  const policySignals = parsePolicySignals(raw.policySignals);
  if (policySignals === "invalid") return failed("ENVELOPE_INPUT_INVALID");

  let observedAt: string | null = null;
  if (raw.observedAt !== undefined && raw.observedAt !== null) {
    if (typeof raw.observedAt !== "string" || !ISO_OBSERVED_AT.test(raw.observedAt)) {
      return failed("ENVELOPE_INPUT_INVALID");
    }
    observedAt = raw.observedAt;
  }

  if (factsOrphaned(packet)) return failed("ENVELOPE_INPUT_INVALID");

  const routeInput: EvaluationRouteInput = {
    taskContract: contract,
    evaluationState,
    evidenceState: derivedEvidence,
    recoveryState: {
      status: recoveryState.status,
      cyclesUsed: recoveryState.cyclesUsed,
    },
    budgetState,
    policySignals,
  };
  const canonical = routeEvaluation(routeInput);

  if (raw.expectedRoute !== undefined) {
    const expected = parseExpectedRoute(raw.expectedRoute);
    if (!expected) return failed("ENVELOPE_INPUT_INVALID");
    if (!routesEqual(expected, canonical)) return failed("EXPECTED_ROUTE_MISMATCH");
  }

  if (canonical.decision !== "HUMAN_ESCALATE") {
    return failed("NOT_HUMAN_ESCALATE");
  }
  if (!isEnum(canonical.reasonCode, P2_4_HUMAN_ESCALATION_REASON_CODES)) {
    return failed("ENVELOPE_INPUT_INVALID");
  }

  const required = boundedPrefix(requiredIds(contract), MAX_REQUIRED_REQUIREMENT_IDS);
  const problems = boundedPrefix(
    problemIds({ contract, packet, judge }),
    MAX_PROBLEM_REQUIREMENT_IDS,
  );
  const eligibleRefs = safeRefsForDisplayedProblems(packet, problems.displayed);
  const refs = boundedPrefix(eligibleRefs, MAX_SAFE_EVIDENCE_REFS);
  const attemptKeys = boundedPrefix(
    uniqueSorted(recoveryState.attemptKeys),
    MAX_RECOVERY_ATTEMPT_KEYS,
  );

  const judgeProposalHash = judge ? judge.proposalHash : null;
  const identity: ExceptionIdentityInput = {
    version: A2P2_EXCEPTION_IDENTITY_VERSION,
    routerVersion: canonical.routerVersion,
    semanticContractHash: expectedHash,
    packetHash: packet.packetHash,
    routeReasonCode: canonical.reasonCode,
    evaluationOutcome: evaluationState.outcome,
    verdictState: evaluationState.verdictState,
    judgeProposalHash,
    recoveryStatus: recoveryState.status,
  };
  const exceptionId = computeExceptionIdentity(identity);
  const safeSummary = canonical.reasonCode.slice(0, MAX_SAFE_SUMMARY_CHARS);

  const envelope: A2P2ExceptionEnvelopeV1 = {
    version: A2P2_EXCEPTION_ENVELOPE_VERSION,
    exceptionId,
    taskType: contract.taskType,
    semanticContractHash: expectedHash,
    packetHash: packet.packetHash,
    judgeProposalHash,
    routeDecision: "HUMAN_ESCALATE",
    routeReasonCode: canonical.reasonCode as P24HumanEscalationReasonCode,
    routerVersion: canonical.routerVersion,
    riskClass: contract.riskClass,
    automationLevel: contract.automationLevel,
    requiredRequirementCount: required.count,
    requiredRequirementIds: required.displayed,
    requiredRequirementsTruncated: required.truncated,
    problemRequirementCount: problems.count,
    problemRequirementIds: problems.displayed,
    problemRequirementsTruncated: problems.truncated,
    evidenceStatus: derivedEvidence.status,
    evaluationOutcome: evaluationState.outcome,
    verdictState: evaluationState.verdictState,
    recoveryStatus: recoveryState.status,
    recoveryCyclesUsed: recoveryState.cyclesUsed,
    recoveryAttemptKeys: attemptKeys.displayed,
    safeEvidenceRefCount: refs.count,
    safeEvidenceRefs: refs.displayed.map(exactSafeRef),
    safeEvidenceRefsTruncated: refs.truncated,
    safeSummary,
    observedAt,
  };

  for (const ref of envelope.safeEvidenceRefs) {
    if (extraKeys(ref as unknown as Record<string, unknown>, SAFE_REF_KEYS).length > 0) {
      return failed("ENVELOPE_INPUT_INVALID");
    }
  }

  return { ok: true, reason: null, envelope };
}
