/**
 * 国际化文案 — 完整性与一致性测试
 *
 * 运行方式: npx tsx src/lib/i18n/__tests__/zh.test.ts
 */

import { zh } from "../zh";
import { en } from "../en";
import type { Messages } from "../messages";

const passed: string[] = [];
const failed: string[] = [];

function check(condition: boolean, name: string) {
  if (condition) {
    passed.push(name);
  } else {
    failed.push(name);
    console.error(`  ❌ FAIL: ${name}`);
  }
}

// ── 基础：zh 非空 ──

const zhKeys = Object.keys(zh) as Array<keyof Messages>;
check(zhKeys.length > 0, `zh 文案条数 > 0: 实际 ${zhKeys.length}`);

for (const key of zhKeys) {
  check(typeof zh[key] === "string" && zh[key].length > 0, `zh.${key} 是非空字符串`);
}

// ── 基础：en 非空 ──

const enKeys = Object.keys(en) as Array<keyof Messages>;
check(enKeys.length > 0, `en 文案条数 > 0: 实际 ${enKeys.length}`);

for (const key of enKeys) {
  check(typeof en[key] === "string" && en[key].length > 0, `en.${key} 是非空字符串`);
}

// ── 键一致性：zh 和 en 应有相同的 key ──

const zhSet = new Set(zhKeys);
const enSet = new Set(enKeys);

for (const key of zhKeys) {
  check(enSet.has(key), `en 包含 zh 的 key: ${key}`);
}
for (const key of enKeys) {
  check(zhSet.has(key), `zh 包含 en 的 key: ${key}`);
}

check(zhKeys.length === enKeys.length, `zh (${zhKeys.length}) 与 en (${enKeys.length}) 文案条数一致`);

// ── 必要 key 存在 ──

const required: Array<keyof Messages> = [
  "app_name", "loading", "save", "cancel", "confirm", "delete",
  "nav_dashboard", "nav_tasks", "nav_projects",
  "nav_group_workspace", "nav_group_sales", "nav_group_trade",
  "sidebar_expand", "sidebar_collapse",
  "header_search_placeholder", "header_logout",
  "header_notif_title", "header_notif_empty",
  "status_active", "status_completed", "status_todo", "status_done",
  "priority_urgent", "priority_high", "priority_medium", "priority_low",
  "error_unauthorized", "error_forbidden", "error_not_found",
  "empty_tasks", "empty_projects",
];

for (const key of required) {
  check(key in zh, `必要文案存在 (zh): ${key}`);
  check(key in en, `必要文案存在 (en): ${key}`);
}

// ── 品牌名 ──

check(zh.app_name === "青砚", `zh.app_name === "青砚"`);
check(en.app_name === "Qingyan", `en.app_name === "Qingyan"`);

// ── Summary ──

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
