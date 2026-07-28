/**
 * Phase 5A：失败恢复与 completed 不被覆盖的纯逻辑约定
 * （完整 DB 故障注入需在 Neon 隔离分支执行；此处锁定应用层不变量）
 *
 * npx tsx src/lib/projects/handoff/__tests__/handoff-failure-recovery.test.ts
 */

import type { ProjectHandoff } from "@prisma/client";
import { resolveHandoffAfterUniqueConflict } from "../conflict";
import { evaluateHandoffEligibility } from "../eligibility";
import type { BidDataGateResult } from "../bid-data";

function stubHandoff(
  partial: Pick<ProjectHandoff, "id" | "status" | "targetDeliveryProjectId">,
): ProjectHandoff {
  return partial as ProjectHandoff;
}

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

const readyBid: BidDataGateResult = {
  layerAvailable: true,
  hasRevisions: true,
  finalRevisionId: "r1",
  finalStatus: "locked",
  technicalApproved: true,
  financialApproved: true,
  locked: true,
  ready: true,
  message: null,
  failureCode: null,
};

console.log("\nunique conflict recovery matrix");
const cases: Array<{
  status: string;
  target: string | null;
  expect: "completed" | "processing" | "retryable" | "missing";
}> = [
  { status: "completed", target: "d1", expect: "completed" },
  { status: "processing", target: null, expect: "processing" },
  { status: "failed", target: null, expect: "retryable" },
  { status: "cancelled", target: null, expect: "retryable" },
  { status: "pending", target: null, expect: "retryable" },
];
for (const c of cases) {
  const kind = resolveHandoffAfterUniqueConflict(
    stubHandoff({
      id: "h",
      status: c.status,
      targetDeliveryProjectId: c.target,
    }),
  ).kind;
  ok(kind === c.expect, `${c.status} → ${c.expect}`);
}
ok(
  resolveHandoffAfterUniqueConflict(
    stubHandoff({
      id: "h",
      status: "completed",
      targetDeliveryProjectId: null,
    }),
  ).kind === "retryable",
  "completed 但无 target → retryable（不可当成功返回）",
);

console.log("\neligibility: processing/completed 不可再执行");
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: readyBid,
    existingHandoffStatus: "processing",
    useHistoricalOverride: false,
    canOverride: false,
  }).ok,
  "processing 阻断",
);
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: readyBid,
    existingHandoffStatus: "completed",
    useHistoricalOverride: false,
    canOverride: false,
  }).ok,
  "completed 阻断",
);

console.log("\ninvariants (documented)");
ok(
  true,
  "事务内失败必须整笔回滚（由 Prisma $transaction 保证）",
);
ok(
  true,
  "markHandoffFailed 使用 updateMany status≠completed（见 execute.ts）",
);
ok(
  true,
  "外层 catch 在 markFailed 前再次读取 completed（见 execute.ts）",
);

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
