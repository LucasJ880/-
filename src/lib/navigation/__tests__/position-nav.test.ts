/**
 * PERM-4c2：岗位模式下的导航 / 默认落地 / 底栏（窗饰企业按岗位权限键；旧模式不变）
 * 运行：npx tsx src/lib/navigation/__tests__/position-nav.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAVIGATION_REGISTRY,
  resolveNavigationTree,
  type NavigationFilterContext,
  type ResolvedNavItem,
} from "../index";
import {
  getDefaultWorkspace,
  isManagementWorkspaceUser,
  resolveHomeRedirect,
  workspaceContextFromNav,
} from "@/lib/rbac/workspace-policy";
import {
  HOME_TEXTILE_TRADE_INDUSTRY_PACK,
  WINDOW_COVERING_INDUSTRY_PACK,
  hasPositionTemplates,
  mergedProfileBindings,
} from "@/lib/authorization/role-defaults";
import { DEFAULT_MENGXIN_MODULES } from "@/lib/tenancy/modules";
import { PERMISSION_REGISTRY } from "@/lib/authorization/permissions";

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

function eqList(actual: string[], expected: string[], name: string) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  const same = a.length === e.length && a.every((k, i) => k === e[i]);
  if (!same) {
    console.error(`    多出：${a.filter((k) => !e.includes(k)).join(",") || "-"}`);
    console.error(`    缺少：${e.filter((k) => !a.includes(k)).join(",") || "-"}`);
  }
  ok(same, name);
}

const MODULES = {
  enabled: [
    "sales",
    "trade",
    "operations",
    "marketing",
    "product_content",
    "bids",
    "projects",
    "window_covering",
    "supply_chain",
  ],
};

/** 与 seed 落库后一致：系统模板 + 窗饰行业包并集的 ALLOW 键 */
function keysOf(...positions: string[]): string[] {
  return [
    ...new Set(
      positions.flatMap((p) =>
        mergedProfileBindings(WINDOW_COVERING_INDUSTRY_PACK, p)
          .filter((b) => (b.effect ?? "ALLOW") === "ALLOW")
          .map((b) => b.permissionKey),
      ),
    ),
  ];
}

/** 平台 super_admin 在任何企业内全权（resolveEffectiveBindings → platformAdminBindings） */
const ALL_KEYS = PERMISSION_REGISTRY.map((p) => p.key);

function ctx(partial: Partial<NavigationFilterContext>): NavigationFilterContext {
  return {
    pathname: "/",
    platformRole: "user",
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: ["ws1"],
    modules: MODULES,
    isPlatformAdmin: false,
    permissionKeys: [],
    positionMode: true,
    // COLLAB-1：快照按微信入口开关打开时的规则（关闭时只少"微信集成"，见 wechat-entry-nav.test.ts）
    wechatEntryEnabled: true,
    ...partial,
  };
}

function flat(items: ResolvedNavItem[]): string[] {
  return items.flatMap((i) => [i.key, ...(i.children ? flat(i.children) : [])]);
}

function visible(c: NavigationFilterContext): string[] {
  return flat(resolveNavigationTree(NAVIGATION_REGISTRY, c));
}

function landing(c: NavigationFilterContext): { home: string; redirect: string | null } {
  const ws = workspaceContextFromNav(c);
  return { home: getDefaultWorkspace(ws), redirect: resolveHomeRedirect(ws) };
}

/** 进入 `/` 后最终停留的页面 */
function finalPage(c: NavigationFilterContext): string {
  return landing(c).redirect ?? "/";
}

console.log("position-nav（PERM-4c2）");

// ── 岗位模式判定 ──
ok(hasPositionTemplates(WINDOW_COVERING_INDUSTRY_PACK), "窗饰行业包 = 岗位模式");
ok(!hasPositionTemplates(null), "无行业包 = 旧模式");
ok(!hasPositionTemplates("unknown_pack"), "未登记行业包 = 旧模式");

