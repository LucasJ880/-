/**
 * 运营首页归类纯函数
 * 运行：npx tsx src/lib/operations/dashboard/__tests__/classify.test.ts
 */

import {
  isDueTodayDueDate,
  isOpenTaskStatus,
  isOverdueDueDate,
  isStaleOpenTask,
  truncatePreview,
} from "../classify";

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

console.log("ops-dashboard-classify");

const todayStart = new Date(2026, 6, 13, 0, 0, 0, 0);
const todayEnd = new Date(2026, 6, 13, 23, 59, 59, 999);
const now = new Date(2026, 6, 13, 12, 0, 0, 0);

ok(isOpenTaskStatus("todo"), "todo 为开放状态");
ok(isOpenTaskStatus("in_progress"), "in_progress 为开放状态");
ok(!isOpenTaskStatus("done"), "done 非开放");
ok(!isOpenTaskStatus("cancelled"), "cancelled 非开放");

ok(
  isOverdueDueDate(new Date(2026, 6, 12, 18, 0), todayStart),
  "昨天截止=逾期",
);
ok(
  !isOverdueDueDate(new Date(2026, 6, 13, 10, 0), todayStart),
  "今天截止≠逾期",
);
ok(!isOverdueDueDate(null, todayStart), "无截止日期≠逾期");

ok(
  isDueTodayDueDate(new Date(2026, 6, 13, 15, 0), todayStart, todayEnd),
  "今天截止=今日到期",
);
ok(
  !isDueTodayDueDate(new Date(2026, 6, 14, 9, 0), todayStart, todayEnd),
  "明天截止≠今日到期",
);

ok(
  isStaleOpenTask(new Date(2026, 6, 1, 12, 0), now),
  "超过 7 天未更新=陈旧",
);
ok(
  !isStaleOpenTask(new Date(2026, 6, 12, 12, 0), now),
  "昨天更新≠陈旧",
);

ok(truncatePreview("abc") === "abc", "短预览原样返回");
ok(
  (truncatePreview("x".repeat(200)) ?? "").endsWith("…"),
  "长预览截断",
);
ok(truncatePreview(null) === null, "空预览为 null");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
