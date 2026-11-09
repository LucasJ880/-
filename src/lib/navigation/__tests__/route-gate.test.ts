/**
 * VIS-1a 路由门（spec navigation/route-gate；change vis-1a-route-gate）
 * 纯判定 + 门表覆盖快照 + 请求分类 + HTTP 层（注入加载器，不连库）+ 缓存 + 源码断言
 * 运行：npx tsx src/lib/navigation/__tests__/route-gate.test.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { NextRequest } from "next/server";
import {
  GATED_TOP_SEGMENTS,
  ROUTE_GATE_CACHE_MAX,
  ROUTE_GATE_CACHE_TTL_MS,
  ROUTE_GATE_OUTSIDE_PATHS,
  ROUTE_GATE_TABLE,
  TtlCache,
  applyRouteGate,
  classifyPageRequest,
  gateRedirectTarget,
  isRouteAllowed,
  isStaticFilePath,
  isStaticImagePath,
  matchRouteGateEntry,
  resolveRouteGate,
  routeGateNavKeyExists,
  type RouteGateContext,
  type RouteGateLoader,
  type RouteGateUser,
} from "../route-gate";
import { NAVIGATION_REGISTRY, ROUTE_ONLY_NAV_ITEMS, SYSTEM_NAV_ITEMS } from "../registry";
import { resolveNavigationTree } from "../filter";
import type { NavigationFilterContext, ResolvedNavItem } from "../types";
import { resolveHomeRedirect, workspaceContextFromNav } from "@/lib/rbac/workspace-policy";
import {
  HOME_TEXTILE_TRADE_INDUSTRY_PACK,
  WINDOW_COVERING_INDUSTRY_PACK,
  mergedProfileBindings,
} from "@/lib/authorization/role-defaults";
import { DEFAULT_MENGXIN_MODULES, DEFAULT_SUNNY_MODULES, type OrgModule } from "@/lib/tenancy/modules";
import { config as proxyConfig, proxy } from "@/proxy";
import { NO_ORG_INPUTS, createRouteGateLoader, pickGateOrgId, type OrgNavigationInputs } from "../context-server";

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

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ─────────────────────────── 身份 ───────────────────────────

function keysOf(pack: string, ...positions: string[]): string[] {
  return [
    ...new Set(
      positions.flatMap((p) =>
        mergedProfileBindings(pack, p)
          .filter((b) => (b.effect ?? "ALLOW") === "ALLOW")
          .map((b) => b.permissionKey),
      ),
    ),
  ];
}
const sunny = (...p: string[]) => keysOf(WINDOW_COVERING_INDUSTRY_PACK, ...p);
const mengxin = (...p: string[]) => keysOf(HOME_TEXTILE_TRADE_INDUSTRY_PACK, ...p);

const LEGACY_MODULES: OrgModule[] = ["sales", "trade", "marketing", "operations", "product_content", "supply_chain"];

function ctx(partial: Partial<RouteGateContext>): RouteGateContext {
  return {
    platformRole: "user",
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: [],
    modules: { enabled: [...DEFAULT_SUNNY_MODULES] },
    isPlatformAdmin: false,
    permissionKeys: [],
    positionMode: true,
    hasBidCapability: false,
    autopilotAllowed: false,
    wechatEntryEnabled: false,
    ...partial,
  };
}

const ID = {
  sales_rep: ctx({ permissionKeys: sunny("sales_rep") }),
  installer: ctx({ permissionKeys: sunny("installer") }),
  accounting: ctx({ permissionKeys: sunny("accounting") }),
  accounting_pricing: ctx({ permissionKeys: sunny("accounting", "pricing_lead") }),
  owner: ctx({ permissionKeys: sunny("owner"), orgRole: "org_admin" }),
  pricing_lead: ctx({ permissionKeys: sunny("pricing_lead") }),
  bids: ctx({ permissionKeys: sunny("bids") }),
  ops_lead: ctx({ permissionKeys: sunny("ops_lead") }),
  ops_staff: ctx({ permissionKeys: sunny("ops_staff") }),
  fulfillment_vinyl: ctx({ permissionKeys: sunny("fulfillment_vinyl") }),
  no_position: ctx({ permissionKeys: [] }),
  mx_trade_rep: ctx({ modules: { enabled: [...DEFAULT_MENGXIN_MODULES] }, permissionKeys: mengxin("trade_rep") }),
  mx_cathy: ctx({ modules: { enabled: [...DEFAULT_MENGXIN_MODULES] }, permissionKeys: mengxin("owner", "trade_rep"), orgRole: "org_admin" }),
  legacy_trade: ctx({ positionMode: false, platformRole: "trade", modules: { enabled: LEGACY_MODULES }, permissionKeys: ["trade.read", "trade.manage"] }),
  legacy_sales: ctx({ positionMode: false, platformRole: "sales", modules: { enabled: LEGACY_MODULES }, permissionKeys: sunny("sales_rep") }),
  legacy_boss: ctx({ positionMode: false, platformRole: "boss", orgRole: "org_admin", modules: { enabled: LEGACY_MODULES }, permissionKeys: [] }),
  legacy_operations: ctx({ positionMode: false, platformRole: "operations", modules: { enabled: LEGACY_MODULES }, permissionKeys: ["operations.read", "operations.manage"] }),
} as const;
type IdName = keyof typeof ID;
const IDS = Object.keys(ID) as IdName[];

const at = (c: RouteGateContext, pathname: string): NavigationFilterContext => ({ ...c, pathname });
const allowed = (name: IdName, path: string) => isRouteAllowed(path, at(ID[name], path));
const target = (name: IdName, path: string) => {
  const d = resolveRouteGate(path, at(ID[name], path));
  return d.allowed ? "allow" : d.redirect;
};
/** 门表条目对应的示例路径：`*` → x，去掉结尾 `=` */
const samplePath = (pattern: string) => {
  const p = pattern.replace(/=$/, "").replace(/\*/g, "x");
  return p === "" ? "/" : p;
};

console.log("route-gate（VIS-1a）");

