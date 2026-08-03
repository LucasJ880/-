/**
 * 导航 active 最长匹配回归
 * 运行：npx tsx src/lib/navigation/__tests__/nav-active-matcher.test.ts
 */

import {
  NAVIGATION_REGISTRY,
  pathMatches,
  pickActiveNavKey,
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
    platformRole: "admin",
    orgRole: "org_admin",
    hasMembership: true,
    workspaceIds: ["ws1"],
    modules: {
      enabled: ["sales", "projects", "operations", "trade", "finance", "bids"],
    },
    isPlatformAdmin: true,
    hasBidCapability: true,
    ...partial,
  };
}

function activeKeys(pathname: string, search?: string): string[] {
  const tree = resolveNavigationTree(
    NAVIGATION_REGISTRY,
    ctx({ pathname, search }),
  );
  const keys: string[] = [];
  for (const item of tree) {
    if (item.active) keys.push(item.key);
    for (const c of item.children || []) {
      if (c.active) keys.push(c.key);
    }
  }
  return keys;
}

console.log("\n== pathMatches query / prefix ==");
ok(
  pathMatches("/sales/opportunities", "/sales"),
  "/sales 前缀仍可单独 match（选优前）",
);
ok(
  !pathMatches("/sales/opportunities", "/sales", { exact: true }),
  "/sales exact 不吞 opportunities",
);
ok(
  pathMatches("/sales/opportunities", "/sales?view=pipeline", {
    matchPaths: ["/sales/opportunities"],
  }),
  "商机 matchPaths 命中 /sales/opportunities",
);
ok(
  pathMatches("/sales", "/sales?view=pipeline", { search: "" }),
  "裸 /sales 默认视为 pipeline",
);
ok(
  pathMatches("/sales", "/sales?view=pipeline", { search: "?view=pipeline" }),
  "view=pipeline 命中商机",
);
ok(
  !pathMatches("/sales", "/sales?view=pipeline", {
    search: "?view=customers",
  }),
  "view=customers 不命中商机",
);
ok(
  pathMatches("/sales", "/sales?view=customers", {
    search: "?view=customers",
  }),
  "view=customers 命中客户",
);

console.log("\n== pickActiveNavKey 最长匹配 ==");
const salesCandidates = [
  { key: "biz-sales", href: "/sales", exact: true },
  { key: "sales-home", href: "/sales/home", matchPaths: ["/sales/home"] },
  {
    key: "sales-pipeline",
    href: "/sales?view=pipeline",
    matchPaths: ["/sales/opportunities"],
  },
  { key: "sales-customers", href: "/sales?view=customers" },
  { key: "biz-quotes", href: "/sales/quote-sheet" },
  { key: "biz-all-quotes", href: "/sales/quotes" },
];
ok(
  pickActiveNavKey("/sales/opportunities", salesCandidates) ===
    "sales-pipeline",
  "opportunities → 仅商机",
);
ok(
  pickActiveNavKey("/sales/home", salesCandidates) === "sales-home",
  "sales/home → 仅销售中心（/sales 不抢）",
);
ok(
  pickActiveNavKey("/sales/quotes", salesCandidates) === "biz-all-quotes",
  "quotes → 仅报价记录",
);
ok(
  pickActiveNavKey("/sales/quote-sheet", salesCandidates) === "biz-quotes",
  "quote-sheet → 仅报价",
);
ok(
  pickActiveNavKey("/sales", salesCandidates, "?view=pipeline") ===
    "sales-pipeline",
  "view=pipeline → 商机优于 /sales",
);
ok(
  pickActiveNavKey("/sales", salesCandidates, "?view=customers") ===
    "sales-customers",
  "view=customers → 客户",
);
ok(
  pickActiveNavKey("/sales", salesCandidates, "") === "sales-pipeline",
  "裸 /sales → 默认商机",
);

console.log("\n== resolveNavigationTree 唯一强 active ==");
ok(
  JSON.stringify(activeKeys("/sales/opportunities")) ===
    JSON.stringify(["sales-pipeline"]),
  "tree: /sales/opportunities 仅 sales-pipeline",
);
ok(
  JSON.stringify(activeKeys("/sales/home")) ===
    JSON.stringify(["sales-home"]),
  "tree: /sales/home 仅 sales-home",
);
ok(
  JSON.stringify(activeKeys("/sales/quotes")) ===
    JSON.stringify(["biz-all-quotes"]),
  "tree: /sales/quotes 仅报价记录",
);
ok(
  JSON.stringify(activeKeys("/sales", "?view=pipeline")) ===
    JSON.stringify(["sales-pipeline"]),
  "tree: view=pipeline 仅商机",
);
ok(
  JSON.stringify(activeKeys("/sales", "?view=customers")) ===
    JSON.stringify(["sales-customers"]),
  "tree: view=customers 仅客户",
);

const opsKeys = activeKeys("/ops/projects");
ok(
  opsKeys.length === 1 && opsKeys[0] === "ws-ops-projects",
  "tree: /ops/projects 不让 /ops 抢占",
);

const capTree = resolveNavigationTree(
  NAVIGATION_REGISTRY,
  ctx({ pathname: "/capabilities/approvals" }),
);
const cap = capTree.find((i) => i.key === "capabilities");
ok(!!cap?.expanded, "审批页时 AI 工作中心展开");
ok(!cap?.active, "父级 capabilities 不强 active");
ok(
  cap?.children?.some((c) => c.key === "cap-approvals" && c.active) === true,
  "仅审批子项 active",
);
ok(
  (cap?.children || []).filter((c) => c.active).length === 1,
  "capabilities 子树仅一个 active",
);

const assistantKeys = activeKeys("/assistant");
ok(
  assistantKeys.length === 1 && assistantKeys[0] === "work-assistant",
  "AI 助手唯一高亮",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
