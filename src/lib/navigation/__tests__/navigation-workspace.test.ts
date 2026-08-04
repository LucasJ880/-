/**
 * 导航工作区入口可见性（与 workspace-policy 对齐）
 * 运行：npx tsx src/lib/navigation/__tests__/navigation-workspace.test.ts
 */

import {
  NAVIGATION_REGISTRY,
  resolveNavigationTree,
  type NavigationFilterContext,
} from "../index";

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
  partial: Partial<NavigationFilterContext>,
): NavigationFilterContext {
  return {
    pathname: "/",
    platformRole: "user",
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: ["ws1"],
    modules: {
      enabled: [
        "sales",
        "trade",
        "operations",
        "marketing",
        "product_content",
        "bids",
        "projects",
      ],
    },
    isPlatformAdmin: false,
    ...partial,
  };
}

console.log("navigation-workspace");

const wsOps = NAVIGATION_REGISTRY.find((i) => i.key === "ws-ops");
const wsBids = NAVIGATION_REGISTRY.find((i) => i.key === "ws-bids");
ok(wsOps?.href === "/ops", "运营中心入口 /ops");
ok(wsBids?.href === "/bids", "招投标中心入口 /bids");
ok(wsOps?.workspaceAccess === "operations", "ws-ops 绑定 operations 策略");
ok(wsBids?.workspaceAccess === "bids", "ws-bids 绑定 bids 策略");

const opsCenter = NAVIGATION_REGISTRY.find((i) => i.key === "ops-center");
ok(opsCenter?.href === "/operations/center", "旧管理模块路由保留");
ok(opsCenter?.label === "管理模块", "旧入口不再冒充运营中心");

const growth = NAVIGATION_REGISTRY.find((i) => i.key === "growth-hub");
ok(growth?.group === "GROWTH", "内容增长归属品牌增长");
ok(growth?.label === "品牌增长", "品牌增长文案");

const opsNav = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ platformRole: "operations" }),
);
ok(opsNav.some((i) => i.key === "ws-ops"), "运营可见运营中心");
ok(!opsNav.some((i) => i.key === "ws-bids"), "运营默认不看招投标中心");
ok(!opsNav.some((i) => i.key === "nav-projects"), "运营不显示 /projects");
ok(
  !opsNav.some((i) => i.key === "nav-project-intel"),
  "运营不显示项目智能",
);
ok(opsNav.some((i) => i.href === "/tasks" || i.key === "work-tasks"), "运营仍可见任务");
ok(
  opsNav.some((i) => i.key === "ws-ops-projects" && i.href === "/ops/projects"),
  "运营可见执行项目入口 /ops/projects",
);
ok(opsNav.some((i) => i.group === "GROWTH"), "运营仍可见品牌增长");
ok(
  !opsNav.some((i) => i.key === "ops-center"),
  "运营不看旧管理模块（OPERATIONS 组隐藏）",
);

const bossNav = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ platformRole: "boss", orgRole: "org_admin" }),
);
ok(bossNav.some((i) => i.key === "ws-ops"), "管理层可见运营中心");
ok(bossNav.some((i) => i.key === "ws-bids"), "管理层可见招投标中心");
ok(bossNav.some((i) => i.key === "ops-center"), "管理层可见管理模块启动页");
ok(
  bossNav.some((i) => i.key === "work-home" && i.label === "管理总览"),
  "管理层首页为管理总览",
);

const salesNav = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ platformRole: "sales" }),
);
ok(!salesNav.some((i) => i.key === "ws-ops"), "销售不看运营中心");
ok(!salesNav.some((i) => i.key === "ws-bids"), "销售不看招投标中心");
ok(salesNav.some((i) => i.key === "sales-home"), "销售可见销售中心");

const userNav = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ platformRole: "user", hasBidCapability: true }),
);
ok(
  userNav.some((i) => i.key === "ws-bids"),
  "user+模块+项目成员可见招投标中心",
);
ok(
  !resolveNavigationTree(
    NAVIGATION_REGISTRY,
    ctx({ platformRole: "user", hasBidCapability: false }),
  ).some((i) => i.key === "ws-bids"),
  "user 仅模块无项目成员不看招投标中心",
);
ok(!userNav.some((i) => i.key === "ws-ops"), "user 默认不看运营中心");

const noBidMod = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({
    platformRole: "user",
    modules: { enabled: ["sales", "operations"] },
  }),
);
ok(
  !noBidMod.some((i) => i.key === "ws-bids"),
  "无 bids/projects 模块时隐藏招投标中心",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
