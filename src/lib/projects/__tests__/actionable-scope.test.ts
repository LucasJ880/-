import assert from "node:assert/strict";
import { buildActionableTaskScope } from "../visibility";
import { buildProjectLifecycleWhere, isActionableProject } from "../lifecycle";

// active 项目显示；completed/archived/abandoned 不进入 active view
assert.equal(isActionableProject({ status: "active", abandonedAt: null }), true);
for (const status of ["completed", "archived", "abandoned"] as const) {
  assert.equal(
    isActionableProject({ status }),
    false,
    `${status} must leave active view`
  );
}

const activeWhere = buildProjectLifecycleWhere("active");
assert.equal(activeWhere.status, "active");
assert.equal(activeWhere.abandonedAt, null);

// 已完成项目下任务：taskScope 仅含 actionable IDs + 个人无项目任务
const scope = buildActionableTaskScope("user-1", ["proj-active"]);
assert.deepEqual(scope, {
  OR: [
    { projectId: { in: ["proj-active"] } },
    {
      projectId: null,
      OR: [{ creatorId: "user-1" }, { assigneeId: "user-1" }],
    },
  ],
});

// 空 actionable → 不会用 completed 项目 ID 撑开首页
const empty = buildActionableTaskScope("user-1", []);
assert.deepEqual(empty, {
  OR: [
    { projectId: { in: [] } },
    {
      projectId: null,
      OR: [{ creatorId: "user-1" }, { assigneeId: "user-1" }],
    },
  ],
});

console.log("actionable-scope.test.ts OK");