// ─────────────────────────── 门表自身 ───────────────────────────
{
  const patterns = ROUTE_GATE_TABLE.map((e) => e.pattern);
  ok(new Set(patterns).size === patterns.length, "门表条目不重复");
  const unknown = ROUTE_GATE_TABLE.flatMap((e) => (e.rule.kind === "nav" ? e.rule.navKeys : [])).filter((k) => !routeGateNavKeyExists(k));
  ok(unknown.length === 0, `门表引用的导航项都存在${unknown.length ? "（缺 " + unknown.join(",") + "）" : ""}`);
  ok(
    ROUTE_GATE_TABLE.every(
      (e) =>
        matchRouteGateEntry(samplePath(e.pattern)) === e ||
        // 前缀条目与同路径的精确条目并存时（如 /organizations 与 /organizations=），前缀条目管子路径
        (!e.pattern.endsWith("=") && matchRouteGateEntry(`${samplePath(e.pattern)}/x`) === e),
    ),
    "每条门表条目的示例路径（或其子路径）都命中它自己",
  );
  const routeOnlyKeys = ROUTE_ONLY_NAV_ITEMS.map((i) => i.key);
  ok(routeOnlyKeys.length === 10, `只做门条目 10 条（实际 ${routeOnlyKeys.length}）`);
  const sidebarKeys = new Set<string>();
  const walk = (items: typeof NAVIGATION_REGISTRY) => items.forEach((i) => { sidebarKeys.add(i.key); if (i.children) walk(i.children); });
  walk([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS]);
  ok(routeOnlyKeys.every((k) => !sidebarKeys.has(k)), "只做门条目不在侧栏注册表里");
}

