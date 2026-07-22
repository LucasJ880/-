/**
 * 导航信息架构回归
 * 运行：npx tsx src/lib/navigation/__tests__/navigation-ia.test.ts
 */

import {
  NAVIGATION_REGISTRY,
  NAV_SECTION_LABEL,
  resolveNavigationTree,
  findDuplicateHrefs,
  isCapabilitiesPath,
  isGrowthPath,
  isOperationsCenterPath,
  pathMatches,
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

console.log("navigation information architecture");

// —— 归类 ——
const capItem = NAVIGATION_REGISTRY.find((i) => i.key === "capabilities");
ok(!!capItem && capItem.group === "CAPABILITIES", "企业能力中台 group=CAPABILITIES");
ok(capItem?.collapsible === true, "中台可折叠");
ok(
  !NAVIGATION_REGISTRY.some(
    (i) =>
      i.group === "GROWTH" &&
      (i.href?.startsWith("/capabilities") ||
        i.key === "capabilities"),
  ),
  "能力中台不属于品牌增长",
);

const ops = NAVIGATION_REGISTRY.find((i) => i.key === "ops-center");
ok(ops?.group === "OPERATIONS", "经营中心在 OPERATIONS");
ok(ops?.href === "/operations/center", "经营中心路由正确");

ok(isCapabilitiesPath("/capabilities/runs"), "/capabilities/* 识别为中台");
ok(isOperationsCenterPath("/operations/center"), "经营中心 path");
ok(!isGrowthPath("/operations/center"), "经营中心不属于增长高亮");
ok(isGrowthPath("/operations/growth"), "增长中心属于增长");
ok(isGrowthPath("/product-content"), "产品内容属于增长");

// —— active ——
ok(
  pathMatches("/capabilities/approvals", "/capabilities/approvals"),
  "审批中心 active",
);
ok(
  pathMatches("/capabilities", "/capabilities", { exact: true }),
  "中台总览 exact",
);
ok(
  !pathMatches("/capabilities/runs", "/capabilities", { exact: true }),
  "子页不误高亮总览 exact",
);

const treeCap = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ pathname: "/capabilities/approvals", orgRole: "org_admin" }),
);
const capNode = treeCap.find((i) => i.key === "capabilities");
ok(!!capNode?.expanded, "/capabilities/* 时中台展开");
ok(
  capNode?.children?.some((c) => c.key === "cap-approvals" && c.active),
  "审批子项 active",
);
ok(
  !treeCap.some((i) => i.group === "GROWTH" && i.active),
  "中台页品牌增长不高亮",
);

const treeHome = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ pathname: "/", orgRole: "org_admin" }),
);
ok(
  !treeHome.find((i) => i.key === "capabilities")?.expanded,
  "首页时企业能力中台默认折叠",
);
ok(
  !treeHome.find((i) => i.key === "capabilities")?.active,
  "首页时企业能力中台不高亮",
);

const treeOps = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ pathname: "/operations/center" }),
);
ok(
  treeOps.some((i) => i.key === "ops-center" && i.active),
  "经营中心页高亮经营中心",
);

// —— 权限 ——
const noMem = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ hasMembership: false, orgRole: null, workspaceIds: [] }),
);
ok(
  !noMem.some((i) => i.group === "CAPABILITIES"),
  "无 membership 不显示企业能力中台",
);

const member = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({
    orgRole: "org_member",
    pathname: "/capabilities",
    workspaceIds: ["ws1"],
  }),
);
const capMember = member.find((i) => i.key === "capabilities");
ok(!!capMember, "普通成员可见中台入口");
ok(
  !capMember?.children?.some((c) => c.key === "cap-governance"),
  "普通员工不显示治理中心",
);

const orgAdmin = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ orgRole: "org_admin", pathname: "/capabilities" }),
);
ok(
  orgAdmin
    .find((i) => i.key === "capabilities")
    ?.children?.some((c) => c.key === "cap-governance"),
  "Org Admin 显示治理中心",
);

const platformNoMem = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({
    hasMembership: false,
    orgRole: null,
    isPlatformAdmin: true,
    platformRole: "super_admin",
    workspaceIds: [],
    modules: { enabled: [] },
  }),
);
ok(
  !platformNoMem.some((i) => i.group === "CAPABILITIES"),
  "Platform Admin 无 membership 不显示中台",
);
ok(
  !platformNoMem.some((i) => i.group === "BUSINESS"),
  "Platform Admin 无 membership 不显示业务模块（无 modules）",
);

// —— 模块差异 ——
const sunnyLike = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({
    platformRole: "sales",
    modules: {
      enabled: ["sales", "bids", "projects", "operations", "marketing"],
    },
  }),
);
const mengxinLike = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({
    platformRole: "trade",
    modules: {
      enabled: ["trade", "product_content", "supply_chain", "operations", "marketing"],
    },
  }),
);
ok(
  sunnyLike.some((i) => i.href === "/sales") &&
    !sunnyLike.some((i) => i.href === "/trade"),
  "销售模块企业显示销售不显示外贸",
);
ok(
  mengxinLike.some((i) => i.href === "/trade") &&
    !mengxinLike.some((i) => i.href === "/sales"),
  "外贸模块企业显示外贸不显示销售",
);
ok(
  !resolveNavigationTree(
    NAVIGATION_REGISTRY,
    ctx({ hasMembership: true, modules: null }),
  ).some((i) => i.group === "BUSINESS" && i.moduleKey),
  "modules 未就绪时不展示受模块约束的业务入口",
);
ok(
  mengxinLike.some((i) => i.href === "/product-content") &&
    mengxinLike.find((i) => i.href === "/product-content")?.group === "GROWTH",
  "产品内容在品牌增长",
);

// —— 重复 href ——
const full = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({
    orgRole: "org_admin",
    platformRole: "admin",
    isPlatformAdmin: true,
  }),
);
const dups = findDuplicateHrefs(full);
// /capabilities 会在父与「中台总览」各出现一次 —— 允许同一 href 父子；检测其它重复
const nonCapDups = dups.filter((h) => h !== "/capabilities");
ok(nonCapDups.length === 0, `无意外重复 href（${nonCapDups.join(",") || "无"}）`);

// 顺序：OPERATIONS display 前于 GROWTH，CAPABILITIES 前于 GROWTH
const orderKeys = NAVIGATION_REGISTRY.map((i) => i.group);
const idxOps = orderKeys.indexOf("OPERATIONS");
const idxCap = orderKeys.indexOf("CAPABILITIES");
const idxBiz = orderKeys.indexOf("BUSINESS");
const idxGrowth = orderKeys.indexOf("GROWTH");
ok(
  idxOps < idxCap && idxCap < idxBiz && idxBiz < idxGrowth,
  "registry 中 经营→中台→业务→增长 顺序",
);
ok(
  NAV_SECTION_LABEL.OPERATIONS !== NAV_SECTION_LABEL.BUSINESS,
  "企业经营与业务运营分组标题不合并",
);
ok(NAV_SECTION_LABEL.CAPABILITIES === "AI 能力", "中台分组标题=AI 能力");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
