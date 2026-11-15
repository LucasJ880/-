/**
 * NAV-1a：一个入口一个名字（openspec change nav-1a-single-name；spec navigation/entry-naming）
 *
 * 四组断言：
 *   1. 名称一致——注册表名称 = 中文翻译、英文非空；中英文定名表；旧名字不再是任何入口的名称
 *   2. 三处共用——侧栏、手机抽屉、/help 都经同一个取名函数
 *   3. 大标题——三种身份可见入口的页面大标题 = 入口名称，或登记在例外清单
 *   4. 站内文字——指向改名入口或页面的链接、按钮、提示语用新名称；已存数据里的名称不动
 *
 * 纯函数 + 源码断言，无 DB。
 * 运行：npx tsx src/lib/navigation/__tests__/entry-naming.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NAVIGATION_REGISTRY, SYSTEM_NAV_ITEMS, resolveNavigationTree, type NavigationItem, type ResolvedNavItem } from "../index";
import { navEntryLabel } from "../entry-label";
import { buildHelpMap } from "../help-map";
import { gateCtx, type IdentityName } from "./identity-fixtures";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { OPPORTUNITY_SOURCE_LABELS } from "@/lib/revenue-spine/source-labels";

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
/** 文件不存在按空内容处理：断言照常失败并指到具体位置，而不是整份测试崩掉 */
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const ALL: NavigationItem[] = [];
{
  const walk = (items: NavigationItem[]) => items.forEach((i) => { ALL.push(i); if (i.children) walk(i.children); });
  walk([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS]);
}
const byKey = new Map(ALL.map((i) => [i.key, i]));
const zhName = (key: string) => navEntryLabel(byKey.get(key)!, zh);
const enName = (key: string) => navEntryLabel(byKey.get(key)!, en);

// ───────────────────────── 1. 名称一致 ─────────────────────────
console.log("\n1. 名称一致");

/** 中文定名（任务书定名表；spec「入口定名」） */
const ZH_NAMES: Record<string, string> = {
  "work-calendar": "预约日历",
  "work-inbox": "微信客服",
  "biz-trade": "外贸获客",
  "biz-trade-intel": "竞品溯源",
  "biz-quotes": "报价",
  "biz-all-quotes": "报价记录",
  "biz-cockpit": "团队销售分析",
  "nav-projects": "项目列表",
  "nav-project-intel": "智能调查室",
  "nav-suppliers": "供应商库",
  "mgmt-orgs": "成员与组织",
  "mgmt-memory": "组织记忆",
  "mgmt-wechat": "微信集成",
  "mgmt-settings": "企业设置",
  "plat-invites": "邀请码",
  "plat-audit": "平台审计",
  "autopilot-overview": "总览",
  "autopilot-runs": "Runs",
  "autopilot-evaluations": "Evaluations",
  "autopilot-telemetry": "Telemetry",
};
/** 英文定名（spec「改名入口的英文名称」） */
const EN_NAMES: Record<string, string> = {
  "work-inbox": "WeChat Service",
  "biz-trade": "Buyer Prospecting",
  "biz-trade-intel": "Competitor Tracing",
  "biz-quotes": "Quotes",
  "biz-all-quotes": "Quote Records",
  "biz-cockpit": "Team Sales Analytics",
  "nav-projects": "Project List",
  "nav-project-intel": "Intelligence Room",
  "nav-suppliers": "Supplier Directory",
  "mgmt-orgs": "Members & Organization",
  "mgmt-memory": "Organization Memory",
  "mgmt-wechat": "WeChat Integration",
  "mgmt-settings": "Organization Settings",
  "plat-audit": "Platform Audit",
  "autopilot-overview": "Overview",
  "autopilot-runs": "Runs",
  "autopilot-evaluations": "Evaluations",
  "autopilot-telemetry": "Telemetry",
};
const EN_UNCHANGED: Record<string, string> = { "work-calendar": "Appointments", "plat-invites": "Invite Codes" };
/** 改名前出现在侧栏或使用说明里的 20 个旧名称（整名相等才算） */
const OLD_NAMES = [
  "海外业务", "企业情报", "收件箱", "日历", "电子报价单", "全部报价", "销售分析", "项目", "项目智能", "供应商",
  "组织", "组织知识", "微信消息", "设置", "邀请码管理", "审计日志", "Autopilot 总览", "Autopilot Runs", "Autopilot Evaluations", "Telemetry Health",
];

