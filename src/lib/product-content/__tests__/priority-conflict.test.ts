/**
 * 来源优先级与自动确认规则
 * 运行：npx tsx src/lib/product-content/__tests__/priority-conflict.test.ts
 */

import {
  compareSourcePriority,
  canAutoConfirm,
  getSourcePriority,
  SOURCE_PRIORITY,
} from "../facts/priority";
import { detectConflict, shouldOverwrite } from "../facts/conflict";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

ok(SOURCE_PRIORITY[0] === "confirmed_human", "confirmed_human 最高优先级");
ok(
  getSourcePriority("confirmed_human") < getSourcePriority("ai_inference"),
  "人工确认优先于 AI 推断",
);
ok(compareSourcePriority("pdf", "website") < 0, "pdf 优先于 website");
ok(!canAutoConfirm("ai_inference"), "AI 推断不可自动确认");
ok(canAutoConfirm("supplier_spec"), "供应商规格可自动确认");

ok(!detectConflict("Cotton", "cotton"), "字符串冲突检测忽略大小写");
ok(detectConflict("100", 100), "不同类型同值仍视为冲突");

ok(!shouldOverwrite("confirmed_human", "pdf", false), "高优先级来源不可被低优先级覆盖");
ok(shouldOverwrite("website", "pdf", false), "低优先级可被更高优先级覆盖");
ok(!shouldOverwrite("website", "pdf", true), "锁定事实不可覆盖");

console.log(`\npriority-conflict: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
