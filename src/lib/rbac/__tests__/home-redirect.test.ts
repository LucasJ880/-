/**
 * `/` 服务端工作区重定向
 * 运行：npx tsx src/lib/rbac/__tests__/home-redirect.test.ts
 */

import {
  getDefaultWorkspace,
  resolveHomeRedirect,
} from "../workspace-policy";

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

console.log("home-redirect");

ok(
  resolveHomeRedirect({ platformRole: "boss" }) === null,
  "管理层访问 / 不重定向",
);
ok(
  resolveHomeRedirect({ platformRole: "super_admin" }) === null,
  "平台管理员访问 / 不重定向",
);
ok(
  resolveHomeRedirect({
    platformRole: "user",
    orgRole: "org_admin",
    hasMembership: true,
  }) === null,
  "组织管理员访问 / 不重定向",
);

ok(
  resolveHomeRedirect({ platformRole: "operations", permissionKeys: ["operations.read"] }) === "/ops",
  "运营人员（持 operations.read）直接访问 / → /ops",
);
ok(
  resolveHomeRedirect({ platformRole: "sales" }) === "/sales/home",
  "销售人员直接访问 / → /sales/home",
);
ok(
  resolveHomeRedirect({
    platformRole: "user",
    enabledModules: ["bids", "projects"],
    hasMembership: true,
    hasBidCapability: true,
  }) === "/bids",
  "招投标人员直接访问 / → /bids",
);
ok(
  resolveHomeRedirect({
    platformRole: "user",
    enabledModules: ["bids", "projects"],
    hasMembership: true,
    hasBidCapability: false,
  }) === "/tasks",
  "仅模块无项目成员 → 安全回退 /tasks",
);
ok(
  resolveHomeRedirect({
    platformRole: "sales",
    orgRole: "org_admin",
    hasMembership: true,
  }) === null,
  "多工作区管理层仍进入 /",
);

ok(
  getDefaultWorkspace({ platformRole: "operations", permissionKeys: ["operations.read"] }) === "/ops",
  "getDefaultWorkspace 运营（持 operations.read）=/ops",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
