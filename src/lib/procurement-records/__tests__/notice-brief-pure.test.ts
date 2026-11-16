/**
 * P2-3b「今日新标」早报：纯规则（窗口、去重键、正文、通知跳转、?view=new 初始视图、cron 接线）
 *
 * 运行：npx tsx src/lib/procurement-records/__tests__/notice-brief-pure.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTICE_BRIEF_ENTITY_TYPE,
  NOTICE_BRIEF_HREF,
  NOTICE_BRIEF_TYPE,
  briefWindowStart,
  closingText,
  formatNoticeBrief,
  noticeBriefSourceKey,
} from "../notice-brief-pure";
import { NEW_VIEW_VALUE, initialTriageFromSearch } from "../new-notices-pure";
import { notificationHref, notificationOrgToRemember } from "@/lib/notifications/href";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("P2-3b notice brief — pure");

// 窗口
const now = new Date("2026-11-16T12:00:00.000Z");
ok(briefWindowStart(now).toISOString() === "2026-11-15T12:00:00.000Z", "窗口起点 = 现在往前 24 小时");

// 去重键
ok(noticeBriefSourceKey("o1", "2026-11-16", "u1") === "procurement-notice-brief:o1:2026-11-16:u1", "去重键按组织 / 当地日期 / 人");
ok(noticeBriefSourceKey("o1", "2026-11-16", "u1") !== noticeBriefSourceKey("o1", "2026-11-16", "u2"), "不同人不同键");
ok(noticeBriefSourceKey("o1", "2026-11-16", "u1") !== noticeBriefSourceKey("o1", "2026-11-17", "u1"), "不同日期不同键");
ok(NOTICE_BRIEF_TYPE !== "daily_briefing" && NOTICE_BRIEF_TYPE !== "sales_daily_briefing", "类型不是被汇总邮件排除的两种（会进每日未读汇总）");

// 截标写法（多伦多时间）
ok(closingText(new Date("2026-11-20T19:00:00.000Z")) === "截标 11-20 14:00", "截标按多伦多时间（冬令 UTC-5）", closingText(new Date("2026-11-20T19:00:00.000Z")));
ok(closingText(new Date("2026-07-10T18:00:00.000Z")) === "截标 07-10 14:00", "夏令 UTC-4", closingText(new Date("2026-07-10T18:00:00.000Z")));
ok(closingText(null) === "截标未知", "截标未知");

// 正文
const items = Array.from({ length: 7 }, (_, i) => ({ title: i === 1 ? "  " : `Notice ${i}`, officialNumber: `WS${i}`, closingAt: i === 2 ? null : new Date("2026-11-20T19:00:00.000Z") }));
const b = formatNoticeBrief(items, 7);
ok(b.title === "今日新标 7 条", "标题写总数", b.title);
const lines = b.summary.split("\n");
ok(lines.filter((l) => l.startsWith("· ")).length === 5, "最多列 5 条", lines);
ok(lines[0] === "· Notice 0（截标 11-20 14:00）", "条目格式", lines[0]);
ok(lines[1] === "· WS1（截标 11-20 14:00）", "没有标题用编号", lines[1]);
ok(lines[2] === "· Notice 2（截标未知）", "截标未知照写", lines[2]);
ok(lines.includes("另有 2 条"), "多出的写另有 N 条", lines);
ok(lines[lines.length - 1].includes("采购监控"), "末行指向采购监控");
const one = formatNoticeBrief(items.slice(0, 1), 1);
ok(!one.summary.includes("另有"), "不多出时不写另有");
ok(formatNoticeBrief([{ title: "x".repeat(200), officialNumber: "N", closingAt: null }], 1).summary.split("\n")[0].length < 100, "过长标题截断");

// 通知跳转
const target = { type: NOTICE_BRIEF_TYPE, entityType: NOTICE_BRIEF_ENTITY_TYPE, entityId: "2026-11-16", orgId: "o1" };
ok(notificationHref(target) === NOTICE_BRIEF_HREF, "点通知 → 采购监控新标视图", notificationHref(target));
ok(NOTICE_BRIEF_HREF === "/projects/intelligence/monitor?view=new", "地址固定");
ok(notificationOrgToRemember(target) === "o1", "打开前记住所选组织（多组织用户落在对的组织）");

// ?view=new 初始视图
ok(initialTriageFromSearch("?view=new") === NEW_VIEW_VALUE, "?view=new → 新标视图");
ok(initialTriageFromSearch("?orgId=x&view=new") === NEW_VIEW_VALUE, "带其他参数也认");
ok(initialTriageFromSearch("") === null, "没有参数保持默认");
ok(initialTriageFromSearch("?view=IGNORED") === null, "其他取值不认");

// cron 接线：独立一步，带 try/catch，结果里有计数
const route = readFileSync(join(process.cwd(), "src/app/api/cron/daily-brief/route.ts"), "utf8");
ok(/try \{\s*noticeBriefSent = \(await sendNoticeBrief\(org\.id, org\.timezone, \{ now \}\)\)\.sent;\s*\} catch/.test(route), "daily-brief 里单独 try/catch 调用");
ok((route.match(/noticeBriefSent,/g) ?? []).length === 2, "成功与失败结果都带 noticeBriefSent");

// 监控页读 ?view=new
const monitor = readFileSync(join(process.cwd(), "src/components/procurement-records/procurement-monitor.tsx"), "utf8");
ok(/initialTriageFromSearch\(window\.location\.search\)/.test(monitor), "监控页挂载时读 ?view=new");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
