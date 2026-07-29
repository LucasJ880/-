/**
 * 默认工作区入口（getDefaultWorkspace）
 * 运行：npx tsx src/lib/rbac/__tests__/default-workspace.test.ts
 */

import { getDefaultWorkspace } from "../workspace-policy";

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

console.log("default-workspace");

ok(
  getDefaultWorkspace({ platformRole: "sales" }) === "/sales/home",
  "销售专职 → /sales/home",
);
ok(
  getDefaultWorkspace({ platformRole: "operations" }) === "/ops",
  "运营专职 → /ops",
);
ok(
  getDefaultWorkspace({
    platformRole: "user",
    orgRole: "org_member",
    enabledModules: ["bids", "projects"],
    hasMembership: true,
    hasBidCapability: true,
  }) === "/bids",
  "招投标专职 → /bids",
);
ok(
  getDefaultWorkspace({ platformRole: "boss" }) === "/",
  "管理层 → /",
);
ok(
  getDefaultWorkspace({ platformRole: "super_admin" }) === "/",
  "平台管理员 → /",
);
ok(
  getDefaultWorkspace({
    platformRole: "user",
    enabledModules: ["marketing"],
    hasMembership: true,
  }) === "/",
  "无明确工作区 → /",
);
ok(
  getDefaultWorkspace({
    platformRole: "sales",
    orgRole: "org_admin",
    enabledModules: ["sales", "bids", "operations"],
    hasMembership: true,
  }) === "/",
  "销售兼组织管理员 → 管理层优先 /",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