// ── 每岗位：落地 + 侧栏快照 ──
const COMMON = [
  "mgmt-knowledge",
  "mgmt-orgs",
  "mgmt-settings",
  "mgmt-wechat",
  "work-ai-jobs",
  "work-assistant",
  "work-home",
  "work-inbox",
  "work-notifications",
  "work-tasks",
];
// VIS-1c（design D11 / Q8）：「管理总览」只对管理层（spec「管理总览只对管理层」）
const COMMON_NON_MGMT = COMMON.filter((k) => k !== "work-home");
// VIS-1b（design D6 / Q8）：没有可读工作域的一线岗位不见「AI 任务」
const COMMON_NO_AI_JOBS = COMMON_NON_MGMT.filter((k) => k !== "work-ai-jobs");
const SALES_SIDEBAR = [
  "biz-all-quotes",
  "biz-quotes",
  "sales-crm",
  "sales-email-settings",
  "sales-home",
  "sales-performance",
  // VIS-1b（判断点 5）：纯销售侧栏不再有「AI 任务」「数字员工」
  "work-calendar",
];
const PROJECT_INTEL = [
  "nav-projects",
  "nav-project-intel",
  "nav-intel-agencies",
  "nav-intel-awards",
  "nav-intel-competitors",
  "nav-intel-monitor",
  "nav-intel-supply",
  "nav-suppliers",
];
const TRADE = [
  "biz-channels",
  "biz-fulfillment",
  "biz-inbox",
  "biz-prospects",
  "biz-revenue",
  "biz-revenue-today",
  "biz-signals",
  "biz-trade",
  "biz-trade-chat",
  "biz-trade-import",
  "biz-trade-intel",
  "biz-trade-products",
  "biz-trade-quotes",
  "biz-trade-samples",
  "growth-product-content",
];
const GROWTH = ["growth-content", "growth-hub", "growth-intel", "growth-reports"];
const OWNER_SIDEBAR = [
  ...COMMON,
  ...SALES_SIDEBAR.filter((k) => !k.startsWith("work-ai") && k !== "work-assistant"),
  ...PROJECT_INTEL,
  ...TRADE,
  ...GROWTH,
  "biz-accounting",
  "biz-cockpit",
  "biz-inventory",
  "biz-work-orders",
  "cap-approvals",
  "cap-catalog",
  "cap-health",
  "cap-overview",
  "capabilities",
  "ops-center",
  "ws-bids",
  "ws-install",
  "ws-ops",
  "ws-ops-projects",
];

const CASES: Array<{ name: string; positions: string[]; page: string; sidebar: string[] }> = [
  { name: "owner", positions: ["owner"], page: "/", sidebar: OWNER_SIDEBAR },
  { name: "sales_rep", positions: ["sales_rep"], page: "/sales/home", sidebar: SALES_SIDEBAR },
  { name: "pricing_lead", positions: ["pricing_lead"], page: "/sales/home", sidebar: SALES_SIDEBAR },
  {
    name: "ops_lead",
    positions: ["ops_lead"],
    page: "/ops",
    sidebar: [...COMMON_NON_MGMT, ...GROWTH, "biz-inventory", "biz-work-orders", "ws-install", "ws-ops", "ws-ops-projects"],
  },
  {
    name: "ops_staff",
    positions: ["ops_staff"],
    page: "/ops",
    sidebar: [...COMMON_NON_MGMT, ...GROWTH, "biz-inventory", "ws-ops", "ws-ops-projects"],
  },
  {
    name: "accounting",
    positions: ["accounting"],
    page: "/accounting",
    // VIS-1a（判断点 3）：只持 project.read 不再见招投标与项目 / 情报 / 供应商
    sidebar: [...COMMON_NO_AI_JOBS, "biz-accounting", "ws-install"],
  },
  {
    name: "bids",
    positions: ["bids"],
    page: "/bids",
    sidebar: [...COMMON_NON_MGMT, ...PROJECT_INTEL, "biz-accounting", "ws-bids"],
  },
  ...["fulfillment_vinyl", "fulfillment_drapery", "fulfillment_shades"].map((p) => ({
    name: p,
    positions: [p],
    page: "/tasks",
    // VIS-1a（判断点 3）：只持 project.read 不再见招投标与项目 / 情报 / 供应商
    sidebar: [...COMMON_NO_AI_JOBS, "biz-inventory", "biz-work-orders", "ws-install"],
  })),
  { name: "installer", positions: ["installer"], page: "/install", sidebar: [...COMMON_NO_AI_JOBS, "ws-install"] },
  { name: "owner + pricing_lead + accounting", positions: ["owner", "pricing_lead", "accounting"], page: "/", sidebar: OWNER_SIDEBAR },
  { name: "无岗位", positions: [], page: "/tasks", sidebar: COMMON_NO_AI_JOBS },
];

