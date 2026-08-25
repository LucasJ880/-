/**
 * Autopilot A2-P2.3 — recovery types, attempt keys, fail-closed delta parser.
 *
 * Pure library. No Prisma, worker, network, PDF, or Judge.
 */

import {
  EVALUATION_EVIDENCE_KINDS,
  isEvaluationRecoveryActionKind,
  isForbiddenSideEffectAction,
  type EvaluationEvidenceKind,
  type EvaluationRecoveryActionKind,
  type EvaluationRecoveryStatus,
  type EvaluationRouteDecisionKind,
  type EvaluationRouteReasonCode,
} from "./a2p2-contract";
import { canonicalJson, sha256Hex } from "./a2p2-evidence-hash";
import type {
  EvidencePacketStatus,
  SemanticEvidencePacketV1,
} from "./a2p2-evidence-types";

export const A2P2_RECOVERY_SURFACE = "A2_P2_3_AUTO_RECOVERY_LOOP" as const;
export const A2P2_RECOVERY_ATTEMPT_KEY_VERSION = "a2p2-recovery-attempt-key-v1" as const;
export const A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION = "a2p2-recovery-snapshot-delta-v1" as const;

export const P2_3_SUPPORTED_ACTIONS = [
  "SEARCH_PROJECT_DOCUMENTS",
  "SEARCH_INTERNAL_FACTS",
  "REFRESH_SOURCE_FACTS",
  "RECHECK_TOOL_RESULT",
] as const satisfies readonly EvaluationRecoveryActionKind[];

export const P2_3_UNSUPPORTED_ACTIONS = [
  "SEARCH_PUBLIC_WEB",
  "SEARCH_AWARD_HISTORY",
  "READ_EXISTING_DOCUMENT",
] as const satisfies readonly EvaluationRecoveryActionKind[];

export type P23SupportedAction = (typeof P2_3_SUPPORTED_ACTIONS)[number];

export const RECOVERY_DELTA_STATUSES = [
  "FOUND",
  "NOT_FOUND",
  "UNCHANGED",
  "REJECTED",
] as const;
export type RecoveryDeltaStatus = (typeof RECOVERY_DELTA_STATUSES)[number];

export const RECOVERY_SOURCE_TYPES = [
  "STRUCTURED_TENDER_FACT",
  "STRUCTURED_PROJECT_INDEX",
  "STRUCTURED_INTERNAL_FACT",
  "STRUCTURED_TOOL_RESULT",
] as const;
export type RecoverySourceType = (typeof RECOVERY_SOURCE_TYPES)[number];

export const AUTO_RECOVERY_LOOP_OUTCOMES = [
  "EVIDENCE_READY_FOR_REEVALUATION",
  "ROUTED",
  "REFUSED_IN_PROGRESS",
  "CONTRACT_INVALID",
] as const;
export type AutoRecoveryLoopOutcome = (typeof AUTO_RECOVERY_LOOP_OUTCOMES)[number];

const REQUIREMENT_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_REQUIREMENT_IDS = 16;
const MAX_FACTS = 32;
const MAX_SOURCE_REFS = 16;
const MAX_ID_LENGTH = 80;
const MAX_SOURCE_ID_LENGTH = 128;
const MAX_SAFE_STRING = 500;
const MAX_SCALAR_ARRAY = 20;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/i;

export type SafeNormalizedValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

export const P2_3_TENDER_RECOVERY_EVIDENCE_KIND = "SOURCE_FACT" as const;

export const TENDER_V1_REQUIREMENT_FACT_KEYS: Readonly<Record<string, string>> = {
  submission_deadline: "closing_datetime",
  submission_method: "submission_method",
  pricing_requirements: "pricing_method",
  evaluation_criteria: "evaluation_criteria",
};

export const TENDER_V1_UNSUPPORTED_RECOVERY_REQUIREMENTS = [
  "mandatory_requirements",
] as const;

export type RecoveryDeltaFact = {
  requirementId: string;
  evidenceKind: EvaluationEvidenceKind;
  factKey: string;
  normalizedValue: SafeNormalizedValue;
  sourceId: string;
  contentHash: string;
  pageNumber: number;
};

