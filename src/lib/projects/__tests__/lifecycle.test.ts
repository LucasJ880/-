import assert from "node:assert/strict";
import {
  buildProjectLifecycleWhere,
  isActionableProject,
  isProjectLifecycleFilter,
  projectLifecycleLabel,
} from "../lifecycle";

assert.equal(isProjectLifecycleFilter("active"), true);
assert.equal(isProjectLifecycleFilter("bogus"), false);

assert.deepEqual(buildProjectLifecycleWhere("active"), {
  status: "active",
  abandonedAt: null,
});
assert.deepEqual(buildProjectLifecycleWhere("completed"), {
  status: "completed",
});
assert.deepEqual(buildProjectLifecycleWhere("archived"), {
  status: "archived",
});
assert.deepEqual(buildProjectLifecycleWhere("abandoned"), {
  OR: [{ status: "abandoned" }, { abandonedAt: { not: null } }],
});
assert.deepEqual(buildProjectLifecycleWhere("all"), {});

assert.equal(
  isActionableProject({ status: "active", abandonedAt: null }),
  true
);
assert.equal(
  isActionableProject({ status: "active", abandonedAt: new Date() }),
  false
);
assert.equal(isActionableProject({ status: "completed" }), false);
assert.equal(isActionableProject({ status: "archived" }), false);
assert.equal(isActionableProject({ status: "abandoned" }), false);

assert.equal(projectLifecycleLabel("active"), "进行中");
assert.equal(projectLifecycleLabel("completed"), "已完成");
assert.equal(projectLifecycleLabel("archived"), "已归档");
assert.equal(projectLifecycleLabel("abandoned"), "已放弃");
assert.equal(
  projectLifecycleLabel("active", new Date("2026-01-01")),
  "已放弃"
);

console.log("lifecycle.test.ts OK");