for (const c of CASES) {
  const nc = ctx({ permissionKeys: keysOf(...c.positions) });
  ok(finalPage(nc) === c.page, `${c.name}：进入首页 → ${c.page}（实际 ${finalPage(nc)}）`);
  eqList(visible(nc), c.sidebar, `${c.name}：侧栏快照`);
}

// VIS-1c：未绑岗位的平台 super_admin 仍是管理层，侧栏仍含「管理总览」；非管理层一律不含
{
  const sa = ctx({ platformRole: "super_admin", isPlatformAdmin: true, permissionKeys: ALL_KEYS });
  const saUnbound = ctx({ platformRole: "super_admin", isPlatformAdmin: true, permissionKeys: [] });
  ok(visible(sa).includes("work-home") && visible(saUnbound).includes("work-home"), "平台 super_admin（含未绑岗位）：侧栏含「管理总览」");
  const nonMgmt = CASES.filter((c) => !c.positions.includes("owner"));
  ok(nonMgmt.every((c) => !visible(ctx({ permissionKeys: keysOf(...c.positions) })).includes("work-home")), "非管理层岗位与无岗位成员：侧栏都不含「管理总览」");
  // 旧模式：去掉 managementOnly 标记前后，各平台角色的侧栏完全相同
  const unflagged = NAVIGATION_REGISTRY.map((i) => ({ ...i, managementOnly: undefined }));
  const legacyCtxs = [
    ctx({ positionMode: false, platformRole: "user" }),
    ctx({ positionMode: false, platformRole: "sales" }),
    ctx({ positionMode: false, platformRole: "boss", orgRole: "org_admin" }),
  ];
  ok(
    legacyCtxs.every((c) => JSON.stringify(visible(c)) === JSON.stringify(flat(resolveNavigationTree(unflagged, c)))),
    "旧模式不读 managementOnly（侧栏与不带标记时相同）",
  );
}

// VIS-1b：梦馨外贸员仍见「AI 任务」（外贸入口 → 可读销售域；spec「AI 任务只对有可读工作域的人出现」）
{
  const mxKeys = [...new Set(mergedProfileBindings(HOME_TEXTILE_TRADE_INDUSTRY_PACK, "trade_rep").filter((b) => (b.effect ?? "ALLOW") === "ALLOW").map((b) => b.permissionKey))];
  const mx = ctx({ modules: { enabled: [...DEFAULT_MENGXIN_MODULES] }, permissionKeys: mxKeys });
  ok(visible(mx).includes("work-ai-jobs") && visible(mx).includes("biz-trade"), "梦馨 trade_rep：侧栏仍含「AI 任务」与「外贸」");
}