// ─────────────────────────── 页面 → 规则快照（spec「每个页面都已登记」）───────────────────────────
// 值 = 命中的门表条目 + 它的规则；新增页面、改动任一条规则都会让这里失败，需同步更新快照（评审时一眼看到口径变化）
function ruleLabel(e: ReturnType<typeof matchRouteGateEntry>): string {
  if (!e) return "NONE";
  if (e.rule.kind === "login_only") return `${e.pattern} login_only`;
  return `${e.pattern} ${e.rule.navKeys.join("+")}${e.rule.allowProjectMember ? " +项目成员" : ""}${e.rule.allowWithoutMembership ? " +无成员身份" : ""}`;
}
const PAGE_RULE_SNAPSHOT: Array<[string, string]> = [
  ["/", "/= login_only"],
  ["/accounting", "/accounting biz-accounting"],
  ["/admin/audit-logs", "/admin/audit-logs plat-audit"],
  ["/admin/invite-codes", "/admin/invite-codes plat-invites"],
  ["/admin/onboarding", "/admin/onboarding plat-onboarding"],
  ["/admin/onboarding/[orgId]", "/admin/onboarding plat-onboarding"],
  ["/admin/project-intake", "/admin/project-intake plat-intake"],
  ["/admin/users", "/admin/users plat-users"],
  ["/agent-trace", "/agent-trace route-platform-admin"],
  ["/ai-activity", "/ai-activity route-platform-admin"],
  ["/ai/autopilot", "/ai/autopilot autopilot"],
  ["/ai/autopilot/evaluations", "/ai/autopilot autopilot"],
  ["/ai/autopilot/runs", "/ai/autopilot autopilot"],
  ["/ai/autopilot/runs/[runId]", "/ai/autopilot autopilot"],
  ["/ai/autopilot/telemetry", "/ai/autopilot autopilot"],
  ["/assistant", "/assistant work-assistant"],
  ["/bids", "/bids ws-bids"],
  ["/blinds-orders", "/blinds-orders= biz-work-orders"],
  ["/blinds-orders/[id]", "/blinds-orders/* route-blinds-order-detail"],
  ["/blinds-orders/[id]/edit", "/blinds-orders/* route-blinds-order-detail"],
  ["/blinds-orders/new", "/blinds-orders/new biz-work-orders"],
  ["/blinds-orders/zebra-ratios", "/blinds-orders/zebra-ratios biz-work-orders"],
  ["/capabilities", "/capabilities= cap-overview"],
  ["/capabilities/approvals", "/capabilities/approvals route-approvals"],
  ["/capabilities/approvals/[approvalId]", "/capabilities/approvals route-approvals"],
  ["/capabilities/catalog", "/capabilities/catalog cap-catalog"],
  ["/capabilities/config-health", "/capabilities/config-health cap-health"],
  ["/capabilities/governance", "/capabilities/governance cap-governance"],
  ["/capabilities/governance/audit", "/capabilities/governance cap-governance"],
  ["/capabilities/governance/policies", "/capabilities/governance cap-governance"],
  ["/capabilities/governance/quotas", "/capabilities/governance cap-governance"],
  ["/capabilities/health", "/capabilities/health cap-health"],
  ["/capabilities/runs", "/capabilities/runs cap-runs"],
  ["/capabilities/runs/[runId]", "/capabilities/runs cap-runs"],
  ["/help", "/help login_only"],
  ["/inbox", "/inbox work-assistant"],
  ["/install", "/install ws-install"],
  ["/install/[id]", "/install ws-install"],
  ["/install/repairs", "/install ws-install"],
  ["/install/repairs/[id]", "/install ws-install"],
  ["/install/repairs/[id]/print", "/install ws-install"],
  ["/inventory", "/inventory biz-inventory"],
  ["/knowledge", "/knowledge mgmt-knowledge"],
  ["/marketing/employee", "/marketing growth-hub"],
  ["/memory", "/memory mgmt-memory"],
  ["/notifications", "/notifications login_only"],
  ["/operations", "/operations= growth-content"],
  ["/operations/assets", "/operations/assets growth-content"],
  ["/operations/brand", "/operations/brand growth-content"],
  ["/operations/calendar", "/operations/calendar growth-content"],
  ["/operations/center", "/operations/center ops-center"],
  ["/operations/dashboard", "/operations/dashboard growth-content"],
  ["/operations/growth", "/operations/growth growth-hub"],
  ["/operations/growth/audit", "/operations/growth growth-hub"],
  ["/operations/growth/automations", "/operations/growth growth-hub"],
  ["/operations/growth/brand", "/operations/growth growth-hub"],
  ["/operations/growth/campaigns", "/operations/growth growth-hub"],
  ["/operations/growth/experiments", "/operations/growth growth-hub"],
  ["/operations/growth/metrics", "/operations/growth growth-hub"],
  ["/operations/growth/mmm", "/operations/growth growth-hub"],
  ["/operations/intelligence", "/operations/intelligence growth-intel"],
  ["/operations/matrix", "/operations/matrix growth-content"],
  ["/operations/matrix/[accountId]/playbook", "/operations/matrix growth-content"],
  ["/operations/review", "/operations/review growth-content"],
  ["/operations/tender-profile", "/operations/tender-profile ws-bids"],
  ["/ops", "/ops= ws-ops"],
  ["/ops/projects", "/ops/projects ws-ops-projects"],
  ["/ops/projects/[id]", "/ops/projects ws-ops-projects"],
  ["/organizations", "/organizations= mgmt-orgs +无成员身份"],
  ["/organizations/[orgId]", "/organizations mgmt-orgs"],
  ["/product-content", "/product-content growth-product-content"],
  ["/product-content/[jobId]", "/product-content growth-product-content"],
  ["/projects", "/projects= nav-projects"],
  ["/projects/[id]", "/projects/* route-project-detail +项目成员"],
  ["/projects/[id]/agents", "/projects/*/agents route-platform-admin"],
  ["/projects/[id]/agents/[agentId]", "/projects/*/agents route-platform-admin"],
  ["/projects/[id]/conversations", "/projects/* route-project-detail +项目成员"],
  ["/projects/[id]/conversations/[conversationId]", "/projects/* route-project-detail +项目成员"],
  ["/projects/[id]/feedback-tags", "/projects/*/feedback-tags route-platform-admin"],
  ["/projects/[id]/feedbacks", "/projects/*/feedbacks route-platform-admin"],
  ["/projects/[id]/intelligence-room", "/projects/* route-project-detail +项目成员"],
  ["/projects/[id]/knowledge-bases", "/projects/*/knowledge-bases route-platform-admin"],
  ["/projects/[id]/knowledge-bases/[kbId]", "/projects/*/knowledge-bases route-platform-admin"],
  ["/projects/[id]/knowledge-bases/[kbId]/documents/[docId]", "/projects/*/knowledge-bases route-platform-admin"],
  ["/projects/[id]/knowledge-bases/[kbId]/versions/[versionId]", "/projects/*/knowledge-bases route-platform-admin"],
  ["/projects/[id]/prompts", "/projects/*/prompts route-platform-admin"],
  ["/projects/[id]/prompts/[promptId]", "/projects/*/prompts route-platform-admin"],
  ["/projects/[id]/prompts/[promptId]/versions/[versionId]", "/projects/*/prompts route-platform-admin"],
  ["/projects/[id]/quality", "/projects/*/quality route-platform-admin"],
  ["/projects/[id]/quote-engine/[quoteId]", "/projects/* route-project-detail +项目成员"],
  ["/projects/[id]/quotes", "/projects/* route-project-detail +项目成员"],
  ["/projects/[id]/quotes/[quoteId]", "/projects/* route-project-detail +项目成员"],
  ["/projects/[id]/tools", "/projects/*/tools route-platform-admin"],
  ["/projects/[id]/tools/[toolId]", "/projects/*/tools route-platform-admin"],
  ["/projects/intelligence", "/projects/intelligence nav-project-intel"],
  ["/projects/intelligence/agencies", "/projects/intelligence/agencies nav-intel-agencies"],
  ["/projects/intelligence/awards", "/projects/intelligence/awards nav-intel-awards"],
  ["/projects/intelligence/competitors", "/projects/intelligence/competitors nav-intel-competitors"],
  ["/projects/intelligence/monitor", "/projects/intelligence/monitor nav-intel-monitor"],
  ["/projects/intelligence/series", "/projects/intelligence nav-project-intel"],
  ["/projects/intelligence/supply-chain", "/projects/intelligence/supply-chain nav-intel-supply"],
  ["/projects/intelligence/supply-chain/supplier", "/projects/intelligence/supply-chain nav-intel-supply"],
  ["/reports", "/reports growth-reports"],
  ["/revenue", "/revenue biz-revenue"],
  ["/revenue/[id]", "/revenue biz-revenue"],
  ["/revenue/today", "/revenue/today biz-revenue-today"],
  ["/sales", "/sales= sales-crm"],
  ["/sales/analytics", "/sales/analytics route-sales-analytics"],
  ["/sales/calendar", "/sales/calendar work-calendar+route-install-calendar"],
  ["/sales/cockpit", "/sales/cockpit biz-cockpit"],
  ["/sales/customers/[id]", "/sales/customers route-sales-customer-detail"],
  ["/sales/home", "/sales/home sales-home"],
  ["/sales/inquiries/[id]", "/sales/inquiries sales-crm"],
  ["/sales/knowledge", "/sales/knowledge sales-crm"],
  ["/sales/measure", "/sales/measure biz-quotes"],
  ["/sales/performance", "/sales/performance sales-performance"],
  ["/sales/quote-sheet", "/sales/quote-sheet biz-quotes"],
  ["/sales/quotes", "/sales/quotes biz-all-quotes"],
  ["/sales/visualizer/[sessionId]", "/sales/visualizer sales-crm"],
  ["/sales/website-bookings", "/sales/website-bookings route-website-bookings"],
  ["/service-inbox", "/service-inbox work-inbox"],
  ["/settings", "/settings= login_only"],
  ["/settings/account", "/settings/account login_only"],
  ["/settings/agent-skills", "/settings/agent-skills route-platform-admin"],
  ["/settings/appearance", "/settings/appearance login_only"],
  ["/settings/digital-employees", "/settings/digital-employees route-platform-admin"],
  ["/settings/digital-employees/my-profile", "/settings/digital-employees route-platform-admin"],
  ["/settings/digital-employees/playbooks", "/settings/digital-employees route-platform-admin"],
  ["/settings/digital-employees/team-learning", "/settings/digital-employees route-platform-admin"],
  ["/settings/email", "/settings/email route-email-settings"],
  ["/settings/notifications", "/settings/notifications login_only"],
  ["/settings/wechat", "/settings/wechat login_only"],
  ["/suppliers", "/suppliers nav-suppliers"],
  ["/suppliers/[id]", "/suppliers nav-suppliers"],
  ["/tasks", "/tasks login_only"],
  ["/tasks/[id]", "/tasks login_only"],
  ["/trade", "/trade biz-trade"],
  ["/trade/booth-cards", "/trade biz-trade"],
  ["/trade/campaigns/[id]", "/trade biz-trade"],
  ["/trade/channels", "/trade/channels biz-channels"],
  ["/trade/chat", "/trade/chat biz-trade-chat"],
  ["/trade/cockpit", "/trade biz-trade"],
  ["/trade/fulfillment", "/trade/fulfillment biz-fulfillment"],
  ["/trade/import", "/trade/import biz-trade-import"],
  ["/trade/inbox", "/trade/inbox biz-inbox"],
  ["/trade/intelligence", "/trade/intelligence biz-trade-intel"],
  ["/trade/intelligence/[id]", "/trade/intelligence biz-trade-intel"],
  ["/trade/intelligence/new", "/trade/intelligence biz-trade-intel"],
  ["/trade/knowledge", "/trade biz-trade"],
  ["/trade/products", "/trade/products biz-trade-products"],
  ["/trade/prospects", "/trade/prospects biz-prospects"],
  ["/trade/prospects/[id]", "/trade/prospects biz-prospects"],
  ["/trade/quotes", "/trade/quotes biz-trade-quotes"],
  ["/trade/quotes/[id]", "/trade/quotes biz-trade-quotes"],
  ["/trade/quotes/new", "/trade/quotes biz-trade-quotes"],
  ["/trade/samples", "/trade/samples biz-trade-samples"],
  ["/trade/samples/[id]", "/trade/samples biz-trade-samples"],
  ["/trade/samples/new", "/trade/samples biz-trade-samples"],
  ["/trade/signals", "/trade/signals biz-signals"],
  ["/trade/templates", "/trade biz-trade"],
  ["/wechat", "/wechat login_only"],
  ["/workforce", "/workforce work-ai-jobs"],
  ["/workforce/[id]", "/workforce work-ai-jobs"],
];
{
  const mainDir = join(root, "src/app/(main)");
  const pages: string[] = [];
  const walkDir = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walkDir(full);
      else if (name === "page.tsx") {
        const rel = relative(mainDir, dir).split(sep).filter(Boolean).join("/");
        pages.push("/" + rel);
      }
    }
  };
  walkDir(mainDir);
  const snap = new Map(PAGE_RULE_SNAPSHOT);
  const missing = pages.filter((p) => !snap.has(p));
  const stale = PAGE_RULE_SNAPSHOT.map(([p]) => p).filter((p) => !pages.includes(p));
  if (missing.length) console.error(`    未登记的页面（请在快照与门表里登记）：${missing.join(" ")}`);
  if (stale.length) console.error(`    快照里已不存在的页面：${stale.join(" ")}`);
  ok(pages.length === 163 && missing.length === 0 && stale.length === 0, `163 个 (main) 页面与快照一一对应（实际 ${pages.length}）`);
  const drift = PAGE_RULE_SNAPSHOT.filter(([p, label]) => ruleLabel(matchRouteGateEntry(p.replace(/\[[^\]]+\]/g, "x"))) !== label);
  if (drift.length) console.error(`    规则与快照不一致：${drift.map(([p]) => p).join(" ")}`);
  ok(drift.length === 0, "每个页面命中的门表条目与规则都与快照一致");
}

