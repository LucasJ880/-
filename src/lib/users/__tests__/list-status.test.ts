import assert from "node:assert/strict";
import { buildUserListStatusWhere } from "../service";

// 默认列表不包含 deleted
assert.deepEqual(buildUserListStatusWhere(undefined), {
  status: { not: "deleted" },
});
assert.deepEqual(buildUserListStatusWhere(""), {
  status: { not: "deleted" },
});

// 明确筛选 deleted 可查看
assert.deepEqual(buildUserListStatusWhere("deleted"), {
  status: "deleted",
});

assert.deepEqual(buildUserListStatusWhere("active"), {
  status: "active",
});

// all 含历史已删除
assert.deepEqual(buildUserListStatusWhere("all"), {});

console.log("list-status.test.ts OK");