// spec 场景：多岗并集
{
  const v = visible(ctx({ permissionKeys: keysOf("owner", "pricing_lead", "accounting") }));
  ok(v.includes("ops-center") && v.includes("biz-quotes") && v.includes("biz-accounting"), "多岗：企业经营 + 报价 + 会计视图并集");
}
// spec 场景：销售看不到运营与经营入口；运营看不到销售区
{
  const s = visible(ctx({ permissionKeys: keysOf("sales_rep") }));
  ok(["sales-home", "biz-quotes", "work-calendar"].every((k) => s.includes(k)), "sales_rep：销售中心 / 报价 / 日程可见");
  ok(!["growth-hub", "ops-center", "capabilities", "ws-bids", "nav-projects"].some((k) => s.includes(k)), "sales_rep：品牌增长 / 企业经营 / AI 能力 / 招投标不可见");
  const o = visible(ctx({ permissionKeys: keysOf("ops_staff") }));
  ok(o.includes("ws-ops") && o.includes("growth-hub"), "ops_staff：运营中心 + 品牌增长可见");
  ok(!o.includes("sales-home") && !o.includes("biz-quotes"), "ops_staff：销售中心 / 报价不可见");
}

// ── VIS-1a：招投标 / 项目情报只认招投标写键或管理层（判断点 3）──
{
  const BID_ENTRIES = ["ws-bids", "nav-projects", "nav-project-intel", "nav-intel-awards", "nav-suppliers"];
  for (const p of ["accounting", "fulfillment_vinyl", "fulfillment_drapery", "fulfillment_shades"]) {
    const v = visible(ctx({ permissionKeys: keysOf(p), hasBidCapability: true }));
    ok(!BID_ENTRIES.some((k) => v.includes(k)), `${p}（即使是项目成员）：不见招投标与项目情报`);
  }
  ok(visible(ctx({ permissionKeys: keysOf("accounting") })).includes("biz-accounting"), "accounting：会计视图仍可见");
  for (const p of ["bids", "owner"]) {
    const v = visible(ctx({ permissionKeys: keysOf(p) }));
    ok(BID_ENTRIES.every((k) => v.includes(k)), `${p}：可见招投标与项目情报`);
  }
  const NO_TRADE = { enabled: MODULES.enabled.filter((m) => m !== "trade") };
  const ownerNoTrade = visible(ctx({ modules: NO_TRADE, permissionKeys: keysOf("owner") }));
  ok(!ownerNoTrade.includes("biz-revenue") && !ownerNoTrade.includes("biz-revenue-today"), "启用 sales 未启用 trade：老板不见营收中心与今日询盘");
  const bossNoTrade = visible(ctx({ positionMode: false, platformRole: "boss", orgRole: "org_owner", modules: NO_TRADE, permissionKeys: [] }));
  ok(!bossNoTrade.includes("biz-revenue") && !bossNoTrade.includes("biz-revenue-today"), "无行业包企业启用 sales 未启用 trade：平台 boss 不见营收中心与今日询盘");
  ok(bossNoTrade.includes("sales-home") && bossNoTrade.includes("ops-center"), "无行业包企业未启用 trade：平台 boss 其余入口照常");
}

// ── 平台角色不影响（反例） ──
for (const role of ["boss", "manager", "admin", "operations", "sales"]) {
  const keys = keysOf("sales_rep");
  const base = ctx({ permissionKeys: keys });
  const withRole = ctx({ permissionKeys: keys, platformRole: role, isPlatformAdmin: role === "admin" });
  ok(finalPage(withRole) === "/sales/home", `平台 ${role} + sales_rep 岗位 → /sales/home`);
  ok(
    !isManagementWorkspaceUser(workspaceContextFromNav(withRole)),
    `平台 ${role} 不因平台角色成为管理层`,
  );
  if (role !== "admin") {
    eqList(visible(withRole), visible(base), `平台 ${role} + sales_rep：侧栏与平台 user 相同`);
  }
}
for (const orgRole of ["org_owner", "org_admin"]) {
  const c = ctx({ orgRole, permissionKeys: keysOf("ops_staff") });
  ok(!isManagementWorkspaceUser(workspaceContextFromNav(c)), `企业 ${orgRole} 本身不是管理层`);
  ok(finalPage(c) === "/ops", `企业 ${orgRole} + ops_staff → /ops`);
}
ok(finalPage(ctx({ platformRole: "sales", permissionKeys: keysOf("accounting") })) === "/accounting", "平台 sales + accounting 岗位 → /accounting");
ok(finalPage(ctx({ platformRole: "boss", permissionKeys: [] })) === "/tasks", "平台 boss 无岗位 → /tasks（不停留管理总览）");
ok(!visible(ctx({ platformRole: "boss" })).includes("ops-center"), "平台 boss 无岗位：企业经营不可见");