// ─────────────────────────── 侧栏可见 ⇔ 放行（只对单个侧栏入口的条目）───────────────────────────
function flatKeys(items: ResolvedNavItem[]): string[] {
  return items.flatMap((i) => [i.key, ...(i.children ? flatKeys(i.children) : [])]);
}
{
  const sidebarEntries = ROUTE_GATE_TABLE.filter(
    (e) =>
      e.rule.kind === "nav" &&
      e.rule.navKeys.length === 1 &&
      !e.rule.allowProjectMember &&
      !e.rule.allowWithoutMembership &&
      !ROUTE_ONLY_NAV_ITEMS.some((i) => i.key === (e.rule as { navKeys: readonly string[] }).navKeys[0]),
  );
  const mismatches: string[] = [];
  for (const name of IDS) {
    const c = ID[name];
    const visible = new Set(flatKeys(resolveNavigationTree([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS], at(c, "/"))));
    for (const e of sidebarEntries) {
      const key = (e.rule as { navKeys: readonly string[] }).navKeys[0];
      const path = samplePath(e.pattern);
      if (visible.has(key) !== allowed(name, path)) mismatches.push(`${name}:${path}`);
    }
  }
  if (mismatches.length) console.error(`    不一致：${mismatches.slice(0, 20).join(" ")}`);
  ok(sidebarEntries.length > 60 && mismatches.length === 0, `侧栏可见 ⇔ 放行（${IDS.length} 种身份 × ${sidebarEntries.length} 条单入口条目）`);
}

// ─────────────────────────── 落地页必放行、一跳即停 ───────────────────────────
for (const name of IDS) {
  const c = at(ID[name], "/no-such-workspace");
  const t = gateRedirectTarget("/no-such-workspace", c);
  const home = resolveHomeRedirect(workspaceContextFromNav(c));
  ok(isRouteAllowed(t, at(ID[name], t)) && (t !== "/" || home === null), `${name}：落地 ${t} 放行且一跳即停`);
}

