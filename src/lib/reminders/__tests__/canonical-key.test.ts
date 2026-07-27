import assert from "node:assert/strict";
import {
  buildReadKeySet,
  canonicalReminderKey,
  deadlineReminderKey,
  eventReminderKey,
  isReminderRead,
  reminderReadMarkerKey,
  resolveReminderReadStorageKey,
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

// ── 多用户独立确认：存储 Key 按用户隔离 ──
const lucasMarker = reminderReadMarkerKey("lucas", "deadline:T123");
const alexMarker = reminderReadMarkerKey("alex", "deadline:T123");
assert.equal(lucasMarker, "read:lucas:deadline:T123");
assert.equal(alexMarker, "read:alex:deadline:T123");
assert.notEqual(lucasMarker, alexMarker);

const lucasResolve = resolveReminderReadStorageKey("lucas", "deadline:today:T123");
const alexResolve = resolveReminderReadStorageKey("alex", "deadline:overdue:T123");
assert.equal(lucasResolve.businessKey, "deadline:T123");
assert.equal(alexResolve.businessKey, "deadline:T123");
assert.equal(lucasResolve.storageKey, lucasMarker);
assert.equal(alexResolve.storageKey, alexMarker);
assert.equal(lucasResolve.kind, "marker");
assert.equal(alexResolve.kind, "marker");

// 用户 A 确认后，仅 A 的 readSet 命中；B 仍可确认
const aKeys = [lucasMarker];
const bKeys: string[] = [];
const aSet = buildReadKeySet("lucas", aKeys);
const bSet = buildReadKeySet("alex", bKeys);
assert.equal(isReminderRead("deadline:T123", aSet), true);
assert.equal(isReminderRead("deadline:overdue:T123", aSet), true);
assert.equal(isReminderRead("deadline:T123", bSet), false);
assert.equal(isReminderRead("deadline:today:T123", bSet), false);

// A 的 marker 即使误传入 B 的 buildReadKeySet，也不应隐藏 B
const leaked = buildReadKeySet("alex", [lucasMarker, alexMarker]);
assert.equal(isReminderRead("deadline:T123", leaked), true); // alex 自己的
// 仅 lucas marker 时 B 不应命中
const onlyA = buildReadKeySet("alex", [lucasMarker]);
assert.equal(isReminderRead("deadline:T123", onlyA), false);

// 兼容：旧全局 canonical 行（属本用户时）仍生效
const legacySet = buildReadKeySet("lucas", ["deadline:t42"]);
assert.equal(isReminderRead("deadline:t42", legacySet), true);
assert.equal(isReminderRead("deadline:today:t42", legacySet), true);
assert.equal(isReminderRead("deadline:overdue:t42", legacySet), true);

const legacyRelative = buildReadKeySet("lucas", ["deadline:today:old1"]);
assert.equal(isReminderRead("deadline:old1", legacyRelative), true);

// 新 marker 写入后跨日 overdue 仍隐藏
const markerSet = buildReadKeySet("lucas", [
  reminderReadMarkerKey("lucas", "deadline:T9"),
]);
assert.equal(isReminderRead("deadline:overdue:T9", markerSet), true);

console.log("canonical-key.test.ts OK");
