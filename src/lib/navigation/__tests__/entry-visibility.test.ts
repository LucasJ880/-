/**
 * VIS-1b 入口判定（spec navigation/entry-visibility、navigation/position-based-visibility；change vis-1b-home-and-shell）
 * 判定输入拼装与路由门 loader 一致 + 客户端判定与路由门 HTTP 结果一致 + 纯模块源码断言
 * 运行：npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  ROUTE_GATE_TABLE,
  TtlCache,
  applyRouteGate,
  type RouteGateUser,
} from "../route-gate";
import { createRouteGateLoader } from "../context-server";
import {
  activeOrgNavigationFields,
  buildNavigationFilterContext,
  inputsFromActiveOrgResponse,
  type OrgNavigationInputs,
  type RouteGateContext,
} from "../filter-context";
import { blindsOrderBackHref, canOpenHref } from "../landing";
import { computeMobileTabs } from "../mobile-tabs";
import { navEntryVisible } from "../route-gate-core";
import { buildHelpMap } from "../help-map";
import { OPERATIONS_INDEX_CARDS, visibleOperationsCards } from "../operations-index";
import { NAVIGATION_REGISTRY, SYSTEM_NAV_ITEMS } from "../registry";
import { resolveNavigationTree } from "../filter";
import type { NavigationItem, ResolvedNavItem } from "../types";
import {
  HOME_TEXTILE_TRADE_INDUSTRY_PACK,
  WINDOW_COVERING_INDUSTRY_PACK,
  mergedProfileBindings,
} from "@/lib/authorization/role-defaults";
import { DEFAULT_MENGXIN_MODULES, DEFAULT_SUNNY_MODULES, type OrgModule } from "@/lib/tenancy/modules";

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

// ─────────────────────────── 身份（企业侧输入 + 平台角色）───────────────────────────

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

type Identity = { role: string; inputs: OrgNavigationInputs };
function inputs(partial: Partial<OrgNavigationInputs>): OrgNavigationInputs {
  return {
    modules: { enabled: [...DEFAULT_SUNNY_MODULES] },
    positionMode: true,
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: [],
    hasBidCapability: false,
    permissionKeys: [],
    ...partial,
  };
}
const MX = { enabled: [...DEFAULT_MENGXIN_MODULES] };
const IDENTITIES: Record<string, Identity> = {
  sales_rep: { role: "user", inputs: inputs({ permissionKeys: sunny("sales_rep") }) },
  pricing_lead: { role: "user", inputs: inputs({ permissionKeys: sunny("pricing_lead") }) },
  owner: { role: "user", inputs: inputs({ permissionKeys: sunny("owner"), orgRole: "org_admin" }) },
  owner_sales_only: { role: "user", inputs: inputs({ permissionKeys: sunny("owner"), orgRole: "org_admin", modules: { enabled: ["sales"] } }) },
  bids: { role: "user", inputs: inputs({ permissionKeys: sunny("bids") }) },
  ops_lead: { role: "user", inputs: inputs({ permissionKeys: sunny("ops_lead") }) },
  ops_staff: { role: "user", inputs: inputs({ permissionKeys: sunny("ops_staff") }) },
  ops_lead_bids: { role: "user", inputs: inputs({ permissionKeys: sunny("ops_lead", "bids") }) },
  accounting: { role: "user", inputs: inputs({ permissionKeys: sunny("accounting") }) },
  installer: { role: "user", inputs: inputs({ permissionKeys: sunny("installer") }) },
  fulfillment_vinyl: { role: "user", inputs: inputs({ permissionKeys: sunny("fulfillment_vinyl") }) },
  no_position: { role: "user", inputs: inputs({}) },
  project_member: { role: "user", inputs: inputs({ hasBidCapability: true }) },
  no_membership: { role: "user", inputs: inputs({ orgRole: null, hasMembership: false }) },
  mx_cathy: { role: "user", inputs: inputs({ modules: MX, permissionKeys: mengxin("owner", "trade_rep"), orgRole: "org_admin" }) },
  mx_trade_rep: { role: "user", inputs: inputs({ modules: MX, permissionKeys: mengxin("trade_rep") }) },
  legacy_sales: { role: "sales", inputs: inputs({ positionMode: false, modules: { enabled: LEGACY_MODULES }, permissionKeys: sunny("sales_rep") }) },
  legacy_boss: { role: "boss", inputs: inputs({ positionMode: false, orgRole: "org_admin", modules: { enabled: LEGACY_MODULES } }) },
  super_admin: { role: "super_admin", inputs: inputs({ permissionKeys: [] }) },
};
const NAMES = Object.keys(IDENTITIES);
const FLAGS = { autopilotAllowed: false, wechatEntryEnabled: false };

/** 客户端路径：active-org 响应（JSON 往返）→ 还原 → 拼装 */
function clientCtx(id: Identity, flags = FLAGS): RouteGateContext {
  const body = JSON.parse(JSON.stringify({ activeOrgId: "org1", orgCode: "x", ...activeOrgNavigationFields(id.inputs) }));
  return buildNavigationFilterContext(inputsFromActiveOrgResponse(body), { role: id.role }, flags);
}