// ── 外贸例外 ──
{
  const t = visible(ctx({ platformRole: "trade" }));
  ok(TRADE.every((k) => t.includes(k)), "平台 trade 无岗位：外贸 / 营收 / 产品内容入口可见");
  ok(!t.includes("sales-home") && !t.includes("ops-center"), "平台 trade：销售区 / 企业经营不可见");
  const s = visible(ctx({ permissionKeys: keysOf("sales_rep") }));
  ok(!TRADE.some((k) => s.includes(k)), "sales_rep 岗位：外贸入口不可见");
  const noTradeModule = visible(
    ctx({ platformRole: "trade", modules: { enabled: MODULES.enabled.filter((m) => m !== "trade") } }),
  );
  ok(!noTradeModule.includes("biz-trade"), "企业未启用外贸模块：trade 角色也看不到外贸");
}

// ── 平台用户管理只对 super_admin ──
{
  const sa = ctx({ platformRole: "super_admin", isPlatformAdmin: true, permissionKeys: ALL_KEYS });
  const saV = visible(sa);
  ok(saV.includes("plat-users"), "super_admin（岗位模式）：平台用户管理可见");
  ok(finalPage(sa) === "/", "super_admin（岗位模式）：停留管理总览");
  ok(["sales-home", "ops-center", "ws-ops", "nav-projects", "biz-accounting"].every((k) => saV.includes(k)), "super_admin（全部键）：业务入口可见");
  for (const positionMode of [true, false]) {
    for (const role of ["admin", "boss", "manager"]) {
      const v = visible(
        ctx({ positionMode, platformRole: role, isPlatformAdmin: role === "admin", orgRole: "org_owner", permissionKeys: keysOf("owner") }),
      );
      ok(!v.includes("plat-users"), `${positionMode ? "岗位" : "旧"}模式 平台 ${role}：平台用户管理不可见`);
    }
    ok(
      visible(ctx({ positionMode, platformRole: "super_admin", isPlatformAdmin: true, permissionKeys: ALL_KEYS })).includes("plat-users"),
      `${positionMode ? "岗位" : "旧"}模式 super_admin：平台用户管理可见`,
    );
  }
}

// ── 底栏布局（D5）：岗位模式 = 默认落地是否 /sales/home ──
{
  const isSalesTab = (c: NavigationFilterContext) => getDefaultWorkspace(workspaceContextFromNav(c)) === "/sales/home";
  ok(isSalesTab(ctx({ permissionKeys: keysOf("sales_rep") })), "sales_rep（平台 user）：销售底栏");
  ok(isSalesTab(ctx({ permissionKeys: keysOf("pricing_lead") })), "pricing_lead：销售底栏");
  ok(!isSalesTab(ctx({ platformRole: "sales", permissionKeys: keysOf("ops_staff") })), "平台 sales + ops_staff：通用底栏");
  ok(!isSalesTab(ctx({ permissionKeys: keysOf("owner", "pricing_lead") })), "owner + pricing_lead：通用底栏（管理层落地 /）");
  // VIS-1b：底栏判定搬到纯模块 mobile-tabs.ts（组件经 useNavigationAccess 取同一份判定输入）
  const src = readFileSync(join(process.cwd(), "src/lib/navigation/mobile-tabs.ts"), "utf8");
  ok(
    /ctx\.positionMode\s*\?\s*getDefaultWorkspace\(wsCtx\)\s*===\s*"\/sales\/home"\s*:\s*ctx\.platformRole === "sales"/.test(src),
    "mobile-tabs：isSales 岗位模式按默认落地、旧模式按平台角色",
  );
  const bar = readFileSync(join(process.cwd(), "src/components/mobile-tab-bar.tsx"), "utf8");
  ok(/useNavigationAccess\(\)/.test(bar) && /computeMobileTabs\(ctx\)/.test(bar) && !/apiFetch|workspace-policy/.test(bar), "mobile-tab-bar：用共享钩子与纯函数，不再自取 active-org、自拼判定输入");
}