{
  const withKey = ALL.filter((i) => i.labelKey);
  const zhTable = zh as unknown as Record<string, string | undefined>;
  const enTable = en as unknown as Record<string, string | undefined>;
  const zhBad = withKey.filter((i) => zhTable[i.labelKey!] !== i.label).map((i) => `${i.key}：注册表「${i.label}」≠ 中文表「${zhTable[i.labelKey!] ?? "（缺）"}」`);
  const enBad = withKey.filter((i) => !enTable[i.labelKey!] || enTable[i.labelKey!]!.trim().length === 0).map((i) => i.key);
  ok(ALL.length === 72 && withKey.length === 62, `注册表与系统底栏共 72 项，其中 62 项带翻译键（实际 ${ALL.length} / ${withKey.length}）`);
  ok(zhBad.length === 0, `带翻译键的入口：中文翻译与注册表名称逐项相等（不一致 ${zhBad.length} 项）`, zhBad);
  ok(enBad.length === 0, "带翻译键的入口：英文翻译存在且非空", enBad);

  const noKey = ALL.filter((i) => !i.labelKey);
  ok(noKey.every((i) => navEntryLabel(i, zh) === i.label && navEntryLabel(i, en) === i.label), "没有翻译键的入口：任何界面语言下都显示注册表名称");
  ok(navEntryLabel({ label: "甲", labelKey: "no_such_key" }, zh) === "甲" && navEntryLabel({ label: "甲", labelKey: "nav_help" }, { nav_help: "  " }) === "甲", "取名函数：翻译表里没有该键或值为空白时回退注册表名称");

  const zhWrong = Object.entries(ZH_NAMES).filter(([k, v]) => !byKey.has(k) || zhName(k) !== v).map(([k, v]) => `${k} 应为「${v}」实际「${byKey.has(k) ? zhName(k) : "（无此入口）"}」`);
  ok(Object.keys(ZH_NAMES).length === 20 && zhWrong.length === 0, "中文定名表 20 项逐项成立", zhWrong);
  const enWrong = Object.entries({ ...EN_NAMES, ...EN_UNCHANGED }).filter(([k, v]) => !byKey.has(k) || enName(k) !== v).map(([k, v]) => `${k} 应为 ${v} 实际 ${byKey.has(k) ? enName(k) : "（无此入口）"}`);
  ok(Object.keys(EN_NAMES).length === 18 && enWrong.length === 0, "英文定名表 18 项逐项成立，Appointments / Invite Codes 不变", enWrong);

  const allZh = new Set(ALL.map((i) => navEntryLabel(i, zh)));
  const stillOld = OLD_NAMES.filter((n) => allZh.has(n));
  ok(OLD_NAMES.length === 20 && stillOld.length === 0, "20 个旧名称不再是任何入口的名称", stillOld);
  const enOld = ["Inbox", "Global Business", "Company Intelligence"].filter((n) => ALL.some((i) => navEntryLabel(i, en) === n));
  ok(enOld.length === 0, "英文界面不再显示 Inbox / Global Business / Company Intelligence", enOld);
}

// ───────────────────────── 2. 三处共用 ─────────────────────────
console.log("\n2. 三处共用同一个取名函数");

const flat = (items: ResolvedNavItem[]): ResolvedNavItem[] => items.flatMap((i) => [i, ...(i.children ? flat(i.children) : [])]);
const sidebarItems = (name: IdentityName) => flat(resolveNavigationTree([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS], { ...gateCtx(name), pathname: "/help" }));

