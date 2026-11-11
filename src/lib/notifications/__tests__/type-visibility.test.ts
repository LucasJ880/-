/**
 * VIS-1c 通知类型按处理页面判定可见（spec notifications/type-visibility；change vis-1c-notify-settings-search）
 * 运行：npx tsx src/lib/notifications/__tests__/type-visibility.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOTIFICATION_TYPE_KEYS } from "../constants";
import {
  HIDDEN_NOTIFICATION_TYPES,
  NOTIFICATION_FILTER_OPTIONS,
  NOTIFICATION_TYPE_ENTRIES,
  toggleEnabledType,
  visibleNotificationFilters,
  visibleNotificationTypes,
} from "../type-visibility";
import { canOpenHref } from "@/lib/navigation/landing";
import { matchRouteGateEntry } from "@/lib/navigation/route-gate-core";
import { gateCtx, type IdentityName } from "@/lib/navigation/__tests__/identity-fixtures";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const RFQ = ["rfq_quote_received", "rfq_reply_received", "rfq_chase_ready", "rfq_no_response"];
const INSTALL = NOTIFICATION_TYPE_KEYS.filter((k) => k.startsWith("install_"));
const visibleFor = (name: IdentityName) => visibleNotificationTypes((href) => canOpenHref(href, gateCtx(name)));
const hiddenFor = (name: IdentityName) => {
  const vis = new Set(visibleFor(name));
  return NOTIFICATION_TYPE_KEYS.filter((k) => !HIDDEN_NOTIFICATION_TYPES.has(k) && !vis.has(k));
};
const filtersFor = (name: IdentityName) => visibleNotificationFilters((href) => canOpenHref(href, gateCtx(name))).map((o) => o.label);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

console.log("type-visibility（通知类型按处理页面判定可见）");

console.log("\n对照表");
{
  const listed = NOTIFICATION_TYPE_KEYS.filter((k) => !HIDDEN_NOTIFICATION_TYPES.has(k));
  const missing = listed.filter((k) => !(NOTIFICATION_TYPE_ENTRIES[k]?.length));
  ok(missing.length === 0, "每个非隐藏的已登记类型都有处理页面", missing);
  const pages = [...new Set([...Object.values(NOTIFICATION_TYPE_ENTRIES).flat(), ...NOTIFICATION_FILTER_OPTIONS.flatMap((o) => o.entries)])];
  const ungated = pages.filter((p) => !matchRouteGateEntry(p));
  ok(ungated.length === 0, "处理页面都命中路由门门表", ungated);
  const extra = Object.keys(NOTIFICATION_TYPE_ENTRIES).filter((k) => !(NOTIFICATION_TYPE_KEYS as readonly string[]).includes(k));
  ok(extra.length === 0, "对照表没有未登记的类型", extra);
  ok(
    [...HIDDEN_NOTIFICATION_TYPES].every((k) => !visibleFor("super_admin").includes(k)),
    "三个隐藏类型对谁都不列（含 super_admin）",
  );
}

console.log("\n按身份的可见类型（design D1 身份表）");
{
  const expectHidden: Record<string, string[]> = {
    sales_rep: [...RFQ],
    pricing_lead: [...RFQ],
    sales_rep_project_member: [...RFQ],
    bids: ["quote_signed", "sales_daily_briefing", "order_stage"],
    ops_lead: [...RFQ, "quote_signed", "sales_daily_briefing"],
    accounting: [...RFQ, "quote_signed", "sales_daily_briefing"],
    fulfillment_vinyl: [...RFQ, "quote_signed", "sales_daily_briefing"],
    fulfillment_shades: [...RFQ, "quote_signed", "sales_daily_briefing"],
    ops_staff: [...RFQ, ...INSTALL, "quote_signed", "sales_daily_briefing", "order_stage"],
    installer: [...RFQ, "project_update", "agent_task", "quote_signed", "sales_daily_briefing", "order_stage"],
    no_position: [...RFQ, ...INSTALL, "project_update", "agent_task", "quote_signed", "sales_daily_briefing", "order_stage"],
    mx_trade_rep: [...RFQ, ...INSTALL, "project_update", "agent_task", "quote_signed", "sales_daily_briefing", "order_stage"],
    mx_cathy: [...RFQ, ...INSTALL, "quote_signed", "order_stage"],
    owner: [],
    super_admin: [],
  };
  for (const [name, hidden] of Object.entries(expectHidden)) {
    const got = hiddenFor(name as IdentityName);
    ok(sameSet(got, hidden), `${name}：看不到的类型与身份表一致`, got);
  }
}

console.log("\n规格场景");
{
  const sales = visibleFor("sales_rep");
  ok(RFQ.every((k) => !sales.includes(k)), "销售：不含任何 rfq_*");
  ok(
    ["task_due", "followup", "quote_signed", "agent_task", "agent_approval", "project_update", "install_repair_submitted"].every((k) => sales.includes(k)),
    "销售：含 task_due、followup、quote_signed、agent_task、agent_approval、project_update、install_repair_submitted",
    sales,
  );
  ok(RFQ.every((k) => visibleFor("bids").includes(k)), "询价通知：只持 bids 时含全部 rfq_*");
  for (const name of ["ops_staff", "accounting", "fulfillment_vinyl"] as const) {
    ok(RFQ.every((k) => !visibleFor(name).includes(k)), `询价通知：只持 ${name} 时不含 rfq_*`);
  }
  ok(
    (["bids", "ops_staff", "accounting", "fulfillment_vinyl"] as const).every((n) => visibleFor(n).includes("project_update")),
    "四者都含 project_update",
  );
  const inst = visibleFor("installer");
  ok(
    ["project_update", "agent_task", "quote_signed", ...RFQ].every((k) => !inst.includes(k)) &&
      inst.includes("install_repair_scheduled") &&
      inst.includes("agent_approval"),
    "安装工：不含 rfq_*、project_update、agent_task、quote_signed；含 install_repair_scheduled、agent_approval",
    inst,
  );
}

console.log("\n通知页类型筛选");
{
  const sales = filtersFor("sales_rep");
  ok(sales[0] === "全部类型", "首项恒为「全部类型」");
  ok(
    !sales.includes("项目分发") && ["任务截止", "项目更新", "报价让利审核"].every((l) => sales.includes(l)),
    "销售：没有「项目分发」，有「全部类型」「任务截止」「项目更新」「报价让利审核」",
    sales,
  );
  const inst = filtersFor("installer");
  ok(
    ["项目分发", "项目更新", "报价让利审核"].every((l) => !inst.includes(l)),
    "安装工：没有「项目分发」「项目更新」「报价让利审核」",
    inst,
  );
  ok(filtersFor("owner").length === NOTIFICATION_FILTER_OPTIONS.length + 1, "老板：筛选项全部可见");
  const none = visibleNotificationFilters(() => false).map((o) => o.label);
  ok(sameSet(none, ["全部类型"]), "全部不放行时只剩「全部类型」");
}

console.log("\n隐藏类型不改偏好");
{
  // 只持 sales_rep、已开启 rfq_quote_received 的用户在设置页关掉「任务截止与逾期」
  const stored = ["task_due", "rfq_quote_received", "followup"];
  ok(!visibleFor("sales_rep").includes("rfq_quote_received"), "前提：rfq_quote_received 不在销售的开关列表里");
  const next = toggleEnabledType(stored, "task_due");
  ok(next !== null && next.includes("rfq_quote_received") && !next.includes("task_due"), "保存不动隐藏类型：仍有 rfq_quote_received，没有 task_due", next);
  ok(JSON.stringify(toggleEnabledType(["followup"], "task_due")) === JSON.stringify(["followup", "task_due"]), "打开一个类型：追加");
  ok(toggleEnabledType(["task_due"], "task_due") === null, "关掉最后一个开启的类型：不提交（与改动前相同）");
}

console.log("\n两处接线（源码断言）");
{
  const list = read("src/components/notification/notification-type-toggle-list.tsx");
  ok(/visibleNotificationTypes\(canOpen\)/.test(list), "设置页开关列表按 visibleNotificationTypes 过滤");
  ok(/toggleEnabledType\(enabledTypes, key\)/.test(list), "开关增删走 toggleEnabledType（作用在完整 enabledTypes 上）");
  ok(/if \(!ready\)/.test(list) && !/NOTIFICATION_TYPE_KEYS/.test(list), "判定输入未就绪不列类型；不再直接遍历全量类型");
  ok(/if \(!ready && failed\)/.test(list) && /onClick=\{retry\}/.test(list) && /通知类型加载失败/.test(list), "判定输入取失败：提示并可重试，不一直转圈");
  const page = read("src/app/(main)/notifications/page.tsx");
  ok(/visibleNotificationFilters\(canOpen\)/.test(page), "通知页筛选按 visibleNotificationFilters 过滤");
  ok(/navReady \? visibleNotificationFilters\(canOpen\) : \[ALL_TYPES_FILTER\]/.test(page), "通知页：判定输入未就绪时只有「全部类型」");
  ok(!/TYPE_OPTIONS = \[/.test(page) && !/"project_dispatched"/.test(page), "通知页不再写死筛选清单");
  ok(/const seq = \+\+loadSeq\.current;/.test(page) && /if \(seq !== loadSeq\.current\) return;/.test(page), "通知页：只认最新一次请求的响应（筛选回到全部类型后旧响应不覆盖）");
  const lib = read("src/lib/notifications/type-visibility.ts");
  ok(!/from "react"|from "next\/|@\/lib\/db"/.test(lib), "对照模块是纯模块（不导入 react / next / db）");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
