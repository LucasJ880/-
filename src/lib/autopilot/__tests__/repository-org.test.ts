/**
 * Autopilot overlay org consistency：跨 org 不得写入观察事件。
 * 运行：npx tsx src/lib/autopilot/__tests__/repository-org.test.ts
 */

import { overlayBelongsToOrg } from "../repository";

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

console.log("autopilot repository org");

const overlay = { id: "ap_run_1", orgId: "org_a" };

ok(
  overlayBelongsToOrg(overlay, "org_a") === true,
  "同 org → 允许 append",
);
ok(
  overlayBelongsToOrg(overlay, "org_b") === false,
  "跨 org → 拒绝 append（负向）",
);
ok(
  overlayBelongsToOrg(null, "org_a") === false,
  "overlay 不存在 → 拒绝",
);
ok(
  overlayBelongsToOrg(overlay, "") === false,
  "空 orgId → 拒绝",
);
ok(
  overlayBelongsToOrg({ id: "ap_run_1", orgId: "org_a" }, "org_a ") === false,
  "orgId 必须精确匹配，不 trim 脑补",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
