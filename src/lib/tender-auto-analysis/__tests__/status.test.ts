/**
 * TenderAnalysisRun 状态机
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/status.test.ts
 */

import assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canClaim,
  canTransition,
  isTerminal,
} from "../status";
import { InvalidTransitionError } from "../errors";
import { TENDER_ANALYSIS_STATUSES } from "../constants";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis status");

ok(
  canTransition("PENDING", "EXTRACTING"),
  "PENDING → EXTRACTING",
);
ok(
  canTransition("EXTRACTING", "ANALYZING"),
  "EXTRACTING → ANALYZING",
);
ok(
  canTransition("ANALYZING", "REVIEW_REQUIRED"),
  "ANALYZING → REVIEW_REQUIRED",
);
ok(
  canTransition("REVIEW_REQUIRED", "APPROVED"),
  "REVIEW_REQUIRED → APPROVED",
);
ok(
  canTransition("FAILED", "PENDING"),
  "FAILED → PENDING（重试）",
);
ok(
  canTransition("APPROVED", "SUPERSEDED"),
  "APPROVED → SUPERSEDED",
);
ok(
  !canTransition("APPROVED", "PENDING"),
  "APPROVED 不可回退 PENDING",
);
ok(
  !canTransition("SUPERSEDED", "PENDING"),
  "SUPERSEDED 无出边",
);
ok(
  !canTransition("PENDING", "APPROVED"),
  "不可跳过中间态",
);

try {
  assertTransition("APPROVED", "PENDING");
  fail++;
  console.error("  ✗ APPROVED→PENDING 应抛出");
} catch (e) {
  ok(e instanceof InvalidTransitionError, "抛出 InvalidTransitionError");
}

assert.doesNotThrow(() => assertTransition("PENDING", "EXTRACTING"));

ok(isTerminal("APPROVED"), "APPROVED 终态");
ok(isTerminal("SUPERSEDED"), "SUPERSEDED 终态");
ok(!isTerminal("FAILED"), "FAILED 非终态（可重试）");
ok(!isTerminal("REVIEW_REQUIRED"), "REVIEW_REQUIRED 非终态");

const now = new Date("2026-08-05T12:00:00Z");

ok(
  canClaim({ status: "PENDING" }, now),
  "PENDING 可认领",
);
ok(
  canClaim({ status: "FAILED", nextAttemptAt: null }, now),
  "FAILED 可认领",
);
ok(
  !canClaim(
    { status: "FAILED", nextAttemptAt: new Date("2026-08-05T13:00:00Z") },
    now,
  ),
  "nextAttemptAt 未到不可认领",
);
ok(
  !canClaim({ status: "REVIEW_REQUIRED" }, now),
  "REVIEW_REQUIRED 不可认领",
);
ok(
  !canClaim({ status: "APPROVED" }, now),
  "APPROVED 不可认领",
);
ok(
  canClaim(
    {
      status: "EXTRACTING",
      leaseExpiresAt: new Date("2026-08-05T11:00:00Z"),
    },
    now,
  ),
  "租约过期 EXTRACTING 可重入",
);
ok(
  !canClaim(
    {
      status: "ANALYZING",
      leaseExpiresAt: new Date("2026-08-05T13:00:00Z"),
    },
    now,
  ),
  "租约未过期 ANALYZING 不可认领",
);
ok(
  canClaim({ status: "ANALYZING", leaseExpiresAt: null }, now),
  "无租约 ANALYZING 可认领",
);

// 每个状态在 map 中有键
for (const s of TENDER_ANALYSIS_STATUSES) {
  ok(s in ALLOWED_TRANSITIONS, `ALLOWED_TRANSITIONS 含 ${s}`);
}

console.log(`\nstatus: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
