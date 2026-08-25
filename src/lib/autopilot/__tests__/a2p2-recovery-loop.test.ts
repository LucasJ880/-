/**
 * Autopilot A2-P2.3 auto-recovery loop — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-recovery-loop.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTaskContract } from "../a2p2-contract";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import { runAutoRecoveryLoop } from "../a2p2-recovery-loop";
import { projectRecoveryDelta } from "../a2p2-recovery-merge";
import {
  A2P2_RECOVERY_SNAPSHOT_DELTA_VERSION,
  bindRecoveryDeltaToPlan,
  parseRecoverySnapshotDelta,
  type RecoveryAdapter,
  type RecoveryAdapterRequest,
  type RecoveryDeltaFact,
  type RecoverySnapshotDelta,
  type RecoverySourceRef,
} from "../a2p2-recovery-types";
import { resolveTaskContract } from "../a2p2-templates";
import {
  UPSTREAM_HASH_A,
  makeAnalysisResultV2,
} from "./a2p2-evidence-fixtures";

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
const REAL_DOC = "doc-1";
const REAL_PAGE = 3;
const PLAN_DEADLINE = {
  actionKind: "SEARCH_PROJECT_DOCUMENTS" as const,
  requirementIds: ["submission_deadline"],
};

function tenderContract() {
  return resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
}

function sourceRef(sourceId = REAL_DOC, contentHash = UPSTREAM_HASH_A): RecoverySourceRef {
  return {
    sourceType: "STRUCTURED_PROJECT_INDEX",
    sourceId,
    contentHash,
  };
}

function deadlineFact(overrides: Partial<RecoveryDeltaFact> = {}): RecoveryDeltaFact {
  return {
    requirementId: "submission_deadline",
    evidenceKind: "SOURCE_FACT",
    factKey: "closing_datetime",
    normalizedValue: "2026-09-15T14:00",
    sourceId: REAL_DOC,
    contentHash: UPSTREAM_HASH_A,
    pageNumber: REAL_PAGE,
    ...overrides,
  };
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

function foundDeadline(request: RecoveryAdapterRequest): RecoverySnapshotDelta {
  return delta({
    actionKind: request.actionKind,
    status: "FOUND",
    requirementIds: [...request.requirementIds],
    facts: [deadlineFact()],
    sourceRefs: [sourceRef()],
  });
}

function notFound(request: RecoveryAdapterRequest): RecoverySnapshotDelta {
  return delta({
    actionKind: request.actionKind,
    status: "NOT_FOUND",
    requirementIds: [...request.requirementIds],
    facts: [],
    sourceRefs: [],
  });
}

function adapter(
  actionKind: RecoveryAdapter["actionKind"],
  execute: RecoveryAdapter["execute"],
  declaredMaxCostUsd = 0,
): RecoveryAdapter {
  return { actionKind, declaredMaxCostUsd, execute };
}

function tenderFacts(sources: unknown): Array<Record<string, unknown>> {
  if (!sources || typeof sources !== "object") return [];
  const tender = (sources as { tender?: { facts?: unknown } }).tender;
  if (!tender || !Array.isArray(tender.facts)) return [];
  return tender.facts.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === "object",
  );
}

function evidencePages(facts: Array<Record<string, unknown>>): number[] {
  const pages: number[] = [];
  for (const fact of facts) {
    if (!Array.isArray(fact.evidence)) continue;
    for (const ref of fact.evidence) {
      if (ref && typeof ref === "object" && typeof (ref as { pageNumber?: unknown }).pageNumber === "number") {
        pages.push((ref as { pageNumber: number }).pageNumber);
      }
    }
  }
  return pages;
}

console.log("autopilot A2-P2.3 auto-recovery loop");

const contract = tenderContract();
const originalPacket = buildEvidencePacket({
  contract,
  structuredSources: {},
  now: NOW,
});
const originalPacketJson = JSON.stringify(originalPacket);
ok(originalPacket.status !== "SUFFICIENT", "empty sources packet is not SUFFICIENT", originalPacket.status);

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

const fabricatedAdapters: RecoveryAdapter[] = [
  adapter(
    "SEARCH_PROJECT_DOCUMENTS",
    track("SEARCH_PROJECT_DOCUMENTS", (request) =>
      delta({
        actionKind: request.actionKind,
        status: "FOUND",
        requirementIds: ["submission_deadline", "mandatory_requirements"],
        facts: [
          deadlineFact({ pageNumber: 1 }),
          {
            requirementId: "mandatory_requirements",
            evidenceKind: "SOURCE_FACT",
            factKey: "mandatory_requirements",
            normalizedValue: "Bidder must provide a bid bond equal to 10 percent.",
            sourceId: REAL_DOC,
            contentHash: "c".repeat(64),
            pageNumber: 1,
          },
        ],
        sourceRefs: [sourceRef(REAL_DOC, "c".repeat(64))],
      }),
    ),
  ),
  adapter("SEARCH_PUBLIC_WEB", track("SEARCH_PUBLIC_WEB", foundDeadline)),
  adapter("SEARCH_AWARD_HISTORY", track("SEARCH_AWARD_HISTORY", foundDeadline)),
  adapter("READ_EXISTING_DOCUMENT", track("READ_EXISTING_DOCUMENT", foundDeadline)),
];

const fabricated = runAutoRecoveryLoop({
  contract,
  structuredSources: {},
  adapters: fabricatedAdapters,
  now: NOW,
});
ok(fabricated.packetStatus !== "SUFFICIENT", "FABRICATED_RECOVERY_CANNOT_CREATE_SUFFICIENT", fabricated.packetStatus);
ok(fabricated.outcome !== "EVIDENCE_READY_FOR_REEVALUATION", "EMPTY_SOURCE_CANNOT_BOOTSTRAP_FAKE_TENDER", fabricated.outcome);
ok(tenderFacts(fabricated.structuredSources).length === 0, "no invented tender facts from empty sources");
ok(fabricated.judgeCallCount === 0, "RUN_SEMANTIC_JUDGE_CALL_COUNT = 0");
ok(fabricated.routeCallCount >= 1, "EVERY_CYCLE_REROUTES_FIRST", fabricated.routeCallCount);
ok(publicWebCalls === 0, "PUBLIC_WEB_CALL_COUNT = 0");
ok(awardCalls === 0, "AWARD_HISTORY_CALL_COUNT = 0");
ok(rawDocCalls === 0, "RAW_DOCUMENT_READ_CALL_COUNT = 0");
ok(JSON.stringify(originalPacket) === originalPacketJson, "DIRECT_PACKET_MUTATION = ZERO");

const truthfulSeed = { tender: makeAnalysisResultV2({ facts: [] }), research: {} };
const truthful = runAutoRecoveryLoop({
  contract,
  structuredSources: JSON.parse(JSON.stringify(truthfulSeed)) as unknown,
  adapters: [adapter("SEARCH_PROJECT_DOCUMENTS", foundDeadline)],
  now: NOW,
});
ok(
  truthful.outcome === "EVIDENCE_READY_FOR_REEVALUATION" && truthful.packetStatus === "SUFFICIENT",
  "TRUTHFUL_STRUCTURED_RECOVERY_CAN_REBUILD_PACKET",
  { outcome: truthful.outcome, status: truthful.packetStatus },
);
ok(truthful.adapterCallCount === 1, "ONE_ACTION_PER_CYCLE on truthful path", truthful.adapterCallCount);
const rebuilt = buildEvidencePacket({
  contract,
  structuredSources: truthful.structuredSources,
  now: NOW,
});
ok(rebuilt.packetHash === truthful.packetHash, "P2_1_BUILDER_ONLY_REBUILD", {
  rebuilt: rebuilt.packetHash,
  loop: truthful.packetHash,
});
ok(evidencePages(tenderFacts(truthful.structuredSources)).includes(REAL_PAGE), "RECOVERY_PAGE_LOCATOR_PRESERVED_NOT_INVENTED");
ok(!tenderFacts(truthful.structuredSources).some((fact) => fact.confidence === "HIGH"), "FABRICATED_CONFIDENCE_COUNT = ZERO");
ok((truthful.structuredSources as { research?: unknown }).research !== undefined, "unrelated structured sources are preserved");

const ghost = runAutoRecoveryLoop({
  contract,
  structuredSources: { tender: makeAnalysisResultV2({ facts: [] }) },
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", (request) =>
      delta({
        actionKind: request.actionKind,
        status: "FOUND",
        requirementIds: [...request.requirementIds],
        facts: [deadlineFact({ sourceId: "ghost-doc" })],
        sourceRefs: [sourceRef("ghost-doc")],
      }),
    ),
  ],
  now: NOW,
});
ok(ghost.packetStatus !== "SUFFICIENT", "GHOST_SOURCE_ID_REJECTED", ghost.packetStatus);
ok(ghost.ledger.some((row) => row.adapterStatus === "REJECTED"), "ghost source is rejected", ghost.ledger.map((row) => row.adapterStatus));

const hashMismatch = runAutoRecoveryLoop({
  contract,
  structuredSources: { tender: makeAnalysisResultV2({ facts: [] }) },
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", (request) =>
      delta({
        actionKind: request.actionKind,
        status: "FOUND",
        requirementIds: [...request.requirementIds],
        facts: [deadlineFact({ contentHash: "b".repeat(64) })],
        sourceRefs: [sourceRef(REAL_DOC, "b".repeat(64))],
      }),
    ),
  ],
  now: NOW,
});
ok(hashMismatch.packetStatus !== "SUFFICIENT", "SOURCE_CONTENT_HASH_MISMATCH_REJECTED", hashMismatch.packetStatus);

ok(
  !parseRecoverySnapshotDelta(
    delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [
        {
          requirementId: "submission_deadline",
          evidenceKind: "SOURCE_FACT",
          factKey: "closing_datetime",
          normalizedValue: "2026-09-15T14:00",
          sourceId: REAL_DOC,
          contentHash: UPSTREAM_HASH_A,
        } as unknown as RecoveryDeltaFact,
      ],
      sourceRefs: [sourceRef()],
    }),
  ).ok,
  "MISSING_REQUIRED_LOCATOR_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: foundDeadline({
      actionKind: "SEARCH_INTERNAL_FACTS",
      requirementIds: ["submission_deadline"],
      recoveryAttemptKey: "k",
      reasonCode: "AUTO_RECOVERY_MISSING_EVIDENCE",
      packetHash: originalPacket.packetHash,
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "DELTA_WRONG_ACTION_KIND_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      requirementIds: ["submission_deadline", "mandatory_requirements"],
      facts: [deadlineFact()],
      sourceRefs: [sourceRef()],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "DELTA_EXTRA_REQUIREMENT_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "NOT_FOUND",
      requirementIds: [],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "DELTA_MISSING_REQUIREMENT_REJECTED",
);

ok(
  !parseRecoverySnapshotDelta(
    delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "NOT_FOUND",
      requirementIds: ["submission_deadline", "submission_deadline"],
    }),
  ).ok,
  "DELTA_DUPLICATE_REQUIREMENT_ID_REJECTED",
);

const crossInject = runAutoRecoveryLoop({
  contract,
  structuredSources: { tender: makeAnalysisResultV2({ facts: [] }) },
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", (request) =>
      delta({
        actionKind: request.actionKind,
        status: "FOUND",
        requirementIds: ["submission_deadline", "mandatory_requirements"],
        facts: [
          deadlineFact(),
          {
            requirementId: "mandatory_requirements",
            evidenceKind: "SOURCE_FACT",
            factKey: "mandatory_requirements",
            normalizedValue: "Bidder must provide a bid bond equal to 10 percent.",
            sourceId: REAL_DOC,
            contentHash: UPSTREAM_HASH_A,
            pageNumber: 8,
          },
        ],
        sourceRefs: [sourceRef()],
      }),
    ),
  ],
  now: NOW,
});
ok(
  !tenderFacts(crossInject.structuredSources).some((fact) => String(fact.factType) === "mandatory_requirements"),
  "CROSS_REQUIREMENT_RECOVERY_INJECTION_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [deadlineFact({ evidenceKind: "TOOL_RESULT" })],
      sourceRefs: [sourceRef()],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "TOOL_RESULT_CANNOT_BECOME_SOURCE_FACT",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [deadlineFact({ evidenceKind: "BUSINESS_STATE" })],
      sourceRefs: [sourceRef()],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "BUSINESS_STATE_CANNOT_BECOME_SOURCE_FACT",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [deadlineFact({ factKey: "submission_method" })],
      sourceRefs: [sourceRef()],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "WRONG_FACT_KEY_FOR_REQUIREMENT_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [deadlineFact()],
      sourceRefs: [],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "FOUND_WITHOUT_SOURCE_REF_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [deadlineFact()],
      sourceRefs: [sourceRef("other-doc")],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "FACT_WITH_UNBOUND_SOURCE_REF_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [deadlineFact()],
      sourceRefs: [sourceRef(), sourceRef("doc-2", UPSTREAM_HASH_A)],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "UNUSED_SOURCE_REF_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "NOT_FOUND",
      facts: [deadlineFact()],
      sourceRefs: [sourceRef()],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "NOT_FOUND_WITH_FACTS_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "UNCHANGED",
      facts: [deadlineFact()],
      sourceRefs: [sourceRef()],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "UNCHANGED_WITH_FACTS_REJECTED",
);

ok(
  !bindRecoveryDeltaToPlan({
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      requirementIds: ["mandatory_requirements"],
      facts: [
        {
          requirementId: "mandatory_requirements",
          evidenceKind: "SOURCE_FACT",
          factKey: "closing_datetime",
          normalizedValue: "Bidder must provide a bid bond equal to 10 percent.",
          sourceId: REAL_DOC,
          contentHash: UPSTREAM_HASH_A,
          pageNumber: 8,
        },
      ],
      sourceRefs: [sourceRef()],
    }),
    plan: { actionKind: "SEARCH_PROJECT_DOCUMENTS", requirementIds: ["mandatory_requirements"] },
  }).ok,
  "ARBITRARY_TEXT_CANNOT_BECOME_BID_BOND",
);

ok(
  !projectRecoveryDelta({
    currentSources: {},
    delta: delta({
      actionKind: "SEARCH_PROJECT_DOCUMENTS",
      status: "FOUND",
      facts: [deadlineFact()],
      sourceRefs: [sourceRef()],
    }),
    plan: PLAN_DEADLINE,
  }).ok,
  "empty source cannot project a fake tender",
);

const research = runAutoRecoveryLoop({
  contract: resolveTaskContract({ domainHint: "RESEARCH", now: NOW }),
  adapters: fabricatedAdapters,
  now: NOW,
});
ok(research.adapterCallCount === 0, "NON_TENDER_DOMAIN_ZERO_ADAPTER_CALLS", research.adapterCallCount);
ok(research.recoveryState.status === "NOT_ALLOWED", "non-tender recoveryState = NOT_ALLOWED");
ok(research.routeCallCount === 1, "non-tender still reroutes once", research.routeCallCount);

const inProgress = runAutoRecoveryLoop({
  contract,
  recoveryState: { status: "IN_PROGRESS" },
  adapters: fabricatedAdapters,
  now: NOW,
});
ok(inProgress.outcome === "REFUSED_IN_PROGRESS", "IN_PROGRESS is refused", inProgress.outcome);
ok(inProgress.adapterCallCount === 0, "IN_PROGRESS zero adapters");

const publicOnly = JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
(publicOnly.recoveryPolicy as Record<string, unknown>).allowedActions = [
  "SEARCH_PUBLIC_WEB",
  "SEARCH_AWARD_HISTORY",
  "READ_EXISTING_DOCUMENT",
];
const parsedPublic = parseTaskContract(publicOnly);
ok(parsedPublic.ok, "can parse unsupported-only recovery allowlist", parsedPublic);
const emptyIntersection = runAutoRecoveryLoop({
  contract: parsedPublic.ok ? parsedPublic.contract : publicOnly,
  adapters: fabricatedAdapters,
  now: NOW,
});
ok(emptyIntersection.adapterCallCount === 0, "EMPTY_INTERSECTION_NOT_ALLOWED zero adapters");
ok(
  emptyIntersection.recoveryState.status === "NOT_ALLOWED",
  "EMPTY_INTERSECTION_NOT_ALLOWED_AND_REROUTES",
  emptyIntersection.recoveryState,
);

const paid = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", foundDeadline, 4),
    adapter("SEARCH_INTERNAL_FACTS", foundDeadline, 2),
    adapter("REFRESH_SOURCE_FACTS", foundDeadline, 1),
    adapter("RECHECK_TOOL_RESULT", foundDeadline, 1),
  ],
  now: NOW,
});
ok(paid.adapterCallCount === 0, "NONZERO_DECLARED_COST_BLOCKED_PRECALL", paid.adapterCallCount);

let returnedCostCalls = 0;
const returnedCost = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", (request) => {
      returnedCostCalls += 1;
      return delta({ ...foundDeadline(request), costUsd: 1.25 });
    }),
    adapter("SEARCH_INTERNAL_FACTS", notFound),
  ],
  now: NOW,
});
ok(returnedCostCalls >= 1, "nonzero returned cost still consumes one call");
ok(
  returnedCost.ledger.some((row) => row.adapterStatus === "REJECTED" && row.costUsd === 1.25),
  "NONZERO_RETURNED_COST_REJECTED",
  returnedCost.ledger,
);

const actionCalls: Array<{ actionKind: string; requirementIds: readonly string[] }> = [];
const sameActionDifferentRequirement = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", (request) => {
      actionCalls.push({ actionKind: request.actionKind, requirementIds: request.requirementIds });
      return notFound(request);
    }),
    adapter("SEARCH_INTERNAL_FACTS", (request) => {
      actionCalls.push({ actionKind: request.actionKind, requirementIds: request.requirementIds });
      return notFound(request);
    }),
  ],
  now: NOW,
});
ok(
  actionCalls[0]?.actionKind === "SEARCH_PROJECT_DOCUMENTS" &&
    actionCalls[0]?.requirementIds[0] === "submission_deadline",
  "first attempt is SEARCH_PROJECT_DOCUMENTS + submission_deadline",
  actionCalls,
);
ok(
  actionCalls.some(
    (item) => item.actionKind === "SEARCH_PROJECT_DOCUMENTS" && item.requirementIds[0] === "mandatory_requirements",
  ),
  "SAME_ACTION_DIFFERENT_REQUIREMENT_REMAINS_ELIGIBLE",
  actionCalls,
);
ok(
  actionCalls.some((item) => item.actionKind === "SEARCH_INTERNAL_FACTS"),
  "NO_PROGRESS_DIFFERENT_ACTION_PATH",
  actionCalls,
);
ok(sameActionDifferentRequirement.routeCallCount >= 2, "NO_PROGRESS next cycle reroutes first");

const onlyNoProgress = runAutoRecoveryLoop({
  contract,
  adapters: [adapter("SEARCH_PROJECT_DOCUMENTS", notFound)],
  now: NOW,
});
ok(onlyNoProgress.recoveryState.status === "EXHAUSTED", "NO_PROGRESS_EXHAUSTED_PATH", onlyNoProgress.recoveryState);
ok(
  new Set(onlyNoProgress.recoveryState.attemptKeys).size === onlyNoProgress.recoveryState.attemptKeys.length,
  "ATTEMPT_KEY_NOT_ACTION_KIND_IS_REPEAT_AUTHORITY",
  onlyNoProgress.recoveryState.attemptKeys,
);

let errorCalls = 0;
const errored = runAutoRecoveryLoop({
  contract,
  adapters: [
    adapter("SEARCH_PROJECT_DOCUMENTS", () => {
      errorCalls += 1;
      throw new Error("adapter exploded");
    }),
    adapter("SEARCH_INTERNAL_FACTS", notFound),
  ],
  now: NOW,
});
ok(
  errorCalls >= 1 && errorCalls <= 2,
  "ADAPTER_ERROR_IS_NOT_TASK_FAILURE consumed per attempt key, not retried",
  errorCalls,
);
ok(
  errored.ledger.some((row) => row.adapterStatus === "ERROR"),
  "adapter error is a consumed cycle, not task failure",
  errored.ledger.map((row) => row.adapterStatus),
);
ok(hiddenRetries === 0, "HIDDEN_RETRY_COUNT = 0", [...seenKeys.entries()]);

function neverThrows(name: string, run: () => void) {
  try {
    run();
    ok(true, name);
  } catch (error) {
    ok(false, name, error);
  }
}

neverThrows("CYCLIC_STRUCTURED_SOURCE_NEVER_THROWS", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const result = runAutoRecoveryLoop({
    contract,
    structuredSources: cyclic,
    adapters: fabricatedAdapters,
    now: NOW,
  });
  if (result.adapterCallCount !== 0) throw new Error(`expected zero adapters, got ${result.adapterCallCount}`);
});

neverThrows("BIGINT_STRUCTURED_SOURCE_NEVER_THROWS", () => {
  const result = runAutoRecoveryLoop({
    contract,
    structuredSources: { tender: 1n },
    adapters: fabricatedAdapters,
    now: NOW,
  });
  if (result.adapterCallCount !== 0) throw new Error(`expected zero adapters, got ${result.adapterCallCount}`);
});

neverThrows("MALFORMED_STRUCTURED_SOURCE_NEVER_THROWS", () => {
  parseRecoverySnapshotDelta(undefined);
  parseRecoverySnapshotDelta([1, 2, 3]);
  parseRecoverySnapshotDelta({ nested: { hostile: [{ x: { y: 1 } }] } });
  const result = runAutoRecoveryLoop({
    contract,
    structuredSources: { notASource: true },
    adapters: fabricatedAdapters,
    now: NOW,
  });
  if (result.adapterCallCount !== 0) throw new Error(`expected zero adapters, got ${result.adapterCallCount}`);
});

const src = [
  readFileSync(join(__dirname, "../a2p2-recovery-loop.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-merge.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-select.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-types.ts"), "utf8"),
].join("\n");
ok(!/import[^;]*runSemanticJudge/.test(src) && !src.includes('from "./a2p2-semantic-judge"'), "recovery sources never import runSemanticJudge");
ok(!src.includes("emptyTenderAnalysisResult"), "emptyTenderAnalysisResult removed from production path");
ok(!src.includes("prisma"), "P2_3_PRISMA_SCHEMA_CHANGED = NO");
ok(!/\bfetch\s*\(/.test(src), "REAL_NETWORK_ADAPTERS = 0");
ok(!src.includes("while (true)"), "UNBOUNDED_LOOP_PATHS = ZERO");
ok(!/pageNumber\s*=\s*1/.test(src), "FABRICATED_PAGE_LOCATOR_COUNT = ZERO in production recovery");
ok(!src.includes("bid bond") && !src.includes("BONDING"), "no invented bid-bond semantics");

if (fail > 0) {
  console.error(`FAIL ${fail}  PASS ${pass}`);
  process.exit(1);
}
console.log(`PASS ${pass}`);