// ─────────────────────────── spec 场景 ───────────────────────────
{
  // 不放行时 302 到落地页
  const LYNN_DENIED = [
    "/trade/prospects", "/revenue", "/projects", "/projects/intelligence", "/bids", "/capabilities", "/knowledge",
    "/suppliers", "/service-inbox", "/reports", "/marketing/employee", "/operations/growth", "/accounting", "/install",
    "/inventory", "/blinds-orders",
  ];
  ok(LYNN_DENIED.every((p) => target("sales_rep", p) === "/sales/home"), "Lynn（sales_rep）：外贸 / 招投标 / 营销 / 会计 / 安装 / 库存 / 工艺单列表 → /sales/home");
  ok(["/marketing/employee", "/operations/growth", "/inventory"].every((p) => target("installer", p) === "/install"), "安装工：营销 / 库存 → /install");
  ok(["/revenue", "/revenue/today", "/trade/prospects"].every((p) => target("owner", p) === "/"), "Sunny 老板：营收中心 / 外贸 → /（模块未开，尽管持 trade.read）");
  ok(target("fulfillment_vinyl", "/bids") === "/tasks", "fulfillment_vinyl：/bids → /tasks（不先到 /）");
  ok(target("bids", "/capabilities/catalog") === "/bids" && target("bids", "/capabilities") === "/bids", "bids：AI 工作中心子页要求父入口 → /bids");
  ok(IDS.every((n) => target(n, "/no-such-workspace") === gateRedirectTarget("/no-such-workspace", at(ID[n], "/no-such-workspace"))), "未登记路径：一律按不放行处理");
  ok(IDS.every((n) => !allowed(n, "/no-such-workspace")), "未登记路径：任一非 super_admin 身份都不放行");

  // 登录即可
  const LOGIN_ONLY_PATHS = ["/", "/tasks", "/tasks/x", "/notifications", "/help", "/settings", "/settings/account", "/settings/appearance", "/settings/notifications", "/settings/wechat", "/wechat"];
  ok(IDS.every((n) => LOGIN_ONLY_PATHS.every((p) => allowed(n, p))), "登录即可的路由对每种身份放行");
  ok(classifyPageRequest("/settings/wechat") === "login_only" && classifyPageRequest("/tasks/abc") === "login_only", "登录即可的路由不进判定");

  // 销售复盘
  ok(["owner", "pricing_lead", "accounting", "sales_rep"].every((n) => allowed(n as IdName, "/sales/analytics")), "持 sales.analytics.read：老板 / 合价 / 会计 / 销售可进销售复盘");
  ok(["ops_lead", "bids", "installer"].every((n) => !allowed(n as IdName, "/sales/analytics")), "不持复盘键：运营 / 招投标 / 安装工不放行");
  ok(target("ops_lead", "/sales/analytics") === "/ops", "ops_lead：/sales/analytics → /ops");

  // 平台管理员页
  const PLATFORM_PAGES = ["/agent-trace", "/ai-activity", "/settings/digital-employees", "/settings/digital-employees/playbooks", "/settings/agent-skills", ...["agents", "prompts", "tools", "knowledge-bases", "feedbacks", "feedback-tags", "quality"].map((s) => `/projects/x/${s}`)];
  ok(IDS.every((n) => PLATFORM_PAGES.every((p) => !allowed(n, p))), "平台管理员页：非 super_admin 一律不放行（含老板）");
  ok(target("owner", "/ai-activity") === "/" && target("owner", "/projects/x/prompts") === "/", "Sunny 老板：/ai-activity、/projects/<id>/prompts → /");

  // 其余无侧栏入口
  ok(allowed("installer", "/sales/calendar"), "安装工：/sales/calendar 放行（install-tasks 承诺）");
  ok(allowed("accounting", "/sales/website-bookings"), "会计：/sales/website-bookings 放行（website-booking-intake 承诺）");
  ok(allowed("mx_trade_rep", "/settings/email") && target("installer", "/settings/email") === "/install", "梦馨外贸：/settings/email 放行；安装工 → /install");
  ok(allowed("bids", "/settings/email") && allowed("sales_rep", "/settings/email"), "招投标 / 销售：/settings/email 放行");
  ok(allowed("sales_rep", "/sales/measure") && allowed("bids", "/operations/tender-profile") && !allowed("accounting", "/operations/tender-profile"), "随入口：量房随报价、投标档案随招投标中心");

  // 对象详情页
  ok(["/blinds-orders/x", "/blinds-orders/x/edit", "/sales/customers/x", "/capabilities/approvals", "/capabilities/approvals/x"].every((p) => allowed("sales_rep", p)), "Lynn：工艺单详情 / 客户详情 / 审批中心放行");
  ok(target("sales_rep", "/blinds-orders") === "/sales/home", "Lynn：工艺单列表 → /sales/home");
  ok(allowed("ops_staff", "/projects/x") && target("ops_staff", "/projects") === "/ops", "ops_staff：项目详情放行，项目列表 → /ops");
  ok(isRouteAllowed("/projects/x", at({ ...ID.installer, hasBidCapability: true }, "/projects/x")) && !allowed("installer", "/projects/x"), "安装工：是项目成员才能开项目详情");
  ok(!isRouteAllowed("/projects/x", at({ ...ID.mx_trade_rep, hasBidCapability: true }, "/projects/x")), "项目成员仍要求模块：梦馨（无 bids / projects）项目成员不进项目详情");
  ok(allowed("bids", "/capabilities/approvals") && allowed("legacy_trade", "/sales/customers/x") && allowed("mx_trade_rep", "/sales/customers/x"), "招投标进审批中心；外贸（旧模式 / 梦馨）进客户详情");
  ok(!allowed("mx_cathy", "/blinds-orders/x") && !allowed("mx_cathy", "/projects/x"), "详情页仍要求模块：梦馨（无窗饰 / 招投标模块）老板不进工艺单 / 项目详情");
  ok(isRouteAllowed("/organizations", at({ ...ID.no_position, hasMembership: false, orgRole: null }, "/organizations")), "无成员身份：/organizations 列表放行");
  ok(!allowed("sales_rep", "/organizations") && !allowed("sales_rep", "/organizations/x"), "Lynn（有成员身份、侧栏无「成员与组织」）：/organizations 不放行");

  // 营销工作区（spec marketing/growth-center-access）
  ok(target("sales_rep", "/operations/growth") === "/sales/home" && target("installer", "/marketing/employee") === "/install", "营销：销售 → /sales/home，安装工 → /install");
  ok(target("accounting", "/operations/growth/campaigns") === "/accounting" && !allowed("bids", "/operations/growth"), "营销：会计 → /accounting，招投标不放行");
  ok(allowed("ops_staff", "/operations/growth") && allowed("owner", "/operations/growth"), "营销：运营与老板照常");
  ok(target("mx_trade_rep", "/marketing/employee") === "/tasks" && target("legacy_trade", "/marketing/employee") === "/tasks", "营销：梦馨外贸业务员 / 旧模式外贸 → /tasks");
  ok(target("legacy_sales", "/operations/growth") === "/sales/home", "营销：旧模式销售 → /sales/home");

  // 两种模式
  ok(["/trade/prospects/x", "/revenue", "/product-content", "/operations/growth", "/settings/email"].every((p) => allowed("mx_cathy", p)), "梦馨 Cathy（owner + trade_rep）：外贸 / 营收 / 产品内容 / 营销 / 邮箱照常");
  ok(target("mx_trade_rep", "/operations/growth") === "/tasks", "梦馨 trade_rep：/operations/growth → /tasks");
  ok(allowed("legacy_trade", "/revenue") && allowed("mx_trade_rep", "/revenue"), "外贸（旧模式 / 梦馨）：/revenue 放行");
  ok(target("owner", "/revenue") === "/", "revenue/spine-access：Sunny 老板 /revenue → /");
}

