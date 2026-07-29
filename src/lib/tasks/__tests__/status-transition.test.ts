/**
 * Task 状态 normalize + 转换规则
 * 运行：npx tsx src/lib/tasks/__tests__/status-transition.test.ts
 */

import {
  isTaskCompleted,
  isTaskOpen,
  isTaskWaiting,
  normalizeTaskStatus,
} from "../status";
import { transitionTaskStatus } from "../transition";
import { isUrgentTask, isWaitingUntilDue } from "../group";

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

console.log("task-status-transition");

ok(normalizeTaskStatus("todo") === "todo", "旧 todo");
ok(normalizeTaskStatus("in_progress") === "in_progress", "旧 in_progress");
ok(normalizeTaskStatus("done") === "done", "旧 done");
ok(normalizeTaskStatus("cancelled") === "cancelled", "旧 cancelled");
ok(normalizeTaskStatus("TODO") === "todo", "大写 TODO");
ok(normalizeTaskStatus("completed") === "done", "别名 completed→done");
ok(normalizeTaskStatus("BLOCKED") === "blocked", "BLOCKED");
ok(isTaskOpen("todo") && isTaskOpen("blocked"), "开放状态含 blocked");
ok(!isTaskOpen("done") && !isTaskOpen("cancelled"), "完成态非开放");
ok(isTaskWaiting("waiting_external"), "waiting 识别");
ok(isTaskCompleted("done"), "completed 识别");

const blockedOk = transitionTaskStatus({
  currentStatus: "todo",
  nextStatus: "blocked",
  blockedReason: "缺图纸",
});
ok(blockedOk.ok === true, "BLOCKED 有原因通过");

const blockedFail = transitionTaskStatus({
  currentStatus: "todo",
  nextStatus: "blocked",
  blockedReason: "",
});
ok(
  blockedFail.ok === false && blockedFail.code === "BLOCKED_REASON_REQUIRED",
  "BLOCKED 无原因拒绝",
);

const waitFail = transitionTaskStatus({
  currentStatus: "in_progress",
  nextStatus: "waiting_external",
});
ok(
  waitFail.ok === false && waitFail.code === "WAITING_ON_REQUIRED",
  "WAITING 无对象拒绝",
);

const waitOk = transitionTaskStatus({
  currentStatus: "in_progress",
  nextStatus: "WAITING_INTERNAL",
  waitingOn: "等待 Lucas 审批",
  waitingUntil: "2026-07-20T12:00:00Z",
});
ok(waitOk.ok === true && waitOk.status === "waiting_internal", "WAITING_INTERNAL");

const done = transitionTaskStatus({
  currentStatus: "todo",
  nextStatus: "done",
});
ok(done.ok === true && done.completedAt instanceof Date, "DONE 写 completedAt");

const reopen = transitionTaskStatus({
  currentStatus: "done",
  nextStatus: "todo",
});
ok(reopen.ok === true && reopen.completedAt === null, "从 DONE 恢复清除 completedAt");

const cancel = transitionTaskStatus({
  currentStatus: "todo",
  nextStatus: "cancelled",
});
ok(cancel.ok === true && !isTaskOpen(cancel.status), "CANCELLED 非开放");

const now = new Date("2026-07-13T12:00:00Z");
ok(
  isWaitingUntilDue("2026-07-13T10:00:00Z", now),
  "waitingUntil 已到期",
);
ok(
  !isWaitingUntilDue("2026-07-14T10:00:00Z", now),
  "waitingUntil 未到期",
);

ok(
  isUrgentTask(
    {
      id: "1",
      status: "blocked",
      priority: "medium",
      dueDate: null,
      updatedAt: now,
    },
    now,
  ),
  "BLOCKED 属立即处理",
);

ok(
  isUrgentTask(
    {
      id: "2",
      status: "waiting_external",
      priority: "medium",
      dueDate: null,
      waitingUntil: "2026-07-12T00:00:00Z",
      updatedAt: now,
    },
    now,
  ),
  "waitingUntil 到期 → 立即处理",
);

ok(
  !isUrgentTask(
    {
      id: "3",
      status: "waiting_external",
      priority: "medium",
      dueDate: null,
      waitingUntil: "2026-07-20T00:00:00Z",
      updatedAt: now,
    },
    now,
  ),
  "waitingUntil 未到 → 非立即处理",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