function loaderFor(id: Identity, flags = FLAGS) {
  return createRouteGateLoader({
    findUser: async () => ({ id: "u1", role: id.role, status: "active", activeOrgId: "org1" }),
    findUsableOrgIds: async () => ["org1"],
    loadOrgInputs: async () => ({ inputs: id.inputs, degraded: false }),
    cache: new TtlCache({ ttlMs: 1000, max: 10 }),
    autopilotAllowed: () => flags.autopilotAllowed,
    wechatEntryEnabled: () => flags.wechatEntryEnabled,
  });
}
const gateUser = (id: Identity): RouteGateUser => ({ id: "u1", role: id.role, status: "active", activeOrgId: "org1" });

/** 门表条目对应的示例路径：`*` → x，去掉结尾 `=`；再加一层子路径 */
const samplePaths = (() => {
  const out = new Set<string>(["/", "/no-such-workspace"]);
  for (const e of ROUTE_GATE_TABLE) {
    const p = e.pattern.replace(/=$/, "").replace(/\*/g, "x") || "/";
    out.add(p);
    if (!e.pattern.endsWith("=")) out.add(`${p === "/" ? "" : p}/x`);
  }
  return [...out];
})();

async function main() {
  console.log("entry-visibility（VIS-1b）");

  // ── 判定输入拼装：客户端与路由门 loader 逐字段相同 ──
  {
    const diffs: string[] = [];
    for (const name of NAMES) {
      const id = IDENTITIES[name];
      for (const flags of [FLAGS, { autopilotAllowed: true, wechatEntryEnabled: true }]) {
        const server = await loaderFor(id, flags).loadContext(gateUser(id));
        const client = clientCtx(id, flags);
        if (JSON.stringify(server) !== JSON.stringify(client)) diffs.push(name);
      }
    }
    ok(diffs.length === 0, `客户端由 active-org 响应拼出的判定输入与 loader 逐字段相同（${NAMES.length} 种身份 × 2 组开关${diffs.length ? "；不同：" + diffs.join(",") : ""}）`);
    const roundTrip = NAMES.every((n) => {
      const i = IDENTITIES[n].inputs;
      return JSON.stringify(inputsFromActiveOrgResponse(JSON.parse(JSON.stringify(activeOrgNavigationFields(i))))) === JSON.stringify(i);
    });
    ok(roundTrip, "active-org 导航字段 → 还原：企业侧输入不变");
    const legacy = inputsFromActiveOrgResponse({ orgRole: "org_member" });
    ok(legacy.hasMembership === true && legacy.modules === null && legacy.permissionKeys.length === 0, "响应缺 hasMembership 时按 orgRole 推出成员身份（与侧栏既有口径一致）");
    ok(inputsFromActiveOrgResponse(null).hasMembership === false && inputsFromActiveOrgResponse("x").positionMode === false, "响应不是对象：按「无企业」处理");
  }

  // ── 客户端判定与路由门一致（HTTP 层，含 super_admin 旁路）──
  {
    const mismatches: string[] = [];
    for (const name of NAMES) {
      const id = IDENTITIES[name];
      const loader = loaderFor(id);
      const c = clientCtx(id);
      for (const path of samplePaths) {
        const res = await applyRouteGate(new NextRequest(`http://localhost${path}`), "u1", loader);
        if ((res === null) !== canOpenHref(path, c)) mismatches.push(`${name} ${path}`);
      }
    }
    ok(mismatches.length === 0, `${NAMES.length} 种身份 × ${samplePaths.length} 条登记路径：客户端判定与路由门结果相同${mismatches.length ? "；不同：" + mismatches.slice(0, 8).join(" | ") : ""}`);
    const sa = clientCtx(IDENTITIES.super_admin);
    ok(samplePaths.every((p) => canOpenHref(p, sa)), "平台 super_admin：全部放行");
    ok(!canOpenHref("/tasks", null) && !canOpenHref("/", null), "输入未就绪：一律不放行（入口不先显示后消失）");
    const lynn = clientCtx(IDENTITIES.sales_rep);
    ok(canOpenHref("/sales?view=customers", lynn) && !canOpenHref("/bids?tab=rfq#x", lynn), "href 的查询串与锚点不参与判定");
  }

  // ── 手机底栏页签（spec navigation/position-based-visibility）──
  {
    const tabsOf = (name: string) => computeMobileTabs(clientCtx(IDENTITIES[name]));
    const keys = (name: string) => tabsOf(name).tabs.map((t) => t.key);
    ok(tabsOf("sales_rep").layout === "sales" && tabsOf("pricing_lead").layout === "sales", "销售岗位用销售底栏");
    ok(!keys("fulfillment_vinyl").includes("ai") && keys("fulfillment_vinyl").includes("assistant"), "出单的底栏没有「AI」（/capabilities 不放行），有「助手」", keys("fulfillment_vinyl"));
    ok(!keys("accounting").includes("bids") && !keys("fulfillment_vinyl").includes("bids"), "会计与出单的底栏没有「招投标」", { acc: keys("accounting"), ful: keys("fulfillment_vinyl") });
    ok(keys("ops_lead_bids").includes("bids"), "ops_lead + bids 的底栏有「招投标」", keys("ops_lead_bids"));
    const mismatch = NAMES.filter((n) => n !== "super_admin").filter((n) => {
      const c = clientCtx(IDENTITIES[n]);
      return keys(n).includes("bids") !== navEntryVisible("ws-bids", { ...c, pathname: "/bids" });
    });
    ok(mismatch.length === 0, "每种身份：底栏是否出现「招投标」与侧栏「招投标中心」是否可见相同", mismatch);
    const unopenable = NAMES.flatMap((n) => tabsOf(n).tabs.filter((t) => !canOpenHref(t.href, clientCtx(IDENTITIES[n]))).map((t) => `${n}:${t.key}`));
    ok(unopenable.length === 0, "每种身份：底栏的每个页签都放行（点进去不被弹回）", unopenable);
    ok(JSON.stringify(keys("owner")) === '["overview","ops","bids","install"]', "老板：总览 / 运营 / 招投标 / 安装（与改动前相同，四格上限）", keys("owner"));
    ok(keys("no_position").includes("ai") === false && keys("project_member").includes("assistant"), "无岗位：没有「AI」；助手照常");
    ok(tabsOf("legacy_sales").layout === "sales" && tabsOf("legacy_boss").layout === "general", "旧模式：布局仍按平台角色 sales");
    ok(computeMobileTabs(clientCtx(IDENTITIES.super_admin)).tabs.length === 4, "平台 super_admin：通用布局取满四格");
  }

  // ── 站内链接目标与返回链（spec「站内链接与按钮只在目标放行时出现」）──
  {
    const c = (n: string) => clientCtx(IDENTITIES[n]);
    ok(blindsOrderBackHref(c("sales_rep"), "c1") === "/sales/customers/c1", "销售看工艺单：返回指向该单客户详情（列表不放行）");
    ok(blindsOrderBackHref(c("accounting"), "c1") === "/accounting", "会计看工艺单：列表与客户详情都不放行 → 返回指向 /accounting（落地页）");
    ok(blindsOrderBackHref(c("fulfillment_vinyl"), "c1") === "/blinds-orders" && blindsOrderBackHref(c("owner"), "c1") === "/blinds-orders", "列表放行（出单 / 老板）：返回列表");
    ok(blindsOrderBackHref(c("sales_rep"), null) === "/sales/home", "没有客户：退到落地页");
    ok(blindsOrderBackHref(null, "c1") === null, "输入未就绪：不渲染返回链接");
    const backTargets = NAMES.map((n) => blindsOrderBackHref(c(n), "c1")!).every((href, i) => canOpenHref(href, c(NAMES[i])));
    ok(backTargets, "每种身份：返回链接的目标都放行");
    ok(!canOpenHref("/install/repairs/r1", c("sales_rep")) && canOpenHref("/install/repairs/r1", c("ops_lead")), "收口页签维修单链接：销售不出现，运营主管出现");
    ok(!canOpenHref("/sales", c("ops_staff")) && !canOpenHref("/sales/quote-sheet", c("ops_staff")) && !canOpenHref("/sales/customers/c1", c("ops_staff")), "运营看工作台：不显示「打开销售工作区」「创建报价」与销售客户提醒链接");
    ok(canOpenHref("/sales", c("owner")) && canOpenHref("/sales/quote-sheet", c("sales_rep")), "老板 / 销售：工作台销售入口照常");
    ok(!canOpenHref("/assistant", c("sales_rep")) && canOpenHref("/assistant", c("ops_staff")), "/tasks「进入协同空间」：纯销售不出现，运营出现");
    const agentLink = (n: string) => canOpenHref("/workforce/j1", c(n)) && canOpenHref("/bids", c(n));
    ok(!agentLink("ops_staff") && !agentLink("accounting") && agentLink("bids") && agentLink("owner"), "投标分析卡片「查看执行详情」：运营 / 会计不出现，招投标 / 老板出现");

    const detail = read("src/app/(main)/blinds-orders/[id]/page.tsx");
    const edit = read("src/app/(main)/blinds-orders/[id]/edit/page.tsx");
    const wb = read("src/app/(main)/assistant/digital-employee-workbench.tsx");
    const tasks = read("src/app/(main)/tasks/tasks-classic.tsx");
    const card = read("src/components/tender-analysis/agent-card.tsx");
    ok(!/href="\/blinds-orders"|router\.push\("\/blinds-orders"\)/.test(detail) && /blindsOrderBackHref\(access\.ctx, order\.customerId\)/.test(detail) && /blindsOrderBackHref\(access\.ctx, order\?\.customerId\)/.test(detail), "工艺单详情：返回与删除后跳转走返回链");
    ok(/canOpen\(`\/install\/repairs\/\$\{task\.repair\.id\}`\) \?/.test(detail), "工艺单详情：维修单链接按 canOpen 渲染");
    ok(!/href="\/blinds-orders"/.test(edit) && /blindsOrderBackHref\(access\.ctx, null\)/.test(edit), "工艺单编辑页：返回走返回链");
    ok(/canOpen\("\/sales"\) \?/.test(wb) && /canOpen\("\/sales\/quote-sheet"\) \?/.test(wb) && /const linked = canOpen\(href\)/.test(wb), "数字员工工作台：三类销售入口按 canOpen");
    ok(/useNavigationAccess\(\)\.canOpen\("\/assistant"\)/.test(tasks) && /\{canOpenAssistant \? \(/.test(tasks), "/tasks：「进入协同空间」按 canOpen");
    ok(/canOpen\(`\/workforce\/\$\{job\.jobId\}`\) && canOpen\("\/bids"\)/.test(card), "投标分析卡片：「查看执行详情」按 canOpen（作业详情 + 招投标中心）");
    ok(
      !canOpenHref("/trade/quotes", c("legacy_sales")) && canOpenHref("/sales?view=customers&new=1", c("legacy_sales")) && canOpenHref("/sales/calendar?new=1", c("legacy_sales")),
      "旧模式销售（未启用窗饰）的新增面板：「外贸报价」不出现；新客户、新预约照常",
    );
    ok(["/sales?view=customers&new=1", "/sales?view=customers&followup=1", "/sales/quote-sheet", "/sales/calendar?new=1", "/sales/measure"].every((h) => canOpenHref(h, c("sales_rep"))), "Sunny 销售的新增面板：五个入口都放行");
    const sheet = read("src/components/sales-command-center/sales-mobile-create-sheet.tsx");
    ok(/useNavigationAccess\(\)/.test(sheet) && /\.filter\(\(item\) => canOpen\(item\.href\)\)/.test(sheet), "销售底栏「新增」面板：各入口按 canOpen");
  }

  // ── /help 功能地图与 72 条说明（spec「/help 功能地图从可见导航生成」）──
  {
    const all: NavigationItem[] = [];
    const walk = (items: NavigationItem[]) => items.forEach((i) => { all.push(i); if (i.children) walk(i.children); });
    walk([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS]);
    const bad = all.filter((i) => !i.description || i.description.trim().length === 0 || [...i.description].length > 40).map((i) => i.key);
    ok(all.length === 72 && bad.length === 0, `导航注册表与系统底栏共 72 项，每项说明非空且不超过 40 字（实际 ${all.length}${bad.length ? "；不合格 " + bad.join(",") : ""}）`);
    const flatKeys = (items: ResolvedNavItem[]): string[] => items.flatMap((i) => [i.key, ...(i.children ? flatKeys(i.children) : [])]);
    const mapKeys = (n: string) => buildHelpMap(clientCtx(IDENTITIES[n])).flatMap((g) => g.entries.map((e) => e.key));
    const sidebarKeys = (n: string) => flatKeys(resolveNavigationTree([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS], { ...clientCtx(IDENTITIES[n]), pathname: "/help" }));
    const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    ok(same(mapKeys("sales_rep"), sidebarKeys("sales_rep")), "销售：地图里的入口与侧栏可见入口完全相同", mapKeys("sales_rep"));
    ok(!mapKeys("sales_rep").some((k) => k.startsWith("ws-bids") || k.startsWith("growth-") || k.startsWith("biz-trade") || k === "nav-projects"), "销售：地图不含招投标、营销、外贸入口");
    ok(NAMES.every((n) => same(mapKeys(n), sidebarKeys(n))), "每种身份：地图 = 侧栏可见入口");
    const sales = buildHelpMap(clientCtx(IDENTITIES.sales_rep));
    ok(sales.every((g) => g.entries.every((e) => e.description.length > 0)) && sales[sales.length - 1].group === "SYSTEM", "地图按侧栏分组顺序列出，每项带说明（系统组在最后）");
    const help = read("src/app/(main)/help/page.tsx");
    ok(!/ROUTES|PROJECT_AUDIT/.test(help) && /buildHelpMap\(ctx\)/.test(help) && /loadPageNavigationContext\(\)/.test(help), "/help：删除静态 ROUTES 与 PROJECT_AUDIT 引用，地图按可见导航生成");
    ok(/组织与项目/.test(help) && /DEPLOY_VERCEL\.md/.test(help), "/help：其余段落不动");
  }

  // ── /operations 索引（spec「/operations 索引只列放行的卡片」）──
  {
    const titles = (n: string) => visibleOperationsCards(clientCtx(IDENTITIES[n])).map((c) => c.title);
    const OPS_STAFF = ["增长中心", "营销数字员工", "市场情报", "矩阵账号", "视频资产", "发布审核队列", "数据看板", "品牌记忆", "内容日历"];
    ok(JSON.stringify(titles("ops_staff")) === JSON.stringify(OPS_STAFF), "运营：9 张内容运营卡片，不含「投标业务档案」", titles("ops_staff"));
    ok(titles("super_admin").length === OPERATIONS_INDEX_CARDS.length && titles("super_admin").includes("投标业务档案"), "平台 super_admin：全部卡片");
    ok(titles("owner").length === OPERATIONS_INDEX_CARDS.length, "Sunny 老板：全部卡片（含投标业务档案）");
    ok(titles("installer").length === 0, "安装工：一张都不放行（页面显示空态；路由门本身也拦 /operations）");
    const unopenable = NAMES.flatMap((n) => visibleOperationsCards(clientCtx(IDENTITIES[n])).filter((c) => !canOpenHref(c.href, clientCtx(IDENTITIES[n]))).map((c) => `${n}:${c.href}`));
    ok(unopenable.length === 0, "每种身份：列出的卡片都放行");
    const ops = read("src/app/(main)/operations/page.tsx");
    ok(/visibleOperationsCards\(ctx\)/.test(ops) && /暂无可用的运营入口/.test(ops) && !/href="\/operations\/tender-profile"/.test(ops), "/operations：卡片按判定过滤，有空态，不再写死卡片");
    ok(!/市场情报、品牌记忆、内容日历和审核队列/.test(ops), "/operations：发布服务不可用的提示不再点名可能看不到的卡片");
  }

  // ── 纯模块：不导入 next/server ──
  {
    const PURE = [
      "src/lib/navigation/route-gate-core.ts",
      "src/lib/navigation/landing.ts",
      "src/lib/navigation/filter-context.ts",
      "src/lib/navigation/use-navigation-access.ts",
      "src/lib/navigation/mobile-tabs.ts",
      "src/lib/navigation/help-map.ts",
      "src/lib/navigation/operations-index.ts",
    ];
    const bad = PURE.filter((p) => /from "next\/server"|from "\.\/route-gate"|from "\.\/context-server"|@\/lib\/db/.test(read(p)));
    ok(bad.length === 0, `纯模块不导入 next/server / route-gate.ts / context-server / db${bad.length ? "（" + bad.join(",") + "）" : ""}`);
    const hook = read("src/lib/navigation/use-navigation-access.ts");
    ok(/buildNavigationFilterContext/.test(hook) && /inputsFromActiveOrgResponse/.test(hook) && /canOpenHref/.test(hook) && /resolveLandingPage/.test(hook), "钩子用共享拼装与判定函数");
    const cs = read("src/lib/navigation/context-server.ts");
    ok(/buildNavigationFilterContext\(org, \{ role: user\.role \}/.test(cs), "路由门 loader 用同一个拼装函数");
    const ao = read("src/app/api/auth/active-org/route.ts");
    ok(/activeOrgNavigationFields\(navInputs\)/.test(ao), "active-org 导航字段经 activeOrgNavigationFields 输出");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