// ─────────────────────────── 请求分类 ───────────────────────────
{
  ok(classifyPageRequest("/api/sales/home") === "api" && classifyPageRequest("/api") === "api", "/api/** 不经路由门");
  for (const p of ["/sw.js", "/manifest.json", "/sunny-quote.html", "/sku-catalog.csv", "/brands/x.png", "/icons/icon-192x192.png", "/logo.png", "/embed/inquiry.js"]) {
    ok(classifyPageRequest(p) === "static_file", `${p}：public 静态文件`);
  }
  ok(isStaticImagePath("/icons/icon-192x192.png") && isStaticImagePath("/logo.png") && !isStaticImagePath("/sw.js") && !isStaticImagePath("/manifest.json"), "只有 public 图片在登录前放行");
  for (const p of ["/trade/prospects/x.json", "/projects/a.png", "/sales/quote-sheet/x.html"]) {
    ok(classifyPageRequest(p) === "gated" && !isStaticFilePath(p), `${p}：已登录区路径带扩展名照样判定`);
  }
  ok(ROUTE_GATE_OUTSIDE_PATHS.every((p) => classifyPageRequest(p) === "outside") && classifyPageRequest("/_next/webpack-hmr") === "outside", "门外：/login /register /select-org /monitoring /_next");
  ok(classifyPageRequest("/trade") === "gated" && classifyPageRequest("/no-such-workspace") === "gated", "其余已登录区路径需判定");
}

// ─────────────────────────── HTTP 层（注入加载器）───────────────────────────
function fakeLoader(user: RouteGateUser | null | "throw", c: RouteGateContext | "throw") {
  const calls = { user: 0, context: 0 };
  const loader: RouteGateLoader = {
    async loadUser() {
      calls.user++;
      if (user === "throw") throw new Error("db down");
      return user;
    },
    async loadContext() {
      calls.context++;
      if (c === "throw") throw new Error("db down");
      return c;
    },
  };
  return { loader, calls };
}
const activeUser = (role = "user"): RouteGateUser => ({ id: "u1", role, status: "active", activeOrgId: "org1" });
const req = (path: string) => new NextRequest(`http://localhost${path}`);

async function http() {
  {
    const { loader } = fakeLoader(activeUser(), ID.sales_rep);
    const res = await applyRouteGate(req("/trade/prospects?tab=all&x=1"), "u1", loader);
    const loc = res?.headers.get("location") ?? "";
    ok(res?.status === 302 && new URL(loc).pathname === "/sales/home" && new URL(loc).search === "", "Lynn 硬加载 /trade/prospects：302 → /sales/home，不带原查询串");
    const body = res ? await res.text() : "x";
    const customHeaders = res ? [...res.headers.keys()].filter((h) => h !== "location") : ["x"];
    ok(body === "" && customHeaders.length === 0, "302 正文为空、除 Location 外没有响应头（不泄露页面与判定原因）");
  }
  {
    const { loader } = fakeLoader(activeUser(), ID.fulfillment_vinyl);
    const res = await applyRouteGate(req("/bids?tab=rfq"), "u1", loader);
    ok(res?.status === 302 && new URL(res.headers.get("location")!).pathname === "/tasks" && new URL(res.headers.get("location")!).search === "", "出单 /bids?tab=rfq：302 → /tasks，不带 ?tab=rfq");
  }
  {
    const { loader } = fakeLoader(activeUser(), ID.owner);
    ok((await applyRouteGate(req("/sales/analytics"), "u1", loader)) === null, "老板 /sales/analytics：放行");
  }
  {
    const { loader } = fakeLoader(activeUser(), "throw");
    const res = await applyRouteGate(req("/bids"), "u1", loader);
    ok(res?.status === 302 && new URL(res.headers.get("location")!).pathname === "/tasks", "取判定输入失败：302 → /tasks（fail-closed）");
  }
  {
    const { loader } = fakeLoader("throw", ID.owner);
    const res = await applyRouteGate(req("/bids"), "u1", loader);
    ok(res?.status === 302 && new URL(res.headers.get("location")!).pathname === "/tasks", "取用户失败：302 → /tasks（fail-closed）");
  }
  {
    const { loader } = fakeLoader({ ...activeUser(), status: "disabled" }, ID.owner);
    const res = await applyRouteGate(req("/sales/home"), "u1", loader);
    ok(res?.status === 302 && new URL(res.headers.get("location")!).pathname === "/login", "停用用户：302 → /login");
    const gone = fakeLoader(null, ID.owner);
    const res2 = await applyRouteGate(req("/sales/home"), "u1", gone.loader);
    ok(res2?.status === 302 && new URL(res2.headers.get("location")!).pathname === "/login", "用户不存在：302 → /login");
  }
  {
    const { loader, calls } = fakeLoader(activeUser("super_admin"), "throw");
    const paths = [...ROUTE_GATE_TABLE.map((e) => samplePath(e.pattern)), "/no-such-workspace", "/trade/prospects"];
    const results = await Promise.all(paths.map((p) => applyRouteGate(req(p), "u1", loader)));
    ok(results.every((r) => r === null) && calls.context === 0, "平台 super_admin：全部放行（含未登记路径），不取企业侧输入");
  }
  {
    const { loader, calls } = fakeLoader(activeUser(), ID.sales_rep);
    const paths = ["/api/sales/home", "/sw.js", "/sunny-quote.html", "/brands/x.png", "/login", "/select-org", "/monitoring", "/", "/tasks?open=1", "/settings/wechat", "/notifications"];
    const results = await Promise.all(paths.map((p) => applyRouteGate(req(p), "u1", loader)));
    ok(results.every((r) => r === null) && calls.user === 0 && calls.context === 0, "API / 静态 / 门外 / 登录即可：放行且不调加载器");
  }
  // 编码路径：原样与解码后都须放行（Next 生产环境按解码后的路径查静态路由）
  {
    const check = async (c: RouteGateContext, path: string) => {
      const { loader } = fakeLoader(activeUser(), c);
      return applyRouteGate(req(path), "u1", loader);
    };
    const denied = async (c: RouteGateContext, path: string) => (await check(c, path))?.status === 302;
    ok(await denied(ID.accounting, "/projects/%69ntelligence") && await denied(ID.accounting, "/projects/intelligence%2Fawards"), "编码路径：会计不能经 /projects/%69ntelligence 或 %2F 进项目情报");
    ok(await denied(ID.fulfillment_vinyl, "/projects/%69ntelligence") && await denied(ID.ops_staff, "/projects/intelligence%2Fawards"), "编码路径：出单 / 运营同样被拦");
    ok(await denied(ID.sales_rep, "/blinds-orders/%6Eew") && await denied(ID.owner, "/revenue/%74oday") && await denied(ID.sales_rep, "/trade/%70rospects"), "编码路径：工艺单新建 / 今日询盘 / 外贸子页不能绕过");
    ok(await denied(ID.bids, "/projects/%E0%A4%A"), "编码路径：解码失败按不放行");
    ok((await check(ID.bids, "/projects/%69ntelligence")) === null, "编码路径：原样与解码后都放行的页面照常放行");
    ok(await denied(ID.sales_rep, "/sales/%68ome"), "编码路径：原样路径不在门表里即拒绝（站内链接不会把字母编码，宁拒勿放）");
    ok(classifyPageRequest("/projects%2Fa.png") === "gated" && !isStaticImagePath("/projects%2Fa.png"), "编码路径：/projects%2Fa.png 不当作 public 图片");
    // RSC / 预取路径变体按页面路径判定
    ok(classifyPageRequest("/revenue.prefetch") === "gated" && classifyPageRequest("/revenue.segments/_tree.segment.rsc") === "gated", "RSC 变体：/x.prefetch、/x.segments/… 按页面判定，不当静态文件");
    ok(await denied(ID.owner, "/revenue.prefetch") && await denied(ID.owner, "/revenue.segments/_tree.segment.rsc"), "RSC 变体：Sunny 老板的营收中心预取同样被拦");
    ok((await check(ID.mx_trade_rep, "/revenue.prefetch")) === null && classifyPageRequest("/index.segments/_tree.segment.rsc") === "login_only", "RSC 变体：放行的页面照常；首页的 /index.segments 还原为 /");
    ok((await check(ID.bids, "//bids")) === null && await denied(ID.sales_rep, "//bids") && await denied(ID.bids, "/BIDS"), "双斜杠按同一路径判定；大写路径不命中门表即拒绝");
  }

  // 中间件层：判定顺序（design D3）——public 图片在登录检查之前放行，其余静态文件仍要登录
  {
    const loc = async (p: string) => (await proxy(req(p))).headers.get("location") ?? "";
    ok((await loc("/icons/icon-192x192.png")) === "" && (await loc("/logo.png")) === "", "未登录：登录页图标 / 大屏 logo 不被重定向");
    ok(new URL(await loc("/sw.js")).pathname === "/login", "未登录：/sw.js 与改动前一样跳 /login");
    ok(new URL(await loc("/projects/a.png")).pathname === "/login", "未登录：/projects/a.png（已登录区路径带图片扩展名）跳 /login");
    ok(new URL(await loc("/trade/prospects")).pathname === "/login", "未登录：页面照旧跳 /login");
    const api = await proxy(req("/api/sales/home"));
    ok(api.status === 401, "未登录：接口照旧 401");
  }
}

