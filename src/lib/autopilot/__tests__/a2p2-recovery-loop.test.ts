/**
 * Autopilot A2-P2.3 auto-recovery loop — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-recovery-loop.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTaskContract } from "../a2p2-contract";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import { runAutoRecoveryLoop } from "../a2p2-recovery-loop";
import {
  A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION,
  computeRecoveryAttemptKey,
  type RecoveryAdapter,
  type RecoverySnapshotDelta,
} from "../a2p2-recovery-types";
import { resolveTaskContract } from "../a2p2-templates";

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

const NOW = new Date("2026-01-01T00:00:00.000Z");
const ZERO_HASH = "a".repeat(64);

function tenderContract() {
  return resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
}

function delta(
  partial: Partial<RecoverySnapshotDelta> & Pick<RecoverySnapshotDelta, "actionKind" | "status">,
): RecoverySnapshotDelta {
  return {
    version: A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION,
    requirementIds: partial.requirementIds ?? ["submission_deadline"],
    facts: partial.facts ?? [],
    sourceRefs: partial.sourceRefs ?? [],
    externalResearchUsed: partial.externalResearchUsed ?? false,
    costUsd: partial.costUsd ?? 0,
    ...partial,
  };
}

function foundDeadline(actionKind: RecoverySnapshotDelta["actionKind"]): RecoverySnapshotDelta {
  return delta({
    actionKind,
    status: "FOUND",
    requirementIds: ["submission_deadline", "mandatory_requirements"],
    facts: [
      {
        requirementId: "submission_deadline",
        evidenceKind: "SOURCE_FACT",
        factKey: "closing_datetime",
        normalizedValue: "2026-09-15T14:00",
        sourceId: "doc-1",
        contentHash: ZERO_HASH,
      },
      {
        requirementId: "mandatory_requirements",
        evidenceKind: "SOURCE_FACT",
        factKey: "mandatory_requirements",
        normalizedValue: "Bidder must provide a bid bond equal to 10 percent.",
        sourceId: "doc-1",
        contentHash: ZERO_HASH,
      },
    ],
    sourceRefs: [
      {
        sourceType: "STRUCTURED_PROJECT_INDEX",
        sourceId: "doc-1",
        contentHash: ZERO_HASH,
      },
    ],
  });
}

function adapter(
  actionKind: RecoveryAdapter["actionKind"],
  execute: RecoveryAdapter["execute"],
  declaredMaxCostUsd = 0,
): RecoveryAdapter {
  return { actionKind, declaredMaxCostUsd, execute };
}

console.log("autopilot A2-P2.3 auto-recovery loop");

const contract = tenderContract();
const originalSources = {};
const originalPacket = buildEvidencePacket({
  contract,
  structuredSources: originalSources,
  now: NOW,
});
const originalPacketJson = JSON.stringify(originalPacket);

let publicWebCalls = 0;
let awardCalls = 0;
let rawDocCalls = 0;
let hiddenRetries = 0;
const seenKeys = new Map<string, number>();

function track(
  kind: RecoveryAdapter["actionKind"],
  body: RecoveryAdapter["execute"],
): RecoveryAdapter["execute"] {
  return (request) => {
    if (kind === "SEARCH_PUBLIC_WEB") publicWebCalls += 1;
    if (kind === "SEARCH_AWARD_HISTORY") awardCalls += 1;
    if (kind === "READ_EXISTING_DOCUMENT") rawDocCalls += 1;
    const count = (seenKeys.get(request.recoveryAttemptKey) ?? 0) + 1;
    seenKeys.set(request.recoveryAttemptKey, count);
    if (count > 1) hiddenRetries += 1;
    return body(request);
  };
}

const sufficientAdapters: RecoveryAdapter[] = [
  adapter(
    "SEARCH_PROJECT_DOCUMENTS",
    track("SEARCH_PROJECT_DOCUMENTS", () => foundDeadline("SEARCH_PROJECT_DOCUMENTS")),
  ),
  adapter("SEARCH_PUBLIC_WEB", track("SEARCH_PUBLIC_WEB", () => foundDeadline("SEARCH_PUBLIC_WEB"))),
  adapter("SEARCH_AWARD_HISTORY", track("SEARCH_AWARD_HISTORY", () => foundDeadline("SEARCH_AWARD_HISTORY"))),
  adapter("READ_EXISTING_DOCUMENT", track("READ_EXISTING_DOCUMENT", () => foundDeadline("READ_EXISTING_DOCUMENT"))),
];

const sufficient = runAutoRecoveryLoop({
  contract,
  structuredSources: originalSources,
  adapters: sufficientAdapters,
  now: NOW,
});

ok(sufficient.outcome === "EVIDENCE_READY_FOR_REEVALUATION", "SUFFICIENT_STOPS_BEFORE_JUDGE", sufficient.outcome);
ok(sufficient.packetStatus === "SUFFICIENT", "rebuilt packet is SUFFICIENT", sufficient.packetStatus);
ok(sufficient.judgeCallCount === 0, "RUN_SEMANTIC_JUDGE_CALL_COUNT = 0");
ok(sufficient.routeCallCount >= 1, "EVERY_CYCLE_REROUTES_FIRST", sufficient.routeCallCount);
ok(sufficient.adapterCallCount === 1, "ONE_ACTION_PER_CYCLE on success path", sufficient.adapterCallCount);
ok(
  sufficient.ledger.every((row) => {
    const executed = ["APPLIED", "CALLED", "REJECTED", "ERROR", "NO_PROGRESS"].includes(row.adapterStatus);
    return !executed || row.actionKind === "SEARCH_PROJECT_DOCUMENTS";
  }),
  "TRIPLE_ACTION_INTERSECTION executed SEARCH_PROJECT_DOCUMENTS only",
  sufficient.ledger.map((row) => row.actionKind),
);
ok(publicWebCalls === 0, "PUBLIC_WEB_CALL_COUNT = 0");
ok(awardCalls === 0, "AWARD_HISTORY_CALL_COUNT = 0");
ok(rawDocCalls === 0, "RAW_DOCUMENT_READ_CALL_COUNT = 0");
ok(JSON.stringify(originalPacket) === originalPacketJson, "DIRECT_PACKET_MUTATION = ZERO");

const rebuilt = buildEvidencePacket({
  contract,
  structuredSources: sufficient.structuredSources,
  now: NOW,
});
ok(rebuilt.packetHash === sufficient.packetHash, "P2_1_BUILDER_ONLY_REBUILD", {
  rebuilt: rebuilt.packetHash,
  loop: sufficient.packetHash,
});

const research = runAutoRecoveryLoop({
  contract: resolveTaskContract({ domainHint: "RESEARCH", now: NOW }),
  adapters: sufficientAdapters,
  now: NOW,
});
ok(research.adapterCallCount === 0, "NON_TENDER_DOMAIN_ZERO_ADAPTER_CALLS", research.adapterCallCount);
ok(research.recoveryState.status === "NOT_ALLOWED", "non-tender recoveryState = NOT_ALLOWED");
ok(research.routeCallCount === 1, "non-tender still reroutes once", research.routeCallCount);

const inProgress = runAutoRecoveryLoop({
  contract,
  recoveryState: { status: "IN_PROGRESS" },
  adapters: sufficientAdapters,
  now: NOW,
});
ok(inProgress.outcome === "REFUSED_IN_PROGRESS", "IN_PROGRESS is refused", inProgress.outcome);
ok(inProgress.adapterCallCount === 0, "IN_PROGRESS zero adapters");

const publicOnly = JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
const policy = publicOnly.recoveryPolicy as Record<string, unknown>;
policy.allowedActions = ["SEARCH_PUBLIC_WEB", "SEARCH_AWARD_HISTORY", "READ_EXISTING_DOCUMENT"];
const parsedPublic = parseTaskContract(publicOnly);
ok(parsedPublic.ok, "can parse unsupported-only recovery allowlist", parsedPublic);
const emptyIntersection = runAutoRecoveryLoop({
  contract: parsedPublic.ok ? parsedPublic.contract : publicOnly,
  adapters: sufficientAdapters,
  now: NOW,
});
ok(emptyIntersection.adapterCallCount === 0, "EMPTY_INTERSECTION_NOT_ALLOWED zero adapters");
ok(
  emptyIntersection.recoveryState.status === "NOT_ALLOWED",
  "EMPTY_INTERSECTION_NOT_ALLOWED_AND_REROUTES",
  emptyIntersection.recoveryState,
);
ok(emptyIntersection.routeCallCount >= 1, "empty intersection still reroutes");

const paid = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", () => foundDeadline("SEARCH_PROJECT_DOCUMENTS"), 4),
    adapter("SEARCH_INTERNAL_FACTS", () => foundDeadline("SEARCH_INTERNAL_FACTS"), 2),
    adapter("REFRESH_SOURCE_FACTS", () => foundDeadline("REFRESH_SOURCE_FACTS"), 1),
    adapter("RECHECK_TOOL_RESULT", () => foundDeadline("RECHECK_TOOL_RESULT"), 1),
  ],
  now: NOW,
});
ok(paid.adapterCallCount === 0, "DECLARED_NONZERO_COST_ZERO_CALLS", paid.adapterCallCount);

let returnedCostCalls = 0;
const returnedCost = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", () => {
      returnedCostCalls += 1;
      return delta({
        actionKind: "SEARCH_PROJECT_DOCUMENTS",
        status: "FOUND",
        costUsd: 1.25,
        facts: foundDeadline("SEARCH_PROJECT_DOCUMENTS").facts,
      });
    }),
    adapter("SEARCH_INTERNAL_FACTS", () => foundDeadline("SEARCH_INTERNAL_FACTS")),
  ],
  now: NOW,
});
ok(returnedCostCalls === 1, "nonzero returned cost still consumes one call");
ok(
  returnedCost.ledger.some((row) => row.adapterStatus === "REJECTED" && row.costUsd === 1.25),
  "RETURNED_NONZERO_COST_REJECTED",
  returnedCost.ledger,
);

const noProgressCalls: string[] = [];
const noProgressThenOther = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", () => {
      noProgressCalls.push("SEARCH_PROJECT_DOCUMENTS");
      return delta({ actionKind: "SEARCH_PROJECT_DOCUMENTS", status: "NOT_FOUND" });
    }),
    adapter("SEARCH_INTERNAL_FACTS", () => {
      noProgressCalls.push("SEARCH_INTERNAL_FACTS");
      return foundDeadline("SEARCH_INTERNAL_FACTS");
    }),
  ],
  now: NOW,
});
ok(
  noProgressCalls[0] === "SEARCH_PROJECT_DOCUMENTS" &&
    noProgressCalls.includes("SEARCH_INTERNAL_FACTS"),
  "NO_PROGRESS_DIFFERENT_SAFE_ACTION_CONTINUES",
  noProgressCalls,
);
ok(noProgressThenOther.routeCallCount >= 2, "NO_PROGRESS next cycle reroutes first", noProgressThenOther.routeCallCount);

const onlyNoProgress = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", () =>
      delta({ actionKind: "SEARCH_PROJECT_DOCUMENTS", status: "UNCHANGED" }),
    ),
  ],
  now: NOW,
});
ok(onlyNoProgress.recoveryState.status === "EXHAUSTED", "NO_PROGRESS_NO_ACTION_EXHAUSTS_AND_REROUTES", onlyNoProgress.recoveryState);
ok(onlyNoProgress.routeCallCount >= 2, "exhausted path performs terminal routeEvaluation");
ok(onlyNoProgress.adapterCallCount === 1, "REPEATED_ATTEMPT_KEY_NEVER_REEXECUTES", onlyNoProgress.adapterCallCount);

const key = computeRecoveryAttemptKey({
  semanticContractHash: originalPacket.contract.semanticContractHash,
  packetHash: originalPacket.packetHash,
  reasonCode: "AUTO_RECOVERY_MISSING_EVIDENCE",
  actionKind: "SEARCH_PROJECT_DOCUMENTS",
  requirementIds: ["submission_deadline"],
});
ok(typeof key === "string" && key.length === 64, "recoveryAttemptKey is sha256 hex", key);

let errorCalls = 0;
const errored = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", () => {
      errorCalls += 1;
      throw new Error("adapter exploded");
    }),
    adapter("SEARCH_INTERNAL_FACTS", () => foundDeadline("SEARCH_INTERNAL_FACTS")),
  ],
  now: NOW,
});
ok(errorCalls === 1, "ADAPTER_ERROR_IS_NOT_TASK_FAILURE call once");
ok(
  errored.ledger.some((row) => row.adapterStatus === "ERROR"),
  "adapter error is a consumed cycle, not task failure",
  errored.ledger.map((row) => row.adapterStatus),
);
ok(hiddenRetries === 0, "HIDDEN_RETRY_COUNT = 0", [...seenKeys.entries()]);

const src = [
  readFileSync(join(__dirname, "../a2p2-recovery-loop.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-merge.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-plan.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-types.ts"), "utf8"),
].join("\n");
ok(!/import[^;]*runSemanticJudge/.test(src) && !src.includes("from \"./a2p2-semantic-judge\""), "recovery sources never import runSemanticJudge");
ok(!src.includes("prisma"), "P2_3_PRISMA_SCHEMA_CHANGED = NO");
ok(!/\bfetch\s*\(/.test(src), "REAL_NETWORK_ADAPTERS = 0");
ok(!src.includes("while (true)"), "UNBOUNDED_LOOP_PATHS = ZERO");

if (fail > 0) {
  console.error(`FAIL ${fail}  PASS ${pass}`);
  process.exit(1);
}
console.log(`PASS ${pass}`);
