/**
 * Autopilot A2-P2.3 recovery planner — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-recovery-plan.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import {
  planNextRecoveryAction,
  tripleActionIntersection,
  zeroCostExecutableActions,
} from "../a2p2-recovery-plan";
import {
  P2_3_SUPPORTED_ACTIONS,
  P2_3_UNSUPPORTED_ACTIONS,
  computeRecoveryAttemptKey,
  type RecoveryAdapter,
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
const tender = resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
const emptyPacket = buildEvidencePacket({
  contract: tender,
  structuredSources: {},
  now: NOW,
});

console.log("autopilot A2-P2.3 recovery planner");

ok(emptyPacket.status !== "SUFFICIENT", "empty tender packet is not SUFFICIENT", emptyPacket.status);

const routed = [
  "SEARCH_PROJECT_DOCUMENTS",
  "SEARCH_INTERNAL_FACTS",
  "SEARCH_PUBLIC_WEB",
  "SEARCH_AWARD_HISTORY",
  "READ_EXISTING_DOCUMENT",
  "REFRESH_SOURCE_FACTS",
] as const;

const intersection = tripleActionIntersection({
  allowedNextActions: [...routed],
  contract: tender,
});

ok(
  intersection.every((action) => (P2_3_SUPPORTED_ACTIONS as readonly string[]).includes(action)),
  "TRIPLE_ACTION_INTERSECTION only emits P2.3 supported actions",
  intersection,
);
ok(
  !intersection.some((action) => (P2_3_UNSUPPORTED_ACTIONS as readonly string[]).includes(action)),
  "UNSUPPORTED_ACTION_NEVER_ENTERS_INTERSECTION",
  intersection,
);
ok(intersection.includes("SEARCH_PROJECT_DOCUMENTS"), "SEARCH_PROJECT_DOCUMENTS survives triple intersection");

const paidAdapter: RecoveryAdapter = {
  actionKind: "SEARCH_PROJECT_DOCUMENTS",
  declaredMaxCostUsd: 1,
  execute: () => {
    throw new Error("must not execute");
  },
};
ok(
  zeroCostExecutableActions({ intersection, adapters: [paidAdapter] }).length === 0,
  "DECLARED_NONZERO_COST is not executable",
);

const zeroAdapter: RecoveryAdapter = {
  actionKind: "SEARCH_PROJECT_DOCUMENTS",
  declaredMaxCostUsd: 0,
  execute: () => {
    throw new Error("planner must not execute");
  },
};
const executable = zeroCostExecutableActions({ intersection, adapters: [zeroAdapter] });
ok(executable.includes("SEARCH_PROJECT_DOCUMENTS"), "zero-cost adapter remains executable");

const attemptKeySeed = {
  semanticContractHash: emptyPacket.contract.semanticContractHash,
  packetHash: emptyPacket.packetHash,
  reasonCode: "AUTO_RECOVERY_MISSING_EVIDENCE",
};

const plan = planNextRecoveryAction({
  contract: tender,
  packet: emptyPacket,
  reasonCode: "AUTO_RECOVERY_MISSING_EVIDENCE",
  executable,
  usedAttemptKeys: new Set(),
  attemptKeySeed,
});
ok(plan?.actionKind === "SEARCH_PROJECT_DOCUMENTS", "SOURCE_FACT gap prefers SEARCH_PROJECT_DOCUMENTS", plan);
ok(plan?.requirementIds[0] === "submission_deadline", "first unready required requirement is submission_deadline", plan);

const usedDeadlineKey = computeRecoveryAttemptKey({
  ...attemptKeySeed,
  actionKind: "SEARCH_PROJECT_DOCUMENTS",
  requirementIds: ["submission_deadline"],
});
const nextPlan = planNextRecoveryAction({
  contract: tender,
  packet: emptyPacket,
  reasonCode: "AUTO_RECOVERY_MISSING_EVIDENCE",
  executable,
  usedAttemptKeys: new Set([usedDeadlineKey]),
  attemptKeySeed,
});
ok(
  nextPlan?.actionKind === "SEARCH_PROJECT_DOCUMENTS" &&
    nextPlan.requirementIds[0] === "mandatory_requirements",
  "SAME_ACTION_DIFFERENT_REQUIREMENT_REMAINS_ELIGIBLE",
  nextPlan,
);
ok(
  nextPlan?.requirementIds[0] !== "submission_deadline",
  "ATTEMPT_KEY_NOT_ACTION_KIND_IS_REPEAT_AUTHORITY",
  nextPlan,
);

const src = [
  readFileSync(join(__dirname, "../a2p2-recovery-plan.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-loop.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-merge.ts"), "utf8"),
  readFileSync(join(__dirname, "../a2p2-recovery-types.ts"), "utf8"),
].join("\n");
ok(!/import[^;]*runSemanticJudge/.test(src) && !src.includes("from \"./a2p2-semantic-judge\""), "RUN_SEMANTIC_JUDGE_CALL_COUNT source = 0");

if (fail > 0) {
  console.error(`FAIL ${fail}  PASS ${pass}`);
  process.exit(1);
}
console.log(`PASS ${pass}`);
