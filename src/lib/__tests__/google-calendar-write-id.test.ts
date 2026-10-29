/**
 * Google 日历写路径目标日历（fix-gcal-push-calendar-id）：纯函数，无真实 Google / DB
 * 运行：npx tsx src/lib/__tests__/google-calendar-write-id.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primaryWriteCalendarId } from "@/lib/google-calendar-id";

let passed = 0;
function eq(name: string, actual: string, expected: string) {
  assert.equal(actual, expected, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("google-calendar-write-id");

eq("null → primary", primaryWriteCalendarId(null), "primary");
eq("undefined → primary", primaryWriteCalendarId(undefined), "primary");
eq("空串 → primary", primaryWriteCalendarId(""), "primary");
eq("只有逗号空格 → primary", primaryWriteCalendarId(" , ,"), "primary");
eq("单个 primary → primary", primaryWriteCalendarId("primary"), "primary");
eq(
  "多选取第一项（共享日历在前）",
  primaryWriteCalendarId("a@group.calendar.google.com,primary"),
  "a@group.calendar.google.com",
);
eq("多选取第一项并去空格", primaryWriteCalendarId(" primary , b "), "primary");
eq("跳过空的第一项，与读路径一致", primaryWriteCalendarId(",b@group.calendar.google.com"), "b@group.calendar.google.com");

// 源码断言：四个写路径都经过同一个 helper，不再直接把整串 calendarId 传给 Google
const src = readFileSync(join(process.cwd(), "src/lib/google-calendar.ts"), "utf8");
const helperCalls = src.match(/primaryWriteCalendarId\(provider\.calendarId\)/g) ?? [];
assert.equal(helperCalls.length, 4, "pushEventToGoogle / updateGoogleEvent / deleteGoogleEvent / getGoogleEventDetail 都用 primaryWriteCalendarId");
passed += 1;
console.log("  ✓ 四个写路径都用 primaryWriteCalendarId");
assert.equal(/calendarId:\s*provider\.calendarId\s*\|\|/.test(src), false, "不再把整串 provider.calendarId 直接作为 calendarId");
passed += 1;
console.log("  ✓ 不再把整串 provider.calendarId 直接传给 Google");

console.log(`\n${passed} passed`);
