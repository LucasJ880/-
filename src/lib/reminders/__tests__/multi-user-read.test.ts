/**
 * 多用户独立确认同一 deadline reminder（无 DB，验证存储契约）
 *
 * 1. 两用户可独立确认同一 deadline
 * 2. A 的 read marker 不影响 B
 * 3. 两人数据库 sourceKey 互不冲突
 */
import assert from "node:assert/strict";
import {
  buildReadKeySet,
  isReminderRead,
  reminderReadMarkerKey,
  resolveReminderReadStorageKey,
} from "../canonical-key";

const TASK = "T123";
const BUSINESS = `deadline:${TASK}`;

const userA = "user-lucas";
const userB = "user-alex";

const aStorage = resolveReminderReadStorageKey(userA, `deadline:today:${TASK}`);
const bStorage = resolveReminderReadStorageKey(
  userB,
  `deadline:overdue:${TASK}`
);

assert.equal(aStorage.businessKey, BUSINESS);
assert.equal(bStorage.businessKey, BUSINESS);
assert.equal(aStorage.kind, "marker");
assert.equal(bStorage.kind, "marker");

// 3. 两人数据库记录互不冲突（全局 @unique sourceKey 不同）
assert.notEqual(aStorage.storageKey, bStorage.storageKey);
assert.equal(
  aStorage.storageKey,
  reminderReadMarkerKey(userA, BUSINESS)
);
assert.equal(
  bStorage.storageKey,
  reminderReadMarkerKey(userB, BUSINESS)
);

// 模拟 DB 中已有 A 的 marker；B 尚未确认
const dbRows = [
  { userId: userA, sourceKey: aStorage.storageKey, status: "read" },
];

function readSetFor(userId: string) {
  return buildReadKeySet(
    userId,
    dbRows.filter((r) => r.userId === userId).map((r) => r.sourceKey)
  );
}

// 1 & 2：A 确认后仍看到已读；B 仍未读，可继续确认
assert.equal(isReminderRead(BUSINESS, readSetFor(userA)), true);
assert.equal(isReminderRead(BUSINESS, readSetFor(userB)), false);

// B 确认后写入自己的 marker
dbRows.push({
  userId: userB,
  sourceKey: bStorage.storageKey,
  status: "read",
});
assert.equal(isReminderRead(BUSINESS, readSetFor(userA)), true);
assert.equal(isReminderRead(BUSINESS, readSetFor(userB)), true);

// 即使把 A 的行泄露到查询结果，B 的 buildReadKeySet 也会忽略异用户 marker
const poisonedB = buildReadKeySet(userB, [
  aStorage.storageKey,
  bStorage.storageKey,
]);
assert.equal(isReminderRead(BUSINESS, poisonedB), true);
const onlyForeign = buildReadKeySet(userB, [aStorage.storageKey]);
assert.equal(isReminderRead(BUSINESS, onlyForeign), false);

console.log("multi-user-read.test.ts OK");