// ─────────────────────────── 中间件加载器（假依赖：当前企业、缓存、降级、并发合并）───────────────────────────
async function loaderFactory() {
  ok(pickGateOrgId(null, ["a"]) === "a" && pickGateOrgId("b", ["a"]) === "a", "当前企业：只有一家可用企业就用它（与 resolvePreferredOrgId 一致）");
  ok(pickGateOrgId("a", ["a", "b"]) === "a" && pickGateOrgId("c", ["a", "b"]) === null && pickGateOrgId(null, ["a", "b"]) === null, "当前企业：多家时用 activeOrgId 且须在可用企业里，否则无企业");
  ok(pickGateOrgId("a", []) === null, "当前企业：已被移出（无可用企业）→ 无企业，不沿用旧 activeOrgId");

  let now = 0;
  let usable = ["orgA"];
  let degradeNext = false;
  const fetched: string[] = [];
  const inputs = (orgId: string | null): OrgNavigationInputs => ({ ...NO_ORG_INPUTS, orgRole: orgId ? "org_member" : null, hasMembership: Boolean(orgId), permissionKeys: orgId ? [`k:${orgId}`] : [] });
  const loader = createRouteGateLoader({
    findUser: async (id) => ({ id, role: "user", status: "active", activeOrgId: "orgA" }),
    findUsableOrgIds: async () => usable,
    loadOrgInputs: async (_u, orgId) => {
      fetched.push(orgId ?? "-");
      await new Promise((r) => setTimeout(r, 5));
      const degraded = degradeNext;
      degradeNext = false;
      return { inputs: degraded ? { ...inputs(orgId), permissionKeys: [] } : inputs(orgId), degraded };
    },
    cache: new TtlCache<OrgNavigationInputs>({ ttlMs: ROUTE_GATE_CACHE_TTL_MS, max: 10, now: () => now }),
    autopilotAllowed: () => false,
    wechatEntryEnabled: () => false,
  });
  const user = (await loader.loadUser("u1"))!;
  const burst = await Promise.all(Array.from({ length: 5 }, () => loader.loadContext(user)));
  ok(fetched.length === 1 && burst.every((c) => c.permissionKeys?.[0] === "k:orgA"), "并发预取：同一用户同一企业只取一次");
  await loader.loadContext(user);
  ok(fetched.length === 1, "30 秒内命中缓存");
  now += ROUTE_GATE_CACHE_TTL_MS;
  await loader.loadContext(user);
  ok(fetched.length === 2, "30 秒后重新取");
  usable = ["orgA", "orgB"];
  const switched = await loader.loadContext({ ...user, activeOrgId: "orgB" });
  ok(fetched.at(-1) === "orgB" && switched.permissionKeys?.[0] === "k:orgB", "切换企业：按新企业取，不复用旧企业缓存");
  usable = [];
  const removed = await loader.loadContext(user);
  ok(removed.hasMembership === false && (removed.permissionKeys ?? []).length === 0, "被移出企业：无企业、无键（与侧栏一致）");
  usable = ["orgC"];
  degradeNext = true;
  await loader.loadContext(user);
  await loader.loadContext(user);
  ok(fetched.filter((o) => o === "orgC").length === 2, "岗位权限键解析失败的降级结果不缓存");
}

