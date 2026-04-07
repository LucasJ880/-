/**
 * 国际化文案 — 完整性测试
 *
 * 运行方式: npx tsx src/lib/i18n/__tests__/zh.test.ts
 */

import { t } from "../zh";

const passed: string[] = [];
const failed: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed.push(name);
  } else {
    failed.push(name);
    console.error(`  ❌ FAIL: ${name}`);
  }
}

const keys = Object.keys(t) as Array<keyof typeof t>;
assert(keys.length > 0, `文案条数 > 0: 实际 ${keys.length}`);

for (const key of keys) {
  const val = t[key];
  assert(typeof val === "string" && val.length > 0, `${key} 是非空字符串`);
}

const required = [
  "app_name", "loading", "save", "cancel", "confirm", "delete",
  "nav_dashboard", "nav_tasks", "nav_projects", "nav_assistant",
  "status_active", "status_completed", "status_todo", "status_done",
  "priority_urgent", "priority_high", "priority_medium", "priority_low",
  "stage_initiation", "stage_submission",
  "error_unauthorized", "error_forbidden", "error_not_found",
  "empty_tasks", "empty_projects",
] as const;

for (const key of required) {
  assert(key in t, `必要文案存在: ${key}`);
}

assert(t.app_name === "青砚", `app_name === "青砚"`);

console.log(`\n${"═".repeat(50)}`);
console.log(`i18n 文案 测试结果: ${passed.length} 通过, ${failed.length} 失败`);
console.log(`${"═".repeat(50)}\n`);

if (failed.length > 0) {
  failed.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log("✅ 全部通过");
  process.exit(0);
}
