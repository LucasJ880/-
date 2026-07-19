/**
 * 运行：npx tsx src/lib/projects/__tests__/review-outcome.test.ts
 */
import {
  mapTenderStatusToOutcome,
  TERMINAL_TENDER_STATUSES,
} from "../review";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("▶ Project review outcome map");

ok(mapTenderStatusToOutcome("won") === "awarded", "won→awarded");
ok(mapTenderStatusToOutcome("lost") === "lost", "lost");
ok(mapTenderStatusToOutcome("no_bid") === "no_bid", "no_bid");
ok(mapTenderStatusToOutcome("cancelled") === "cancelled", "cancelled");
ok(mapTenderStatusToOutcome("pursuing") === null, "进行中不触发");
ok(TERMINAL_TENDER_STATUSES.has("lost"), "lost 为终态");
ok(!TERMINAL_TENDER_STATUSES.has("pursuing"), "pursuing 非终态");

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