// ─────────────────────────── 缓存 ───────────────────────────
{
  let now = 1_000;
  const cache = new TtlCache<number>({ ttlMs: ROUTE_GATE_CACHE_TTL_MS, max: 3, now: () => now });
  cache.set("u1:orgA", 1);
  cache.set("u1:orgB", 2);
  ok(cache.get("u1:orgA") === 1 && cache.get("u1:orgB") === 2, "缓存：不同企业分键，互不复用");
  now += ROUTE_GATE_CACHE_TTL_MS - 1;
  ok(cache.get("u1:orgA") === 1, "缓存：30 秒内命中");
  now += 1;
  ok(cache.get("u1:orgA") === undefined, "缓存：30 秒后失效");
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  cache.set("d", 4);
  ok(cache.size === 3 && cache.get("a") === undefined && cache.get("d") === 4, "缓存：超过上限淘汰最旧");
  ok(ROUTE_GATE_CACHE_TTL_MS === 30_000 && ROUTE_GATE_CACHE_MAX === 500, "缓存：30 秒、500 条");
}

// ─────────────────────────── 源码断言 ───────────────────────────
{
  // (main) 以外的 6 个页面：门外清单或中间件免登录清单
  const mw = read("src/proxy.ts");
  const m = mw.match(/const PUBLIC_PATHS\s*=\s*\[([\s\S]*?)\];/);
  const publicPaths = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  const outsideMain = ["/login", "/register", "/select-org", "/display", "/quote/x", "/sales/share/visualizer/x"];
  const covered = (p: string) =>
    [...ROUTE_GATE_OUTSIDE_PATHS, ...publicPaths].some((q) => p === q || p.startsWith(q + "/"));
  ok(outsideMain.every(covered), "(main) 以外的 6 个页面都在门外清单或免登录清单里");
  const nonMain = readdirSync(join(root, "src/app"))
    .filter((d) => d !== "(main)" && d !== "api" && statSync(join(root, "src/app", d)).isDirectory());
  const countPages = (dir: string): number =>
    readdirSync(dir).reduce((n, name) => {
      const full = join(dir, name);
      return n + (statSync(full).isDirectory() ? countPages(full) : name === "page.tsx" ? 1 : 0);
    }, 0);
  ok(nonMain.reduce((n, d) => n + countPages(join(root, "src/app", d)), 0) === 6, "(main) 以外恰有 6 个页面");
  // public/：都带扩展名，一级名不与已登录区一级路径重名
  const publicFiles: string[] = [];
  const walkPublic = (dir: string) => readdirSync(dir).forEach((n) => { const f = join(dir, n); if (statSync(f).isDirectory()) walkPublic(f); else publicFiles.push(f); });
  walkPublic(join(root, "public"));
  ok(publicFiles.length > 0 && publicFiles.every((f) => /\.[A-Za-z0-9]+$/.test(f)), "public/ 下文件都带扩展名");
  ok(readdirSync(join(root, "public")).every((n) => !GATED_TOP_SEGMENTS.has(n)), "public/ 一级名不与已登录区一级路径重名");
  ok(existsSync(join(root, "src/app/(main)")) && GATED_TOP_SEGMENTS.size > 25, "门表一级路径集合已生成");

  // /api/auth/active-org：判定输入与路由门同一个构造器，响应 JSON 键集合与改动前一致
  const ao = read("src/app/api/auth/active-org/route.ts");
  ok(/from "@\/lib\/navigation\/context-server"/.test(ao) && /loadOrgNavigationInputs\(user\.id, resolved\.orgId\)/.test(ao), "active-org 从 context-server 取判定输入");
  ok(!/resolveEffectiveBindings|withIndustryPackModules|hasPositionTemplates/.test(ao), "active-org 不再自拼判定输入");
  const getBody = ao.slice(ao.indexOf("export async function GET"), ao.indexOf("export async function PATCH"));
  const jsonStart = getBody.lastIndexOf("return NextResponse.json({");
  const jsonBlock = getBody.slice(jsonStart, getBody.indexOf("\n  });", jsonStart));
  const keys = [...jsonBlock.matchAll(/^\s{4}(\w+)(?=[,:\n])/gm)].map((x) => x[1]).sort();
  const BEFORE = ["activeOrgId", "orgCode", "orgCompany", "modules", "orgRole", "workspaceIds", "hasMembership", "hasBidCapability", "permissionKeys", "positionMode", "needsSelection", "orgAccessMode", "canSelfSwitchOrg", "canSwitch", "organizations"].sort();
  ok(JSON.stringify(keys) === JSON.stringify(BEFORE), `active-org 响应键集合与改动前一致（${keys.length} 个）`);
  const cs = read("src/lib/navigation/context-server.ts");
  ok(!/resolvePreferredOrgId\(/.test(cs) && /pickGateOrgId\(user\.activeOrgId/.test(cs) && /org: \{ status: \{ not: "archived" \} \}/.test(cs), "context-server：中间件不调 resolvePreferredOrgId，当前企业只读解析（可用企业 = active 成员 ∧ 未归档）");
  ok(/withIndustryPackModules\(/.test(cs) && /hasPositionTemplates\(/.test(cs) && /resolveEffectiveBindings\(/.test(cs), "context-server：模块含行业包兜底、岗位模式、岗位权限键");

  // 中间件（Next 16 proxy 约定，next16-proxy-rename）：入口是 src/proxy.ts 的 proxy 函数、不声明 runtime（proxy 固定 Node.js runtime，声明即构建报错）；
  // 从 context-server 取输入、调用路由门；营销页面分支已删；matcher 不再排除图片
  ok(!("runtime" in proxyConfig), "proxy 不声明 runtime（Next 16 proxy 固定 Node.js runtime）");
  ok(!existsSync(join(root, "src/middleware.ts")), "src/middleware.ts 已不存在（Next 16 弃用 middleware 约定，与 proxy.ts 并存即构建报错）");
  ok(/^export async function proxy\(request: NextRequest\)/m.test(mw), "src/proxy.ts 导出 proxy 函数");
  ok(/import \{ ROUTE_GATE_LOADER \} from "@\/lib\/navigation\/context-server"/.test(mw) && /handleRequest\(request, ROUTE_GATE_LOADER\)/.test(mw) && /applyRouteGate\(request, session\.sub, loader\)/.test(mw), "中间件从 context-server 取输入并调用路由门");
  ok(!/isMarketingWorkspacePath|isMarketingPagePath/.test(mw), "中间件不再引用营销页面判定");
  ok(proxyConfig.matcher.every((m) => !/png|svg|jpe?g|gif|webp/.test(m)), "matcher 不再按图片扩展名排除");
  ok(/const VERSION = "qingyan-v4";/.test(read("public/sw.js")), "Service Worker 缓存版本提升到 qingyan-v4");
}

http().then(loaderFactory).then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
});
