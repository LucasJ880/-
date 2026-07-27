import assert from "node:assert/strict";
import { removeReminderFromLayers } from "../remove-from-layers";

function item(sourceKey: string) {
  return { sourceKey, title: sourceKey };
}

const layers = {
  immediate: [item("deadline:a")],
  today: [item("deadline:b"), item("deadline:c")],
  upcoming: [item("deadline:d")],
  unreadCount: 4,
};

const next = removeReminderFromLayers(layers, "deadline:b");
assert.equal(next.today.length, 1);
assert.equal(next.today[0]?.sourceKey, "deadline:c");
assert.equal(next.immediate.length, 1);
assert.equal(next.upcoming.length, 1);
assert.equal(next.unreadCount, 3);

// 原对象不被原地修改
assert.equal(layers.today.length, 2);
assert.equal(layers.unreadCount, 4);

console.log("remove-from-layers.test.ts OK");