// ── 旧模式抽样（与改动前一致；改动前快照取自 main@da0119d4，平台用户管理入口除外） ──
{
  const legacy = (partial: Partial<NavigationFilterContext>) => ctx({ positionMode: false, ...partial });
  const L_SALES = legacy({ platformRole: "sales", permissionKeys: ["sales.quote.create", "sales.quote.read"] });
  ok(finalPage(L_SALES) === "/sales/home", "旧模式 平台 sales → /sales/home");
  eqList(
    visible(L_SALES),
    // VIS-1b（判断点 5）：旧模式平台 sales 同步去掉「AI 任务」「数字员工」（spec「岗位模式判定」的旧模式例外）
    SALES_SIDEBAR,
    "旧模式 平台 sales：侧栏与改动前一致（例外：不含 AI 任务与数字员工）",
  );
  const L_OPS = legacy({ platformRole: "operations", permissionKeys: ["operations.read", "operations.manage"] });
  ok(finalPage(L_OPS) === "/ops", "旧模式 平台 operations + operations.* → /ops");
  eqList(
    visible(L_OPS),
    [
      ...COMMON,
      ...GROWTH,
      "biz-fulfillment",
      "biz-inventory",
      "biz-signals",
      "biz-work-orders",
      "growth-product-content",
      "ws-ops",
      "ws-ops-projects",
    ],
    "旧模式 平台 operations：侧栏与改动前一致（外贸履约 / 信号按平台角色可见）",
  );
  const L_BOSS = legacy({ platformRole: "boss", orgRole: "org_owner", permissionKeys: [] });
  ok(finalPage(L_BOSS) === "/", "旧模式 平台 boss（无键）：停留管理总览");
  const bossV = visible(L_BOSS);
  ok(["ops-center", "sales-home", "biz-cockpit", "biz-trade", "capabilities"].every((k) => bossV.includes(k)), "旧模式 平台 boss（无键）：企业经营 / 销售 / 驾驶舱 / 外贸 / AI 能力可见");
  const L_ORG_OWNER = legacy({ platformRole: "user", orgRole: "org_owner", permissionKeys: [] });
  ok(finalPage(L_ORG_OWNER) === "/", "旧模式 企业 org_owner：管理层");
  const L_ACCT = legacy({ platformRole: "user", permissionKeys: ["accounting.read", "project.read", "project.finance.read"] });
  ok(finalPage(L_ACCT) === "/accounting", "旧模式 纯会计键 → /accounting");
  const L_USER = legacy({ platformRole: "user", permissionKeys: [] });
  const userV = visible(L_USER);
  ok(userV.includes("nav-projects") && userV.includes("mgmt-knowledge"), "旧模式 平台 user：招投标项目（按平台角色）/ 知识库可见");
  ok(!userV.includes("sales-home") && !userV.includes("growth-hub"), "旧模式 平台 user：销售 / 品牌增长不可见");
  ok(!visible(legacy({ platformRole: "sales" })).includes("mgmt-knowledge"), "旧模式 平台 sales：知识库仍隐藏");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
