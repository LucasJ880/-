/**
 * 工作区访问策略 + 默认入口
 * 运行：npx tsx src/lib/rbac/__tests__/workspace-policy.test.ts
 */

import {
  canAccessBidWorkspace,
  canAccessManagementWorkspace,
  canAccessOperationsWorkspace,
  canAccessSalesWorkspace,
  getDefaultWorkspace,
  type WorkspacePolicyContext,
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

function ctx(
  partial: Partial<WorkspacePolicyContext>,
): WorkspacePolicyContext {
  return {
    platformRole: "user",
    orgRole: "org_member",
    enabledModules: ["sales", "bids", "projects", "operations", "marketing"],
    hasMembership: true,
    ...partial,
  };
}

console.log("workspace-policy");

ok(canAccessManagementWorkspace(ctx({ platformRole: "boss" })), "老板可进管理总览");
ok(
  canAccessManagementWorkspace(ctx({ platformRole: "admin" })),
  "平台管理员可进管理总览",
);
ok(
  canAccessManagementWorkspace(
    ctx({ platformRole: "user", orgRole: "org_admin" }),
  ),
  "组织管理员可进管理总览",
);
ok(
  !canAccessManagementWorkspace(ctx({ platformRole: "operations" })),
  "运营专职不视为管理层",
);

ok(
  canAccessOperationsWorkspace(ctx({ platformRole: "operations" })),
  "运营角色可进 /ops",
);
ok(
  canAccessOperationsWorkspace(ctx({ platformRole: "boss" })),
  "管理层可进 /ops",
);
ok(
  !canAccessOperationsWorkspace(ctx({ platformRole: "sales" })),
  "销售默认不可进 /ops",
);
ok(
  !canAccessOperationsWorkspace(ctx({ platformRole: "user" })),
  "裸 user 不可进 /ops",
);

ok(
  canAccessBidWorkspace(ctx({ platformRole: "boss" })),
  "管理层可进 /bids",
);
ok(
  !canAccessBidWorkspace(ctx({ platformRole: "user", hasMembership: true })),
  "user + 模块但无项目成员不可进 /bids",
);
ok(
  canAccessBidWorkspace(
    ctx({
      platformRole: "user",
      hasMembership: true,
      hasBidCapability: true,
    }),
  ),
  "user + 模块 + 项目成员可进 /bids",
);
ok(
  !canAccessBidWorkspace(
    ctx({
      platformRole: "user",
      enabledModules: ["sales", "operations"],
      hasBidCapability: true,
    }),
  ),
  "有项目成员但无 bids/projects 模块不可进 /bids",
);
ok(
  !canAccessBidWorkspace(ctx({ platformRole: "operations" })),
  "operations 默认不可进 /bids",
);
ok(
  canAccessBidWorkspace(
    ctx({
      platformRole: "operations",
      permissionKeys: ["project.read"],
    }),
  ),
  "operations + project.read 可进 /bids",
);
ok(
  !canAccessBidWorkspace(ctx({ platformRole: "sales" })),
  "sales 默认不可进 /bids",
);

ok(
  canAccessSalesWorkspace(ctx({ platformRole: "sales" })),
  "销售可进销售中心",
);
ok(
  canAccessSalesWorkspace(ctx({ platformRole: "boss" })),
  "管理层可进销售中心",
);

ok(getDefaultWorkspace(ctx({ platformRole: "boss" })) === "/", "管理层默认 /");
ok(
  getDefaultWorkspace(ctx({ platformRole: "admin" })) === "/",
  "平台管理员默认 /",
);
ok(
  getDefaultWorkspace(ctx({ platformRole: "sales" })) === "/sales/home",
  "销售默认 /sales/home",
);
ok(
  getDefaultWorkspace(ctx({ platformRole: "operations" })) === "/ops",
  "运营默认 /ops",
);
ok(
  getDefaultWorkspace(
    ctx({
      platformRole: "user",
      hasMembership: true,
      hasBidCapability: true,
    }),
  ) === "/bids",
  "招投标专职（user+模块+项目成员）默认 /bids",
);
ok(
  getDefaultWorkspace(
    ctx({
      platformRole: "user",
      enabledModules: ["sales", "operations"],
      hasMembership: true,
    }),
  ) === "/",
  "无明确工作区 → /",
);
ok(
  getDefaultWorkspace(
    ctx({
      platformRole: "operations",
      permissionKeys: ["project.read"],
    }),
  ) === "/ops",
  "运营兼投标能力时仍优先运营专职入口 /ops",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
