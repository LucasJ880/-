import assert from "node:assert/strict";
import {
  buildReadKeySet,
  canonicalReminderKey,
  deadlineReminderKey,
  eventReminderKey,
  isReminderRead,
} from "../canonical-key";

assert.equal(deadlineReminderKey("t1"), "deadline:t1");
assert.equal(eventReminderKey("e1"), "event:e1");

assert.equal(canonicalReminderKey("deadline:today:t1"), "deadline:t1");
assert.equal(canonicalReminderKey("deadline:tomorrow:t1"), "deadline:t1");
assert.equal(canonicalReminderKey("deadline:overdue:t1"), "deadline:t1");
assert.equal(canonicalReminderKey("deadline:t1"), "deadline:t1");
assert.equal(canonicalReminderKey("event:today:e9"), "event:e9");
assert.equal(canonicalReminderKey("event:e9"), "event:e9");
assert.equal(
  canonicalReminderKey("followup:custom:1"),
  "followup:custom:1"
);

// 旧 today / overdue 映射到同一 canonical key
assert.equal(
  canonicalReminderKey("deadline:today:abc"),
  canonicalReminderKey("deadline:overdue:abc")
);

// 今天确认后写入 canonical；第二天 overdue 旧 key 仍命中已读
const readSet = buildReadKeySet(["deadline:t42"]);
assert.equal(isReminderRead("deadline:t42", readSet), true);
assert.equal(isReminderRead("deadline:today:t42", readSet), true);
assert.equal(isReminderRead("deadline:overdue:t42", readSet), true);
assert.equal(isReminderRead("deadline:tomorrow:t42", readSet), true);
assert.equal(isReminderRead("deadline:other", readSet), false);

// 旧库里只有 legacy key 时也能挡住新 canonical
const legacySet = buildReadKeySet(["deadline:today:old1"]);
assert.equal(isReminderRead("deadline:old1", legacySet), true);
assert.equal(isReminderRead("deadline:overdue:old1", legacySet), true);

console.log("canonical-key.test.ts OK");
