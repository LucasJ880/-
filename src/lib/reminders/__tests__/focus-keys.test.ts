import assert from "node:assert/strict";
import {
  focusKeysForReminderSourceKey,
  suppressedFocusKeysFromReadSet,
} from "../focus-keys";

const deadlineKeys = focusKeysForReminderSourceKey("deadline:task123");
assert.ok(deadlineKeys.includes("task-task123"));
assert.ok(deadlineKeys.includes("rem-deadline:task123"));

const eventKeys = focusKeysForReminderSourceKey("event:evt456");
assert.ok(eventKeys.includes("evt-cal_evt456"));
assert.ok(eventKeys.includes("rem-event:evt456"));

const legacy = focusKeysForReminderSourceKey("deadline:overdue:task123");
assert.ok(legacy.includes("task-task123"));

const suppressed = suppressedFocusKeysFromReadSet(
  new Set(["deadline:a", "event:b", "read:user1:deadline:c"])
);
assert.ok(suppressed.includes("task-a"));
assert.ok(suppressed.includes("evt-cal_b"));
// read marker 经 canonical 剥落后也应能抑制
assert.ok(suppressed.includes("task-c") || suppressed.includes("rem-deadline:c"));

console.log("focus-keys.test.ts OK");