{
  const sidebar = read("src/components/sidebar.tsx");
  ok(/from "@\/lib\/navigation\/entry-label"/.test(sidebar) && /navEntryLabel\(/.test(sidebar) && !/function itemLabel\b/.test(sidebar), "桌面侧栏：调取名函数，不再有自己的 itemLabel");
  const drawer = read("src/components/mobile-nav-drawer.tsx");
  ok(/from "@\/lib\/navigation\/entry-label"/.test(drawer) && /navEntryLabel\(/.test(drawer) && !/item\.labelKey\s*&&/.test(drawer), "手机导航抽屉：调取名函数，不再内联拼名称");
  const helpPage = read("src/app/(main)/help/page.tsx");
  const helpName = read("src/app/(main)/help/entry-name.tsx");
  // 入口的 label 只能作为名称组件的入参出现，不能直接渲染（NAV-1b 起页面有两处：「我想做什么」的「点哪里」、「全部入口」）
  const labelUses = (helpPage.match(/\.label\b(?!Key)/g) ?? []).length;
  const labelProps = (helpPage.match(/<HelpEntryName label=\{[\w.]+\.label\}/g) ?? []).length;
  ok(labelProps >= 1 && labelUses - labelProps === (helpPage.match(/g\.label\b/g) ?? []).length, "/help 页面：每一处入口名称都交给名称组件，不直接渲染入口的 label", { labelUses, labelProps });
  ok(/^"use client";/.test(helpName) && /useLocale\(\)/.test(helpName) && /navEntryLabel\(/.test(helpName), "/help 名称组件：客户端组件，按当前界面语言调取名函数");

  for (const name of ["mx_cathy", "mx_trade_rep", "sales_rep", "owner", "super_admin"] as const) {
    const side = new Map(sidebarItems(name).map((i) => [i.key, i]));
    const map = buildHelpMap(gateCtx(name)).flatMap((g) => g.entries);
    const diff = map.filter((e) => !side.has(e.key) || navEntryLabel(e, zh) !== navEntryLabel(side.get(e.key)!, zh) || navEntryLabel(e, en) !== navEntryLabel(side.get(e.key)!, en)).map((e) => e.key);
    ok(map.length === side.size && diff.length === 0, `${name}：/help 每个入口的名称与侧栏相同（中文、英文各比一遍，共 ${map.length} 项）`, diff);
  }

  const lynn = new Set(sidebarItems("sales_rep").map((i) => navEntryLabel(i, zh)));
  ok(lynn.has("报价") && lynn.has("报价记录") && !lynn.has("电子报价单") && !lynn.has("全部报价"), "Sunny 销售：侧栏显示「报价」「报价记录」，不显示「电子报价单」「全部报价」", [...lynn]);
  const cathy = new Set(sidebarItems("mx_cathy").map((i) => navEntryLabel(i, zh)));
  const cathyNeed = ["外贸获客", "竞品溯源", "微信客服", "预约日历", "供应商库", "成员与组织", "企业设置"];
  ok(cathyNeed.every((n) => cathy.has(n)) && !["海外业务", "企业情报", "收件箱"].some((n) => cathy.has(n)), "梦馨老板 + 外贸业务员：侧栏显示新名称，不显示「海外业务」「企业情报」「收件箱」", cathyNeed.filter((n) => !cathy.has(n)));
}

// ───────────────────────── 3. 大标题 ─────────────────────────
console.log("\n3. 页面大标题 = 入口名称");

/** 入口 key → 大标题所在源文件（页面或其外壳组件）。标题期望值一律取入口的中文名称。 */
const TITLE_SOURCES: Record<string, string> = {
  // 任务书列出的页面
  "biz-trade": "src/app/(main)/trade/page.tsx",
  "biz-trade-intel": "src/app/(main)/trade/intelligence/page.tsx",
  "biz-fulfillment": "src/app/(main)/trade/fulfillment/page.tsx",
  "biz-signals": "src/app/(main)/trade/signals/page.tsx",
  "biz-prospects": "src/app/(main)/trade/prospects/page.tsx",
  "biz-trade-import": "src/app/(main)/trade/import/page.tsx",
  "mgmt-knowledge": "src/app/(main)/knowledge/page.tsx",
  "work-notifications": "src/app/(main)/notifications/page.tsx",
  "work-inbox": "src/app/(main)/service-inbox/page.tsx",
  // 逐页核对多出来的
  "ws-ops": "src/components/ops/ops-workspace-shell.tsx",
  "nav-suppliers": "src/app/(main)/suppliers/page.tsx",
  "mgmt-orgs": "src/app/(main)/organizations/page.tsx",
  "mgmt-settings": "src/app/(main)/settings/page.tsx",
  "growth-hub": "src/app/(main)/operations/growth/page.tsx",
  "growth-content": "src/app/(main)/operations/page.tsx",
  "sys-help": "src/app/(main)/help/page.tsx",
  "biz-all-quotes": "src/app/(main)/sales/quotes/page.tsx",
  "biz-quotes": "src/app/(main)/sales/quote-sheet/page.tsx",
  // 改动前已一致的
  "sales-crm": "src/app/(main)/sales/page.tsx",
  "ops-center": "src/app/(main)/operations/center/page.tsx",
  "cap-catalog": "src/app/(main)/capabilities/catalog/page.tsx",
  "cap-approvals": "src/app/(main)/capabilities/approvals/page.tsx",
  "cap-governance": "src/app/(main)/capabilities/governance/page.tsx",
  "cap-health": "src/app/(main)/capabilities/config-health/page.tsx",
  "ws-ops-projects": "src/components/ops/delivery-projects-list.tsx",
  "sales-performance": "src/app/(main)/sales/performance/page.tsx",
  "sales-email-settings": "src/app/(main)/settings/email/page.tsx",
  "work-tasks": "src/components/tasks/work-queue.tsx",
  "biz-inbox": "src/app/(main)/trade/inbox/page.tsx",
  "biz-trade-quotes": "src/app/(main)/trade/quotes/page.tsx",
  "biz-trade-samples": "src/app/(main)/trade/samples/page.tsx",
  "biz-trade-products": "src/app/(main)/trade/products/page.tsx",
  "biz-channels": "src/app/(main)/trade/channels/page.tsx",
  "biz-revenue": "src/app/(main)/revenue/page.tsx",
  "biz-revenue-today": "src/app/(main)/revenue/today/page.tsx",
  "growth-product-content": "src/app/(main)/product-content/page.tsx",
  "work-calendar": "src/app/(main)/sales/calendar/page.tsx",
  "work-ai-jobs": "src/app/(main)/workforce/page.tsx",
};
/** 例外：入口 key → 为什么不对齐（design D6；spec「三种身份可见入口的大标题全覆盖」） */
const TITLE_EXCEPTIONS: Record<string, string> = {
  capabilities: "/capabilities：与子项「中台总览」指向同一页",
  "cap-overview": "/capabilities：与父项「AI 工作中心」指向同一页",
  "growth-intel": "/operations/intelligence：入口名与页面功能不符，另行决定",
  "growth-reports": "/reports：入口名与页面功能不符，另行决定",
  "work-home": "/：页面没有大标题",
  "sales-home": "/sales/home：大标题是问候语",
  "work-assistant": "/assistant：对话界面，没有大标题",
  "biz-trade-chat": "/trade/chat：对话界面，没有大标题",
};
/** 改动前的大标题，不得再作为大标题出现 */
const OLD_TITLES = ["履约控制台", "页面监控信号", "外贸全部线索", "展会/名片导入", "组织知识库", "通知中心", "客服收件箱", "今日运营工作台", "增长中心 Growth Center", "内容运营", "使用说明 · 功能地图", "全部报价", "电子报价单"];

/**
 * 源码里有一个大标题等于 title：
 *   - <h1> 的文字；
 *   - <PageHeader> 的 title 属性（取该标签里的第一个 title=，前面可以有 breadcrumbs 等属性）；
 *   - 新建 / 编辑两态的标题（报价页）：title={ 编辑中 ? `编辑…` : "新建态标题" }，只认冒号后的新建态。
 */
function hasHeading(src: string, title: string): boolean {
  const t = esc(title);
  if (new RegExp(`<h1\\b[^>]*>\\s*${t}\\s*</h1>`).test(src)) return true;
  for (let i = src.indexOf("<PageHeader"); i >= 0; i = src.indexOf("<PageHeader", i + 1)) {
    const tag = src.slice(i, i + 600);
    const at = tag.search(/\btitle=/);
    if (at < 0) continue;
    const rest = tag.slice(at + "title=".length);
    if (rest.startsWith(`"${title}"`)) return true;
    if (rest.startsWith("{") && new RegExp(`^\\{[\\s\\S]{0,240}?:\\s*"${t}"\\s*\\}`).test(rest)) return true;
  }
  return false;
}

{
  const wrong: string[] = [];
  const leftover: string[] = [];
  for (const [key, file] of Object.entries(TITLE_SOURCES)) {
    const src = read(file);
    if (!byKey.has(key) || !hasHeading(src, zhName(key))) wrong.push(`${key}（${file}）应为「${byKey.has(key) ? zhName(key) : "?"}」`);
    for (const old of OLD_TITLES) if (hasHeading(src, old)) leftover.push(`${file} 仍有大标题「${old}」`);
  }
  ok(Object.keys(TITLE_SOURCES).length === 38 && wrong.length === 0, `核对表 38 个入口：页面大标题等于入口的中文名称（不符 ${wrong.length} 个）`, wrong);
  ok(leftover.length === 0, "核对表里的页面不再有改动前的大标题", leftover);

  const quoteSheet = read("src/app/(main)/sales/quote-sheet/page.tsx");
  ok(/`编辑报价单\$\{editingQuoteVersion \? ` · v\$\{editingQuoteVersion\}` : ""\}`/.test(quoteSheet), "报价页：编辑已保存的报价单时大标题仍为「编辑报价单」加版本号");

  const uncovered: string[] = [];
  const both: string[] = [];
  const seen = new Set<string>();
  for (const name of ["mx_cathy", "mx_trade_rep", "sales_rep"] as const) {
    for (const item of sidebarItems(name)) {
      seen.add(item.key);
      const inTable = item.key in TITLE_SOURCES;
      const inExc = item.key in TITLE_EXCEPTIONS;
      if (!inTable && !inExc) uncovered.push(`${name}:${item.key}`);
      if (inTable && inExc) both.push(item.key);
    }
  }
  ok(seen.size === 46 && uncovered.length === 0 && both.length === 0, `三种身份可见的 ${seen.size} 个入口：每个都在核对表或例外清单里，且不重复登记`, { uncovered, both });
  const stale = [...Object.keys(TITLE_SOURCES), ...Object.keys(TITLE_EXCEPTIONS)].filter((k) => !seen.has(k));
  ok(stale.length === 0, "核对表与例外清单里没有这三种身份看不到的入口（不留过期登记）", stale);
  const excPages = new Set(Object.values(TITLE_EXCEPTIONS).map((r) => r.split("：")[0]));
  ok(
    Object.keys(TITLE_EXCEPTIONS).length === 8 && excPages.size === 7 && ["/capabilities", "/operations/intelligence", "/reports", "/", "/sales/home", "/assistant", "/trade/chat"].every((p) => excPages.has(p)),
    "例外清单恰为 7 个页面（8 个入口）",
    [...excPages],
  );
}

// ───────────────────────── 4. 站内文字 ─────────────────────────
console.log("\n4. 站内指向改名入口或页面的界面文字");

/** design D9：文件 → 必须出现的新文字 / 不得再出现的旧文字 */
const COPY: Array<{ file: string; has: string[]; not: string[] }> = [
  { file: "src/components/dashboard/management-dashboard-client.tsx", has: ["进入外贸获客"], not: ["进入海外业务"] },
  { file: "src/app/(main)/trade/page.tsx", has: ["再使用外贸获客。", "市场监测"], not: ["再使用海外业务", "页面监控信号"] },
  { file: "src/components/sales/pending-deposit-banner.tsx", has: ["报价记录"], not: ["全部报价"] },
  { file: "src/app/(main)/sales/quote-sheet/rough-quote-panel.tsx", has: ["保存后进入「报价记录」", "报价记录\n"], not: ["全部报价"] },
  { file: "src/app/(main)/sales/quote-sheet/page.tsx", has: ["保存后可在「报价记录」查看"], not: ["全部报价"] },
  { file: "src/app/(main)/settings/notifications/page.tsx", has: ["前往待处理事项"], not: ["前往通知中心"] },
  { file: "src/app/(main)/operations/center/page.tsx", has: ["微信客服与发布运营"], not: ["客服收件箱"] },
  ...["metrics", "brand", "mmm", "audit", "experiments", "campaigns", "automations"].map((p) => ({
    file: `src/app/(main)/operations/growth/${p}/page.tsx`,
    has: ["返回品牌增长"],
    not: ["返回增长中心"],
  })),
  { file: "src/app/(main)/marketing/employee/page.tsx", has: ["← 品牌增长"], not: ["← 增长中心"] },
  { file: "src/components/market-intelligence/monitoring-workspace.tsx", has: ["送内容生产", "未送内容生产"], not: ["内容运营"] },
];

{
  const bad: string[] = [];
  for (const row of COPY) {
    const src = read(row.file);
    for (const h of row.has) if (!src.includes(h)) bad.push(`${row.file} 缺「${h.trim()}」`);
    for (const n of row.not) if (src.includes(n)) bad.push(`${row.file} 仍有「${n}」`);
  }
  ok(COPY.length === 16 && bad.length === 0, `站内文字 ${COPY.length} 个文件逐处成立（不符 ${bad.length} 处）`, bad);
  ok(zh.header_notif_title === "待处理事项" && zh.header_notif_title === zhName("work-notifications"), "铃铛下拉标题（中文）与入口同名：待处理事项", zh.header_notif_title);
  ok(OPPORTUNITY_SOURCE_LABELS.trade_intelligence === "竞品溯源" && OPPORTUNITY_SOURCE_LABELS.trade_intelligence === zhName("biz-trade-intel"), "线索来源标签：竞品溯源", OPPORTUNITY_SOURCE_LABELS.trade_intelligence);
  ok(/const INTELLIGENCE_CAMPAIGN_NAME = "企业情报";/.test(read("src/lib/trade/intelligence-service.ts")), "已存数据里的名称不动：竞品溯源转入线索的活动名称仍是「企业情报」");
  const smoke = read("scripts/nav-visual-smoke.mjs");
  ok(!smoke.includes("海外业务") && smoke.includes("外贸获客"), "导航冒烟脚本按新名称找侧栏文字");
}

console.log(`\nentry-naming: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
