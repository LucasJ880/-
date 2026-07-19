/**
 * 运行：npx tsx src/lib/projects/__tests__/apply-document-metadata.test.ts
 */
import { classifyDateLabel } from "../apply-document-metadata";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("▶ apply-document-metadata classifyDateLabel");

ok(classifyDateLabel("RFB Closing Date") === "closeDate", "截标英");
ok(classifyDateLabel("投标截止日期") === "closeDate", "截标中");
ok(classifyDateLabel("Bidder’s Deadline for Questions") === "questionCloseDate", "提问截止");
ok(classifyDateLabel("Issued Date") === "publicDate", "发布日");
ok(classifyDateLabel("Award Date") === "awardDate", "中标日");
ok(classifyDateLabel("无关标签") === null, "未知");

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
