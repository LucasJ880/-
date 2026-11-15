/**
 * NAV-1b：侧栏「常用 + 更多」两段式布局（openspec change nav-1b-focused-sidebar-task-help；spec navigation/focused-sidebar）
 *
 *   判定真值表（岗位模式四个条件 / 旧模式平台角色）；常用段的内容与顺序；更多段按分组；
 *   两段互斥且合起来等于全量布局的可见入口；「更多」展开状态的取值；侧栏接线与分组小标题样式（源码断言）。
 *
 * 纯函数 + 源码断言，无 DB。
 * 运行：npx tsx src/lib/navigation/__tests__/trade-layout.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAVIGATION_REGISTRY, resolveNavigationTree, type ResolvedNavItem } from "../index";
import { FOCUSED_PRIMARY_KEYS, partitionFocusedNav, resolveMoreExpanded, usesFocusedLayout, type FocusedLayoutInput } from "../trade-layout";
import { gateCtx, IDENTITIES, type IdentityName } from "./identity-fixtures";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 900)}`}`);
  }
}

const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a: readonly string[]) => [...a].sort();

// ───────────────────────── 1. 判定真值表 ─────────────────────────
console.log("\n1. 两段式布局的判定");
{
  const MX = { enabled: ["trade", "product_content", "supply_chain", "sales", "marketing", "operations"] as never[] };
  const base: FocusedLayoutInput = { positionMode: true, platformRole: "user", modules: MX, permissionKeys: ["trade.read", "trade.manage"] };
  ok(usesFocusedLayout(base), "岗位模式：外贸模块已开 ∧ 持 trade.read ∧ 窗饰未开 ∧ 非 super_admin → 两段式");
  ok(usesFocusedLayout({ ...base, platformRole: "boss" }) && usesFocusedLayout({ ...base, platformRole: "trade" }) && usesFocusedLayout({ ...base, platformRole: "admin" }), "岗位模式：平台角色是 boss / trade / admin 都不影响结果");
  ok(!usesFocusedLayout({ ...base, modules: { enabled: ["sales", "operations"] as never[] } }), "岗位模式：未开外贸模块 → 全量");
  ok(!usesFocusedLayout({ ...base, permissionKeys: ["sales.quote.create"] }) && !usesFocusedLayout({ ...base, permissionKeys: [] }) && !usesFocusedLayout({ ...base, permissionKeys: null }), "岗位模式：不持 trade.read → 全量");
  ok(!usesFocusedLayout({ ...base, modules: { enabled: [...MX.enabled, "window_covering"] as never[] } }), "岗位模式：企业开了窗饰模块 → 全量");
  ok(!usesFocusedLayout({ ...base, platformRole: "super_admin" }), "岗位模式：平台 super_admin → 全量");
  ok(!usesFocusedLayout({ ...base, modules: null }) && !usesFocusedLayout({ ...base, modules: { enabled: [] } }), "岗位模式：企业未配置模块清单（视为全部已开，含窗饰）→ 全量");

  const legacy = (platformRole: string | null) => usesFocusedLayout({ positionMode: false, platformRole, modules: MX, permissionKeys: ["trade.read"] });
  ok(legacy("trade"), "旧模式：平台角色 trade → 两段式");
  ok(!legacy("boss") && !legacy("sales") && !legacy("user") && !legacy(null) && !usesFocusedLayout({}), "旧模式：boss / sales / user / 空值 → 全量（持 trade.read 也不算）");

  const two = (Object.keys(IDENTITIES) as IdentityName[]).filter((n) => usesFocusedLayout(gateCtx(n)));
  ok(same(sorted(two), ["mx_cathy", "mx_trade_rep"]), "仓库测试身份里只有梦馨「老板 + 外贸业务员」与纯外贸业务员是两段式；窗饰 12 种身份与 super_admin 都不是", two);
}

// ───────────────────────── 2. 常用与更多 ─────────────────────────
console.log("\n2. 常用段、更多段");
const tree = (name: IdentityName) => resolveNavigationTree(NAVIGATION_REGISTRY, { ...gateCtx(name), pathname: "/trade/inbox" });
const flatKeys = (items: readonly ResolvedNavItem[]): string[] => items.flatMap((i) => [i.key, ...(i.children ? flatKeys(i.children) : [])]);
{
  ok(
    same(FOCUSED_PRIMARY_KEYS, ["biz-revenue-today", "biz-inbox", "biz-prospects", "biz-trade-quotes", "biz-trade-samples", "biz-trade-products", "sales-crm", "mgmt-knowledge"]),
    "常用清单 8 项：今日询盘 → 询盘收件箱 → 线索资产 → 外贸报价 → 寄样 → 货号 → 客户与商机 → 知识库",
  );

  const cathyTree = tree("mx_cathy");
  const cathy = partitionFocusedNav(cathyTree);
  ok(same(cathy.primary.map((i) => i.key), FOCUSED_PRIMARY_KEYS), "老板 + 外贸业务员：常用段 8 项，顺序与清单相同", cathy.primary.map((i) => i.key));
  ok(
    same(cathy.primary.map((i) => i.label), ["今日询盘", "询盘收件箱", "线索资产", "外贸报价", "寄样", "货号", "客户与商机", "知识库"]),
    "老板 + 外贸业务员：常用段的名称",
    cathy.primary.map((i) => i.label),
  );
  ok(
    same(cathy.moreGroups.map((g) => `${g.label}×${g.items.length}`), ["工作区×9", "管理入口×1", "AI 工作中心×1", "业务运营×11", "供应商×1", "品牌增长×5", "系统管理×2"]),
    "老板 + 外贸业务员：更多段 30 个一级入口，按 工作区 / 管理入口 / AI 工作中心 / 业务运营 / 供应商 / 品牌增长 / 系统管理 分成 7 组",
    cathy.moreGroups.map((g) => `${g.label}×${g.items.length}`),
  );
  const inOrder = cathy.moreGroups.every((g) => same(g.items.map((i) => i.key), cathyTree.filter((i) => i.group === g.group && !FOCUSED_PRIMARY_KEYS.includes(i.key)).map((i) => i.key)));
  ok(inOrder, "更多段：组内顺序与全量布局相同");
  ok(cathy.moreGroups.some((g) => g.items.some((i) => i.key === "capabilities" && (i.children?.length ?? 0) > 0)), "更多段：带子项的入口（AI 工作中心）连同子项一起保留");

  const repTree = tree("mx_trade_rep");
  const rep = partitionFocusedNav(repTree);
  ok(same(rep.primary.map((i) => i.key), FOCUSED_PRIMARY_KEYS.filter((k) => k !== "sales-crm")), "纯外贸业务员：常用段是 8 项去掉「客户与商机」，不补位", rep.primary.map((i) => i.key));
  const repMore = rep.moreGroups.flatMap((g) => g.items.map((i) => i.key));
  ok(repMore.includes("biz-trade-chat") && repMore.includes("biz-trade"), "纯外贸业务员：「外贸 AI 对话」「外贸获客」在更多里");

  for (const [name, t, p] of [["mx_cathy", cathyTree, cathy], ["mx_trade_rep", repTree, rep]] as const) {
    const primaryKeys = flatKeys(p.primary);
    const moreKeys = p.moreGroups.flatMap((g) => flatKeys(g.items));
    const dup = primaryKeys.filter((k) => moreKeys.includes(k));
    ok(dup.length === 0 && same(sorted([...primaryKeys, ...moreKeys]), sorted(flatKeys(t))), `${name}：常用 ∪ 更多 = 全量布局的可见入口（含子项，共 ${flatKeys(t).length} 个），两段不重复`, dup);
  }
  ok(partitionFocusedNav([]).primary.length === 0 && partitionFocusedNav([]).moreGroups.length === 0, "空输入：两段都为空");
}

// ───────────────────────── 3. 更多的展开状态 ─────────────────────────
console.log("\n3. 「更多」展开状态的取值");
{
  const r = resolveMoreExpanded;
  ok(!r({ remembered: false, activeInMore: false, manualOnThisPage: null }), "没点过、没记住、当前页面不在更多里 → 折叠（默认）");
  ok(r({ remembered: true, activeInMore: false, manualOnThisPage: null }), "记住的状态是展开 → 展开");
  ok(r({ remembered: false, activeInMore: true, manualOnThisPage: null }), "当前页面在更多里 → 自动展开（不看记住的状态）");
  ok(!r({ remembered: false, activeInMore: true, manualOnThisPage: false }) && !r({ remembered: true, activeInMore: true, manualOnThisPage: false }), "本页手动收起 → 折叠，即使当前页面在更多里");
  ok(r({ remembered: false, activeInMore: false, manualOnThisPage: true }), "本页手动展开 → 展开");
}

// ───────────────────────── 4. 侧栏接线 ─────────────────────────
console.log("\n4. 侧栏接线与分组小标题");
{
  const sidebar = read("src/components/sidebar.tsx");
  ok(/usesFocusedLayout\(filterCtx\)/.test(sidebar) && /partitionFocusedNav\(resolved\)/.test(sidebar), "侧栏：用判定输入调两段式判定与分区函数");
  ok(!/effectiveRole/.test(sidebar) && !/usesTradeLayout/.test(sidebar), "侧栏：不再读岗位派生的平台角色");
  ok(/resolveMoreExpanded\(/.test(sidebar) && /qingyan-sidebar-trade-more/.test(sidebar), "侧栏：「更多」的展开状态经取值函数得出，记住的状态沿用原存储键");
  ok(!/key: "trade-more"/.test(sidebar), "侧栏：「更多」不再是一个带子项的合成入口");
  const heading = sidebar.match(/const GROUP_HEADING_CLASS =\s*"([^"]+)"/)?.[1] ?? "";
  ok(/\btext-xs\b/.test(heading) && /\btext-sidebar-muted\b/.test(heading), "分组小标题：12px 字号 + 侧栏弱化色", heading);
  ok(!/text-\[10px\][^"]*text-white\/(30|25)/.test(sidebar), "分组小标题：不再是 10px 与 30% / 25% 透明度");
}

console.log(`\ntrade-layout: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
