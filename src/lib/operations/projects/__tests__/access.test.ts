/**
 * Phase 4：团队权限集中函数
 * 运行：npx tsx src/lib/operations/projects/__tests__/access.test.ts
 */

import {
  canManageDeliveryProjects,
  canViewAllDeliveryProjects,
  canViewTeamTasks,
} from "../access";

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

console.log("\nops access");

ok(
  !canViewTeamTasks({ platformRole: "operations" }),
  "普通 operations 不能自动看团队任务",
);

ok(
  !canViewAllDeliveryProjects({ platformRole: "operations" }),
  "普通 operations 不能自动看全部执行项目",
);

ok(
  canViewTeamTasks({ platformRole: "admin" }),
  "平台 admin 可看团队任务",
);

ok(
  canViewTeamTasks({ platformRole: "user", orgRole: "org_admin" }),
  "组织管理员可看团队任务",
);

ok(
  canViewTeamTasks({
    platformRole: "operations",
    permissionKeys: ["operations.tasks.team.read"],
  }),
  "显式 capability 可看团队任务",
);

ok(
  canManageDeliveryProjects({
    platformRole: "operations",
    permissionKeys: ["operations.projects.manage"],
  }),
  "显式 manage capability 可管理执行项目",
);

ok(
  !canManageDeliveryProjects({
    platformRole: "operations",
    permissionKeys: ["operations.read"],
  }),
  "仅 operations.read 不能管理执行项目",
);

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
