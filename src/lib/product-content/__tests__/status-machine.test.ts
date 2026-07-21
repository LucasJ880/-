/**
 * 任务状态机与批准门禁
 * 运行：npx tsx src/lib/product-content/__tests__/status-machine.test.ts
 */

import { assertTransition, canApproveJob, ALLOWED_TRANSITIONS } from "../jobs/status";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function throws(fn: () => void, name: string) {
  try {
    fn();
    fail++;
    console.error(`  ✗ ${name} (应抛出)`);
  } catch {
    pass++;
  }
}

ok(ALLOWED_TRANSITIONS.DRAFT.includes("ANALYZING"), "DRAFT 可进入 ANALYZING");
ok(!ALLOWED_TRANSITIONS.DELIVERED.includes("DRAFT"), "DELIVERED 不可回退 DRAFT");
ok(
  ALLOWED_TRANSITIONS.READY_FOR_REVIEW.includes("REVISION_REQUESTED"),
  "READY_FOR_REVIEW 可进入 REVISION_REQUESTED",
);
ok(
  ALLOWED_TRANSITIONS.REVISION_REQUESTED.includes("READY_FOR_REVIEW"),
  "REVISION_REQUESTED 可回到 READY_FOR_REVIEW",
);

throws(() => assertTransition("DELIVERED", "DRAFT"), "非法流转应拒绝");

const gateOk = canApproveJob({
  openConflictCount: 0,
  pendingApprovalCount: 0,
  hasCopy: true,
  hasZipDocument: false,
  rejectedVisualCount: 0,
  unverifiedCertificationClaims: 0,
  requiredFieldsMissing: 0,
  approvedVisualCount: 1,
  copyApproved: true,
  purpose: "FORMAL_EXTERNAL",
});
ok(gateOk.ok, "满足全部条件可通过批准门禁");

const gateBad = canApproveJob({
  openConflictCount: 1,
  pendingApprovalCount: 0,
  hasCopy: false,
  hasZipDocument: false,
  rejectedVisualCount: 1,
  unverifiedCertificationClaims: 2,
  requiredFieldsMissing: 3,
  approvedVisualCount: 0,
  copyApproved: false,
  purpose: "FORMAL_EXTERNAL",
});
ok(!gateBad.ok, "不满足条件应拒绝");
ok(gateBad.reasons.length >= 4, "应返回多条拒绝原因");

const draftOk = canApproveJob({
  openConflictCount: 0,
  pendingApprovalCount: 0,
  hasCopy: true,
  hasZipDocument: false,
  rejectedVisualCount: 0,
  unverifiedCertificationClaims: 5,
  requiredFieldsMissing: 10,
  purpose: "INTERNAL_DRAFT",
});
ok(draftOk.ok, "INTERNAL_DRAFT 文档门禁宽松");

console.log(`\nstatus-machine: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
