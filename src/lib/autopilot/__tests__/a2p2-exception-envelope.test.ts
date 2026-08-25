/**
 * Autopilot A2-P2.4 exception envelope — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-exception-envelope.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { A2P2_ROUTER_VERSION } from "../a2p2-contract";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import {
  canonicalJson,
  hashEvidencePacket,
  makeCanonicalFactHash,
  makeEvidenceRef,
  sha256Hex,
} from "../a2p2-evidence-hash";
import type { EvidenceFact, SemanticEvidencePacketV1 } from "../a2p2-evidence-types";
import {
  buildExceptionEnvelope,
  computeExceptionIdentity,
} from "../a2p2-exception-envelope";
import {
  A2P2_EXCEPTION_IDENTITY_VERSION,
  EXCEPTION_ENVELOPE_KEYS,
  P2_4_CANONICAL_ROUTE_VERIFICATION,
  P2_4_ROUTE_AUTHORITY,
  P2_4_ROUTE_LOGIC,
} from "../a2p2-exception-types";
import { routeEvaluation } from "../a2p2-routing";
import { resolveTaskContract } from "../a2p2-templates";
import { makeAnalysisResultV2 } from "./a2p2-evidence-fixtures";

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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");
const ZERO_BUDGET = {
  judgeCallsUsed: 0,
  recoveryCyclesUsed: 0,
  externalSearchesUsed: 0,
  costUsdUsed: 0,
};

function tenderContract() {
  return resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
}

function patchContract(patch: Record<string, unknown>) {
  const raw = { ...cloneJson(tenderContract()), ...patch };
  return resolveTaskContract({ now: NOW, explicitContract: raw });
}

function packetFor(contract: ReturnType<typeof tenderContract>, sources?: unknown) {
  return buildEvidencePacket({
    contract,
    structuredSources: sources ?? { tender: makeAnalysisResultV2() },
    now: NOW,
  });
}

function rehash(packet: SemanticEvidencePacketV1): SemanticEvidencePacketV1 {
  const next = cloneJson(packet);
  next.packetHash = hashEvidencePacket(next);
  return next;
}

function highReady() {
  const contract = patchContract({ riskClass: "HIGH" });
  return { contract, packet: packetFor(contract) };
}

function manyRequiredHigh() {
  const extras = Array.from({ length: 15 }, (_, index) => ({
    id: `extra_req_${String(index).padStart(2, "0")}`,
    label: `extra requirement ${index}`,
    normalizedDescription: `extra requirement ${index}`,
    required: true,
    evidenceKinds: ["SOURCE_FACT" as const],
    minimumEvidenceRefs: 1,
    allowUnknown: false,
    criticality: "LOW" as const,
  }));
  const raw = cloneJson(tenderContract());
  raw.riskClass = "HIGH";
  raw.requirements = [...raw.requirements, ...extras];
  const contract = resolveTaskContract({ now: NOW, explicitContract: raw });
  return { contract, packet: packetFor(contract) };
}

function duplicateFact(
  template: EvidenceFact,
  requirementId: string,
  suffix: string,
  acceptance: EvidenceFact["acceptance"] = "COLLECTED",
): EvidenceFact {
  const sourceId = `src_${suffix}`;
  const factKey = `fact_${suffix}`;
  const canonicalFactHash = makeCanonicalFactHash({
    evidenceKind: template.evidenceKind,
    requirementId,
    factKey,
    normalizedValue: suffix,
    sourceType: template.source.sourceType,
    sourceId,
  });
  const evidenceRef = makeEvidenceRef({
    evidenceKind: template.evidenceKind,
    requirementId,
    factKey,
    sourceType: template.source.sourceType,
    sourceId,
    canonicalFactHash,
  });
  return {
    ...cloneJson(template),
    evidenceRef,
    requirementId,
    factKey,
    factSummary: `safe extra ${suffix}`,
    normalizedValue: suffix,
    source: { ...template.source, sourceId },
    canonicalFactHash,
    acceptance,
    countsTowardRequirement: false,
  };
}

function envelopeInput(partial: {
  contract: unknown;
  packet: unknown;
  evaluationState?: { outcome: string; verdictState: string };
  evidenceState?: { status: string; privacyClass?: string };
  recoveryState?: { status: string; cyclesUsed?: number; attemptKeys?: string[] };
  budgetState?: typeof ZERO_BUDGET;
  policySignals?: Record<string, boolean>;
  judge?: unknown;
  expectedRoute?: unknown;
  observedAt?: string | null;
}) {
  return {
    taskContract: partial.contract,
    packet: partial.packet,
    evaluationState: partial.evaluationState ?? {
      outcome: "UNKNOWN",
      verdictState: "NOT_EVALUATED",
    },
    evidenceState: partial.evidenceState,
    recoveryState: partial.recoveryState ?? { status: "AVAILABLE", cyclesUsed: 0 },
    budgetState: partial.budgetState ?? ZERO_BUDGET,
    policySignals: partial.policySignals,
    judge: partial.judge,
    expectedRoute: partial.expectedRoute,
    observedAt: partial.observedAt,
  };
}

console.log("autopilot A2-P2.4 exception envelope");

ok(P2_4_ROUTE_AUTHORITY === "NO", "P2_4_ROUTE_AUTHORITY = NO");
ok(P2_4_ROUTE_LOGIC === 0, "P2_4_ROUTE_LOGIC = ZERO");
ok(
  P2_4_CANONICAL_ROUTE_VERIFICATION === "P2_0_ROUTE_EVALUATION_ONLY",
  "P2_4_CANONICAL_ROUTE_VERIFICATION",
);

const shapedOnly = buildExceptionEnvelope({
  expectedRoute: {
    routerVersion: A2P2_ROUTER_VERSION,
    decision: "HUMAN_ESCALATE",
    reasonCode: "HUMAN_ESCALATION_HIGH_RISK",
    allowedNextActions: [],
  },
});
ok(
  !shapedOnly.ok && shapedOnly.envelope === null,
  "ROUTE_SHAPE_ALONE_HAS_NO_AUTHORITY",
  shapedOnly.reason,
);

const { contract: highContract, packet: highPacket } = highReady();
const highSnap = envelopeInput({ contract: highContract, packet: highPacket });
const highRoute = routeEvaluation({
  taskContract: highContract,
  evaluationState: { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
  evidenceState: { status: "SUFFICIENT" },
  recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
  budgetState: ZERO_BUDGET,
});
const highResult = buildExceptionEnvelope(highSnap);
ok(
  highResult.ok &&
    highResult.envelope?.routeDecision === "HUMAN_ESCALATE" &&
    highResult.envelope.routeReasonCode === highRoute.reasonCode &&
    highResult.envelope.routerVersion === highRoute.routerVersion &&
    highResult.envelope.packetHash === highPacket.packetHash,
  "CANONICAL_ROUTE_RECOMPUTED",
  highResult.ok ? highResult.envelope.routeReasonCode : highResult.reason,
);

const mismatch = buildExceptionEnvelope(
  envelopeInput({
    contract: highContract,
    packet: highPacket,
    expectedRoute: {
      routerVersion: A2P2_ROUTER_VERSION,
      decision: "HUMAN_ESCALATE",
      reasonCode: "AUTO_FINALIZED_SUFFICIENT_EVIDENCE",
      allowedNextActions: [],
    },
  }),
);
ok(
  !mismatch.ok && mismatch.reason === "EXPECTED_ROUTE_MISMATCH" && mismatch.envelope === null,
  "EXPECTED_ROUTE_MISMATCH_REJECTED",
  mismatch.reason,
);

const low = { contract: tenderContract(), packet: packetFor(tenderContract()) };
const mixed = buildExceptionEnvelope(
  envelopeInput({ contract: highContract, packet: low.packet }),
);
ok(
  !mixed.ok && mixed.reason === "MIXED_AUTHORITY_SNAPSHOTS" && mixed.envelope === null,
  "MIXED_AUTHORITY_SNAPSHOTS_REJECTED",
  mixed.reason,
);

const mixedJudge = buildExceptionEnvelope(
  envelopeInput({
    contract: highContract,
    packet: highPacket,
    judge: {
      proposalStatus: "REJECTED",
      packetHash: "c".repeat(64),
      outcome: "UNKNOWN",
      verdictState: "NOT_EVALUATED",
    },
  }),
);
ok(
  !mixedJudge.ok && mixedJudge.reason === "MIXED_AUTHORITY_SNAPSHOTS",
  "mixed Judge packetHash rejected",
  mixedJudge.reason,
);

function nonHuman(name: string, input: unknown, expectedDecision: string) {
  const routed = routeEvaluation({
    taskContract: (input as { taskContract: unknown }).taskContract,
    evaluationState: (input as { evaluationState: never }).evaluationState,
    evidenceState: {
      status: (input as { evidenceState?: { status: "SUFFICIENT" } }).evidenceState?.status ??
        (expectedDecision === "AUTO_FINALIZE" ? "SUFFICIENT" : "INSUFFICIENT"),
    },
    recoveryState: (input as { recoveryState: never }).recoveryState,
    budgetState: (input as { budgetState: never }).budgetState,
    policySignals: (input as { policySignals?: never }).policySignals,
  });
  const result = buildExceptionEnvelope(input);
  ok(
    routed.decision === expectedDecision && !result.ok && result.envelope === null,
    `NON_HUMAN_DECISIONS_ZERO_ENVELOPE ${name}`,
    { decision: routed.decision, reason: result.reason },
  );
}

const lowContract = tenderContract();
const lowPacket = packetFor(lowContract);
nonHuman(
  "AUTO_FINALIZE",
  envelopeInput({
    contract: lowContract,
    packet: lowPacket,
    evaluationState: { outcome: "TASK_SUCCESS", verdictState: "ACCEPTED" },
    evidenceState: { status: "SUFFICIENT" },
  }),
  "AUTO_FINALIZE",
);
nonHuman(
  "AUTO_ABSTAIN",
  envelopeInput({
    contract: lowContract,
    packet: packetFor(lowContract, {}),
    evaluationState: { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
    evidenceState: { status: "INSUFFICIENT" },
    recoveryState: { status: "EXHAUSTED", cyclesUsed: 3 },
    budgetState: { ...ZERO_BUDGET, recoveryCyclesUsed: 3 },
  }),
  "AUTO_ABSTAIN",
);
nonHuman(
  "POLICY_BLOCKED",
  envelopeInput({
    contract: lowContract,
    packet: lowPacket,
    policySignals: { privacyBlocked: true },
  }),
  "POLICY_BLOCKED",
);
nonHuman(
  "AUTO_RECOVER",
  envelopeInput({
    contract: lowContract,
    packet: packetFor(lowContract, {}),
    evidenceState: { status: "INSUFFICIENT" },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
  }),
  "AUTO_RECOVER",
);
nonHuman(
  "AUTO_WAIT",
  envelopeInput({
    contract: lowContract,
    packet: packetFor(lowContract, {}),
    recoveryState: { status: "IN_PROGRESS", cyclesUsed: 1 },
    budgetState: { ...ZERO_BUDGET, recoveryCyclesUsed: 1 },
  }),
  "AUTO_WAIT",
);

ok(
  highResult.ok && highResult.envelope?.routeReasonCode === "HUMAN_ESCALATION_HIGH_RISK",
  "HUMAN_REASON_BINDING HIGH",
);
const legal = buildExceptionEnvelope(
  envelopeInput({
    contract: lowContract,
    packet: lowPacket,
    policySignals: { legalCommitment: true },
  }),
);
ok(
  legal.ok && legal.envelope?.routeReasonCode === "HUMAN_ESCALATION_LEGAL_COMMITMENT",
  "HUMAN_REASON_BINDING legal",
  legal.ok ? legal.envelope.routeReasonCode : legal.reason,
);

const many = manyRequiredHigh();
const manyEnv = buildExceptionEnvelope(envelopeInput({ contract: many.contract, packet: many.packet }));
ok(
  manyEnv.ok &&
    manyEnv.envelope !== null &&
    manyEnv.envelope.requiredRequirementCount === 17 &&
    manyEnv.envelope.requiredRequirementIds.length === 16 &&
    manyEnv.envelope.requiredRequirementsTruncated === true,
  "VALID_17_REQUIRED_HUMAN_ESCALATE_HAS_ENVELOPE",
  manyEnv.ok
    ? {
        count: manyEnv.envelope.requiredRequirementCount,
        shown: manyEnv.envelope.requiredRequirementIds.length,
      }
    : manyEnv.reason,
);
const manyProblemsPacket = cloneJson(many.packet);
for (const row of manyProblemsPacket.requirementAssessments) {
  if (row.requirementId === "submission_deadline" || row.requirementId === "mandatory_requirements") {
    row.state = "INSUFFICIENT";
    row.reasonCode = "EVIDENCE_MISSING";
  }
}
const manyProblems = rehash(manyProblemsPacket);
const manyProblemEnv = buildExceptionEnvelope(
  envelopeInput({ contract: many.contract, packet: manyProblems }),
);
ok(
  manyProblemEnv.ok &&
    manyProblemEnv.envelope !== null &&
    manyProblemEnv.envelope.problemRequirementCount > 16 &&
    manyProblemEnv.envelope.problemRequirementIds.length === 16 &&
    manyProblemEnv.envelope.problemRequirementsTruncated === true,
  "VALID_MANY_PROBLEM_REQUIREMENTS_HAS_BOUNDED_ENVELOPE",
  manyProblemEnv.ok
    ? {
        count: manyProblemEnv.envelope.problemRequirementCount,
        shown: manyProblemEnv.envelope.problemRequirementIds.length,
      }
    : manyProblemEnv.reason,
);

const seedFact = highPacket.evidenceFacts[0];
ok(!!seedFact, "high packet has a seed fact");
const crowdedPacket = cloneJson(highPacket);
const problemId =
  crowdedPacket.requirementAssessments.find((item) => item.state !== "READY")?.requirementId ??
  "mandatory_requirements";
const problemAssessment = crowdedPacket.requirementAssessments.find(
  (item) => item.requirementId === problemId,
);
if (problemAssessment) {
  problemAssessment.state = "INSUFFICIENT";
  problemAssessment.reasonCode = "EVIDENCE_MISSING";
}
if (seedFact) {
  for (let index = 0; index < 33; index += 1) {
    crowdedPacket.evidenceFacts.push(
      duplicateFact(seedFact, problemId, `bulk_${index}`),
    );
  }
}
crowdedPacket.provenanceSummary.factCount = crowdedPacket.evidenceFacts.length;
const crowded = rehash(crowdedPacket);
const crowdedEnv = buildExceptionEnvelope(
  envelopeInput({ contract: highContract, packet: crowded }),
);
ok(
  crowdedEnv.ok &&
    crowdedEnv.envelope !== null &&
    crowdedEnv.envelope.safeEvidenceRefCount > 32 &&
    crowdedEnv.envelope.safeEvidenceRefs.length === 32 &&
    crowdedEnv.envelope.safeEvidenceRefsTruncated === true,
  "VALID_MORE_THAN_32_SAFE_REFS_HAS_BOUNDED_ENVELOPE",
  crowdedEnv.ok
    ? {
        count: crowdedEnv.envelope.safeEvidenceRefCount,
        shown: crowdedEnv.envelope.safeEvidenceRefs.length,
      }
    : crowdedEnv.reason,
);
ok(
  (manyEnv.ok && manyProblemEnv.ok && crowdedEnv.ok),
  "DISPLAY_OVERFLOW_DOES_NOT_DROP_EXCEPTION",
);

const blockedPacket = cloneJson(highPacket);
const blockedProblem =
  blockedPacket.requirementAssessments.find((item) => item.state !== "READY")?.requirementId ??
  "mandatory_requirements";
const blockedAssessment = blockedPacket.requirementAssessments.find(
  (item) => item.requirementId === blockedProblem,
);
if (blockedAssessment) {
  blockedAssessment.state = "INSUFFICIENT";
  blockedAssessment.reasonCode = "EVIDENCE_MISSING";
}
if (seedFact) {
  blockedPacket.evidenceFacts.push(
    duplicateFact(seedFact, blockedProblem, "blocked_one", "BLOCKED"),
  );
  blockedPacket.evidenceFacts.push(
    duplicateFact(seedFact, blockedProblem, "redacted_one", "REDACTED"),
  );
}
blockedPacket.provenanceSummary.factCount = blockedPacket.evidenceFacts.length;
const blocked = rehash(blockedPacket);
const blockedEnv = buildExceptionEnvelope(
  envelopeInput({ contract: highContract, packet: blocked }),
);
ok(
  blockedEnv.ok &&
    blockedEnv.envelope !== null &&
    blockedEnv.envelope.safeEvidenceRefs.every((item) => {
      const fact = blocked.evidenceFacts.find((row) => row.evidenceRef === item.evidenceRef);
      return fact?.acceptance === "COLLECTED" || fact?.acceptance === "REDACTED";
    }) &&
    !blocked.evidenceFacts
      .filter((item) => item.acceptance === "BLOCKED")
      .some((item) =>
        blockedEnv.envelope!.safeEvidenceRefs.some((ref) => ref.evidenceRef === item.evidenceRef),
      ),
  "BLOCKED_EVIDENCE_REF_NOT_EXPOSED",
  blockedEnv.ok ? blockedEnv.envelope.safeEvidenceRefs : blockedEnv.reason,
);

const unrelatedPacket = cloneJson(highPacket);
const deadlineReady = unrelatedPacket.requirementAssessments.find(
  (item) => item.requirementId === "submission_deadline",
);
const mandatoryRow = unrelatedPacket.requirementAssessments.find(
  (item) => item.requirementId === "mandatory_requirements",
);
if (deadlineReady) {
  deadlineReady.state = "READY";
  deadlineReady.reasonCode = "EVIDENCE_READY";
}
if (mandatoryRow) {
  mandatoryRow.state = "INSUFFICIENT";
  mandatoryRow.reasonCode = "EVIDENCE_MISSING";
}
if (seedFact) {
  unrelatedPacket.evidenceFacts.push(
    duplicateFact(seedFact, "submission_deadline", "unrelated_ok"),
  );
}
unrelatedPacket.provenanceSummary.factCount = unrelatedPacket.evidenceFacts.length;
const unrelated = rehash(unrelatedPacket);
const unrelatedEnv = buildExceptionEnvelope(
  envelopeInput({ contract: highContract, packet: unrelated }),
);
ok(
  unrelatedEnv.ok &&
    unrelatedEnv.envelope !== null &&
    unrelatedEnv.envelope.problemRequirementIds.includes("mandatory_requirements") &&
    unrelatedEnv.envelope.safeEvidenceRefs.every(
      (item) => item.requirementId === "mandatory_requirements",
    ) &&
    !unrelatedEnv.envelope.safeEvidenceRefs.some(
      (item) => item.requirementId === "submission_deadline",
    ),
  "UNRELATED_REQUIREMENT_EVIDENCE_NOT_EXPOSED",
  unrelatedEnv.ok
    ? unrelatedEnv.envelope.safeEvidenceRefs.map((item) => item.requirementId)
    : unrelatedEnv.reason,
);

ok(
  highResult.ok &&
    highResult.envelope !== null &&
    highResult.envelope.problemRequirementCount === 0 &&
    highResult.envelope.safeEvidenceRefs.length === 0 &&
    highResult.envelope.safeEvidenceRefCount === 0 &&
    highResult.envelope.safeEvidenceRefsTruncated === false,
  "EMPTY_PROBLEM_SET_HAS_ZERO_SAFE_EVIDENCE_REFS",
  highResult.ok
    ? {
        problems: highResult.envelope.problemRequirementCount,
        refs: highResult.envelope.safeEvidenceRefCount,
      }
    : highResult.reason,
);

if (highResult.ok && highResult.envelope) {
  const identity = {
    version: A2P2_EXCEPTION_IDENTITY_VERSION,
    routerVersion: highResult.envelope.routerVersion,
    semanticContractHash: highResult.envelope.semanticContractHash,
    packetHash: highResult.envelope.packetHash,
    routeReasonCode: highResult.envelope.routeReasonCode,
    evaluationOutcome: highResult.envelope.evaluationOutcome,
    verdictState: highResult.envelope.verdictState,
    judgeProposalHash: highResult.envelope.judgeProposalHash,
    recoveryStatus: highResult.envelope.recoveryStatus,
  };
  ok(
    computeExceptionIdentity(identity) === highResult.envelope.exceptionId,
    "EXCEPTION_ID_DETERMINISTIC",
  );
  ok(
    computeExceptionIdentity({ ...identity, routerVersion: "a2p2-router-v0" }) !==
      highResult.envelope.exceptionId,
    "ROUTER_VERSION_CHANGES_EXCEPTION_ID",
  );
  const withProblems = sha256Hex(
    canonicalJson({
      ...identity,
      problemRequirementIds: highResult.envelope.problemRequirementIds,
    }),
  );
  ok(
    withProblems !== highResult.envelope.exceptionId,
    "DISPLAY_TRUNCATION_DOES_NOT_CHANGE_EXCEPTION_ID",
  );
}

const proposalA = "a".repeat(64);
const proposalB = "b".repeat(64);
const judgeA = buildExceptionEnvelope(
  envelopeInput({
    contract: highContract,
    packet: highPacket,
    judge: {
      proposalStatus: "VALID",
      proposalHash: proposalA,
      packetHash: highPacket.packetHash,
      outcome: "TASK_SUCCESS",
      verdictState: "ACCEPTED",
      requirementJudgments: [],
    },
    evaluationState: { outcome: "TASK_SUCCESS", verdictState: "ACCEPTED" },
  }),
);
const judgeB = buildExceptionEnvelope(
  envelopeInput({
    contract: highContract,
    packet: highPacket,
    judge: {
      proposalStatus: "VALID",
      proposalHash: proposalB,
      packetHash: highPacket.packetHash,
      outcome: "TASK_SUCCESS",
      verdictState: "ACCEPTED",
      requirementJudgments: [],
    },
    evaluationState: { outcome: "TASK_SUCCESS", verdictState: "ACCEPTED" },
  }),
);
ok(
  judgeA.ok &&
    judgeB.ok &&
    judgeA.envelope?.judgeProposalHash === proposalA &&
    judgeB.envelope?.judgeProposalHash === proposalB &&
    judgeA.envelope.exceptionId !== judgeB.envelope.exceptionId,
  "JUDGE_PROPOSAL_CHANGE_CHANGES_EXCEPTION_ID",
  {
    a: judgeA.ok ? judgeA.envelope.exceptionId : judgeA.reason,
    b: judgeB.ok ? judgeB.envelope.exceptionId : judgeB.reason,
  },
);

ok(
  highResult.ok &&
    highResult.envelope !== null &&
    Object.keys(highResult.envelope).sort().join(",") ===
      [...EXCEPTION_ENVELOPE_KEYS].sort().join(",") &&
    highResult.envelope.safeEvidenceRefs.every((item) =>
      Object.keys(item).every((key) =>
        ["evidenceRef", "requirementId", "evidenceKind", "canonicalFactHash"].includes(key),
      ),
    ),
  "SAFE_EVIDENCE_MINIMIZATION exact keys",
);

function neverThrows(name: string, run: () => void) {
  try {
    run();
    ok(true, name);
  } catch (error) {
    ok(false, name, error);
  }
}

neverThrows("CYCLIC_INPUT_NEVER_THROWS", () => {
  const cyclic: Record<string, unknown> = { taskContract: highContract, packet: highPacket };
  cyclic.self = cyclic;
  const result = buildExceptionEnvelope(cyclic);
  if (result.envelope !== null) throw new Error("cyclic extra key must fail closed");
});
neverThrows("BIGINT_INPUT_NEVER_THROWS", () => {
  const result = buildExceptionEnvelope({
    taskContract: highContract,
    packet: highPacket,
    evaluationState: { outcome: "UNKNOWN", verdictState: "NOT_EVALUATED" },
    recoveryState: { status: "AVAILABLE", cyclesUsed: 0n },
    budgetState: ZERO_BUDGET,
  });
  if (result.ok) throw new Error("bigint cyclesUsed must fail closed");
});
neverThrows("null input never throws", () => {
  buildExceptionEnvelope(null);
  buildExceptionEnvelope(undefined);
  buildExceptionEnvelope([]);
  buildExceptionEnvelope("HUMAN_ESCALATE");
});
neverThrows("unknown fields fail closed", () => {
  const result = buildExceptionEnvelope({
    ...envelopeInput({ contract: highContract, packet: highPacket }),
    rawPrompt: "leak",
  });
  if (result.ok) throw new Error("unknown fields must reject");
});
neverThrows("bad hash / bad expectedRoute fail closed", () => {
  buildExceptionEnvelope(
    envelopeInput({
      contract: highContract,
      packet: { ...highPacket, packetHash: "not-a-hash" },
    }),
  );
  buildExceptionEnvelope(
    envelopeInput({
      contract: highContract,
      packet: highPacket,
      expectedRoute: { decision: "HUMAN_ESCALATE" },
    }),
  );
  const invalidProposal = buildExceptionEnvelope(
    envelopeInput({
      contract: highContract,
      packet: highPacket,
      judge: { proposalStatus: "VALID", proposalHash: "short", packetHash: highPacket.packetHash },
    }),
  );
  if (invalidProposal.ok) throw new Error("invalid proposalHash must reject");
});

const src = [
  readFileSync(join(__dirname, "../a2p2-exception-envelope.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-exception-types.ts"), "utf8"),
].join("\n");
ok(
  !/import[^;]*runSemanticJudge/.test(src) && !src.includes('from "./a2p2-semantic-judge"'),
  "RUN_SEMANTIC_JUDGE_CALL_COUNT_FROM_ENVELOPE_CODE = 0",
);
ok(
  !src.includes("runAutoRecoveryLoop") && !src.includes("./a2p2-recovery-loop"),
  "RECOVERY_LOOP_CALL_COUNT_FROM_ENVELOPE_CODE = 0",
);
ok(
  !src.includes("pending-actions") && !src.includes("pending-link"),
  "PENDING_ACTION_CALL_COUNT = 0",
);
ok(
  !src.includes("ApprovalRequest") &&
    !src.includes("./approval") &&
    !src.includes("lib/approval"),
  "APPROVAL_CALL_COUNT = 0",
);
ok(!src.includes("prisma") && !src.includes("PrismaClient"), "P2_4_PRISMA_SCHEMA_CHANGED = NO");
ok(!/\bfetch\s*\(/.test(src), "no network from envelope code");

if (fail > 0) {
  console.error(`FAIL ${fail}  PASS ${pass}`);
  process.exit(1);
}
console.log(`PASS ${pass}`);