export type RecoverySourceRef = {
  sourceType: RecoverySourceType;
  sourceId: string;
  contentHash: string;
};

export type RecoverySnapshotDelta = {
  version: typeof A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION;
  actionKind: EvaluationRecoveryActionKind;
  requirementIds: readonly string[];
  facts: readonly RecoveryDeltaFact[];
  sourceRefs: readonly RecoverySourceRef[];
  status: RecoveryDeltaStatus;
  externalResearchUsed: boolean;
  costUsd: number;
};

export type RecoveryAdapterRequest = {
  actionKind: EvaluationRecoveryActionKind;
  requirementIds: readonly string[];
  recoveryAttemptKey: string;
  reasonCode: EvaluationRouteReasonCode;
  packetHash: string;
};

export type RecoveryAdapter = {
  actionKind: EvaluationRecoveryActionKind;
  declaredMaxCostUsd: number;
  execute: (request: RecoveryAdapterRequest) => RecoverySnapshotDelta;
};

export type RecoveryLedgerEntry = {
  cycleIndex: number;
  recoveryAttemptKey: string | null;
  actionKind: EvaluationRecoveryActionKind | null;
  requirementIds: readonly string[];
  adapterStatus:
    | "NOT_CALLED"
    | "CALLED"
    | "ERROR"
    | "REJECTED"
    | "NO_PROGRESS"
    | "APPLIED";
  deltaAccepted: boolean;
  sourceSnapshotHashAfter: string;
  packetHashAfter: string;
  packetStatusAfter: EvidencePacketStatus;
  routeDecisionBefore: EvaluationRouteDecisionKind;
  routeDecisionAfter: EvaluationRouteDecisionKind | null;
  externalResearchUsed: boolean;
  costUsd: number;
  noProgress: boolean;
};

export type AutoRecoveryLoopResult = {
  outcome: AutoRecoveryLoopOutcome;
  terminalRoute: {
    decision: EvaluationRouteDecisionKind;
    reasonCode: EvaluationRouteReasonCode;
    allowedNextActions: readonly EvaluationRecoveryActionKind[];
  } | null;
  recoveryState: {
    status: EvaluationRecoveryStatus;
    cyclesUsed: number;
    attemptKeys: readonly string[];
  };
  budgetState: {
    judgeCallsUsed: number;
    recoveryCyclesUsed: number;
    externalSearchesUsed: number;
    costUsdUsed: number;
  };
  packet: SemanticEvidencePacketV1;
  packetHash: string;
  packetStatus: EvidencePacketStatus;
  structuredSources: unknown;
  ledger: readonly RecoveryLedgerEntry[];
  adapterCallCount: number;
  routeCallCount: number;
  judgeCallCount: 0;
};

export function isP23SupportedAction(value: string): value is P23SupportedAction {
  return (P2_3_SUPPORTED_ACTIONS as readonly string[]).includes(value);
}

export function isP23UnsupportedAction(value: string): boolean {
  return (P2_3_UNSUPPORTED_ACTIONS as readonly string[]).includes(value);
}

export function computeRecoveryAttemptKey(input: {
  semanticContractHash: string;
  packetHash: string;
  reasonCode: string;
  actionKind: EvaluationRecoveryActionKind;
  requirementIds: readonly string[];
}): string {
  return sha256Hex(
    canonicalJson({
      version: A2P2_RECOVERY_ATTEMPT_KEY_VERSION,
      semanticContractHash: input.semanticContractHash,
      packetHash: input.packetHash,
      reasonCode: input.reasonCode,
      actionKind: input.actionKind,
      requirementIds: [...input.requirementIds].sort(),
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && allowed.every((key) => keys.includes(key));
}

function isSafeScalar(value: unknown): value is string | number | boolean | null {
  if (value === null) return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_SAFE_STRING;
  return false;
}

function isSafeNormalizedValue(value: unknown): value is SafeNormalizedValue {
  if (isSafeScalar(value)) return true;
  if (!Array.isArray(value) || value.length > MAX_SCALAR_ARRAY) return false;
  return value.every(isSafeScalar);
}

function parseRequirementIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_REQUIREMENT_IDS) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length > MAX_ID_LENGTH) return null;
    if (!REQUIREMENT_ID_PATTERN.test(item)) return null;
    if (seen.has(item)) return null;
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

function parseFact(value: unknown): RecoveryDeltaFact | null {
  if (!isPlainObject(value)) return null;
  if (
    !exactKeys(value, [
      "requirementId",
      "evidenceKind",
      "factKey",
      "normalizedValue",
      "sourceId",
      "contentHash",
      "pageNumber",
    ])
  ) {
    return null;
  }
  if (
    typeof value.requirementId !== "string" ||
    value.requirementId.length > MAX_ID_LENGTH ||
    !REQUIREMENT_ID_PATTERN.test(value.requirementId)
  ) {
    return null;
  }
  if (
    typeof value.evidenceKind !== "string" ||
    !(EVALUATION_EVIDENCE_KINDS as readonly string[]).includes(value.evidenceKind)
  ) {
    return null;
  }
  if (
    typeof value.factKey !== "string" ||
    value.factKey.length < 1 ||
    value.factKey.length > MAX_ID_LENGTH
  ) {
    return null;
  }
  if (!isSafeNormalizedValue(value.normalizedValue)) return null;
  if (
    typeof value.sourceId !== "string" ||
    value.sourceId.length < 1 ||
    value.sourceId.length > MAX_SOURCE_ID_LENGTH
  ) {
    return null;
  }
  if (typeof value.contentHash !== "string" || !CONTENT_HASH_PATTERN.test(value.contentHash)) {
    return null;
  }
  if (
    typeof value.pageNumber !== "number" ||
    !Number.isInteger(value.pageNumber) ||
    value.pageNumber < 1 ||
    value.pageNumber > 10_000
  ) {
    return null;
  }
  return {
    requirementId: value.requirementId,
    evidenceKind: value.evidenceKind as EvaluationEvidenceKind,
    factKey: value.factKey,
    normalizedValue: value.normalizedValue,
    sourceId: value.sourceId,
    contentHash: value.contentHash.toLowerCase(),
    pageNumber: value.pageNumber,
  };
}

function parseSourceRef(value: unknown): RecoverySourceRef | null {
  if (!isPlainObject(value)) return null;
  if (!exactKeys(value, ["sourceType", "sourceId", "contentHash"])) return null;
  if (
    typeof value.sourceType !== "string" ||
    !(RECOVERY_SOURCE_TYPES as readonly string[]).includes(value.sourceType)
  ) {
    return null;
  }
  if (
    typeof value.sourceId !== "string" ||
    value.sourceId.length < 1 ||
    value.sourceId.length > MAX_SOURCE_ID_LENGTH
  ) {
    return null;
  }
  if (typeof value.contentHash !== "string" || !CONTENT_HASH_PATTERN.test(value.contentHash)) {
    return null;
  }
  return {
    sourceType: value.sourceType as RecoverySourceType,
    sourceId: value.sourceId,
    contentHash: value.contentHash.toLowerCase(),
  };
}

export type ParseRecoveryDeltaResult =
  | { ok: true; delta: RecoverySnapshotDelta }
  | { ok: false; reason: "MALFORMED_DELTA" };

export function parseRecoverySnapshotDelta(value: unknown): ParseRecoveryDeltaResult {
  if (!isPlainObject(value)) return { ok: false, reason: "MALFORMED_DELTA" };
  if (
    !exactKeys(value, [
      "version",
      "actionKind",
      "requirementIds",
      "facts",
      "sourceRefs",
      "status",
      "externalResearchUsed",
      "costUsd",
    ])
  ) {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  if (value.version !== A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION) {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  if (
    typeof value.actionKind !== "string" ||
    !isEvaluationRecoveryActionKind(value.actionKind) ||
    isForbiddenSideEffectAction(value.actionKind)
  ) {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  const requirementIds = parseRequirementIds(value.requirementIds);
  if (!requirementIds) return { ok: false, reason: "MALFORMED_DELTA" };
  if (!Array.isArray(value.facts) || value.facts.length > MAX_FACTS) {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  const facts: RecoveryDeltaFact[] = [];
  for (const item of value.facts) {
    const parsed = parseFact(item);
    if (!parsed) return { ok: false, reason: "MALFORMED_DELTA" };
    facts.push(parsed);
  }
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length > MAX_SOURCE_REFS) {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  const sourceRefs: RecoverySourceRef[] = [];
  for (const item of value.sourceRefs) {
    const parsed = parseSourceRef(item);
    if (!parsed) return { ok: false, reason: "MALFORMED_DELTA" };
    sourceRefs.push(parsed);
  }
  if (
    typeof value.status !== "string" ||
    !(RECOVERY_DELTA_STATUSES as readonly string[]).includes(value.status)
  ) {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  if (typeof value.externalResearchUsed !== "boolean") {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  if (typeof value.costUsd !== "number" || !Number.isFinite(value.costUsd)) {
    return { ok: false, reason: "MALFORMED_DELTA" };
  }
  return {
    ok: true,
    delta: {
      version: A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION,
      actionKind: value.actionKind,
      requirementIds,
      facts,
      sourceRefs,
      status: value.status as RecoveryDeltaStatus,
      externalResearchUsed: value.externalResearchUsed,
      costUsd: value.costUsd,
    },
  };
}

export type RecoveryPlanBinding = {
  actionKind: EvaluationRecoveryActionKind;
  requirementIds: readonly string[];
};

export type BindRecoveryDeltaResult =
  | { ok: true }
  | { ok: false; reason: "DELTA_NOT_BOUND_TO_REQUEST" };

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = sortedIds(left);
  const b = sortedIds(right);
  return a.every((id, index) => id === b[index]);
}

function sourceKey(sourceId: string, contentHash: string): string {
  return `${sourceId}|${contentHash}`;
}

export function bindRecoveryDeltaToPlan(input: {
  delta: RecoverySnapshotDelta;
  plan: RecoveryPlanBinding;
}): BindRecoveryDeltaResult {
  if (input.delta.actionKind !== input.plan.actionKind) {
    return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
  }
  if (!sameIdSet(input.delta.requirementIds, input.plan.requirementIds)) {
    return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
  }
  const planIds = new Set(input.plan.requirementIds);
  for (const fact of input.delta.facts) {
    if (!planIds.has(fact.requirementId)) {
      return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
    }
    if (fact.evidenceKind !== P2_3_TENDER_RECOVERY_EVIDENCE_KIND) {
      return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
    }
    const expectedKey = TENDER_V1_REQUIREMENT_FACT_KEYS[fact.requirementId];
    if (!expectedKey || fact.factKey !== expectedKey) {
      return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
    }
    if (
      (TENDER_V1_UNSUPPORTED_RECOVERY_REQUIREMENTS as readonly string[]).includes(
        fact.requirementId,
      )
    ) {
      return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
    }
  }

  if (input.delta.status === "FOUND") {
    if (input.delta.facts.length < 1 || input.delta.sourceRefs.length < 1) {
      return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
    }
    const refs = new Map<string, RecoverySourceRef>();
    for (const ref of input.delta.sourceRefs) {
      const key = sourceKey(ref.sourceId, ref.contentHash);
      if (refs.has(key)) return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
      refs.set(key, ref);
    }
    const used = new Set<string>();
    for (const fact of input.delta.facts) {
      const key = sourceKey(fact.sourceId, fact.contentHash);
      if (!refs.has(key)) return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
      used.add(key);
    }
    if (used.size !== refs.size) {
      return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
    }
  } else if (
    input.delta.status === "NOT_FOUND" ||
    input.delta.status === "UNCHANGED" ||
    input.delta.status === "REJECTED"
  ) {
    if (input.delta.facts.length > 0 || input.delta.sourceRefs.length > 0) {
      return { ok: false, reason: "DELTA_NOT_BOUND_TO_REQUEST" };
    }
  }
  return { ok: true };
}
