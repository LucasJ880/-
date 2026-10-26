/**
 * A-2 自动化调度表与健康度（openspec change org-cockpit-read-model，spec cockpit/posts-overview）
 * 运行：npx tsx src/lib/cockpit/__tests__/schedule.test.ts
 *
 * 调度表逐项对照 vercel.json 与路由源码；nextDueAt / 最长间隔 / 健康度表驱动。纯逻辑，无 DB。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTOMATION_REGISTRY, type AutomationKey } from "@/lib/automation/registry";
import {
  AUTOMATION_SCHEDULES,
  automationHealth,
  isAutomationConfigured,
  maxGapMinutes,
  nextCronTick,
  nextDueAt,
  parseCron,
  postHealth,
  type AutomationHealth,
  type LastRunSnapshot,
} from "../schedule";

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

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const MIN = 60_000;

// ── 调度表 vs vercel.json / 路由源码 ───────────────────────────
console.log("调度表与线上调度一致");
const vercel = JSON.parse(read("vercel.json")) as { crons?: Array<{ path: string; schedule: string }> };
const crons = vercel.crons ?? [];
const keys = AUTOMATION_REGISTRY.map((a) => a.key as AutomationKey);
ok(keys.length >= 28 && keys.every((k) => AUTOMATION_SCHEDULES[k] !== undefined), `注册表 ${keys.length} 个自动化都有调度`);
ok(Object.keys(AUTOMATION_SCHEDULES).every((k) => (keys as string[]).includes(k)), "调度表没有注册表之外的键");

const routes = new Set<string>();
for (const key of keys) {
  const s = AUTOMATION_SCHEDULES[key];
  if (s.kind === "on_demand") continue;
  routes.add(s.route);
  ok(parseCron(s.cron) !== null, `${key}：cron "${s.cron}" 在受支持子集内`);
  ok(crons.some((c) => c.path === s.route && c.schedule === s.cron), `${key}：vercel.json 有 ${s.route} @ "${s.cron}"`);
  const routeFile = `src/app${s.route}/route.ts`;
  ok(existsSync(join(root, routeFile)) && read(routeFile).includes(`"${key}"`), `${key}：${routeFile} 引用了 "${key}"`);
}
for (const c of crons) ok(routes.has(c.path), `vercel.json 的 ${c.path} 有对应调度`);
ok(AUTOMATION_SCHEDULES["marketing-mmm"].kind === "on_demand" && !crons.some((c) => c.path.includes("mmm")), "marketing-mmm 没有 cron，按需");

// 门控小时对照源码
const orgGated: Array<[AutomationKey, string]> = [
  ["daily-brief", "src/app/api/cron/daily-brief/route.ts"],
  ["trade-followup", "src/app/api/cron/followup/route.ts"],
  ["wechat-push", "src/app/api/cron/wechat-push/route.ts"],
  ["trade-daily", "src/app/api/trade/cron/route.ts"],
];
for (const [key, file] of orgGated) {
  const s = AUTOMATION_SCHEDULES[key];
  const hours = s.kind === "local_hours" ? s.hours : [];
  const pattern = new RegExp(`orgsAtLocalHour\\([\\s\\S]*?\\[\\s*${hours.join(",\\s*")}\\s*\\]`);
  ok(s.kind === "local_hours" && s.timezone === "org" && pattern.test(read(file)), `${key}：组织时区门控 [${hours.join(", ")}] 与 ${file} 一致`);
}
const marketingSchedule = read("src/lib/marketing/automation-schedule.ts");
const marketingRoute = read("src/app/api/cron/marketing-automation/route.ts");
ok(/MARKETING_AUTOMATION_TIMEZONE = "America\/Toronto"/.test(marketingSchedule), "营销流固定时区 America/Toronto");
const marketingChecks: Array<[AutomationKey, RegExp, string | null]> = [
  ["marketing-channel-sync", /\[1, 7, 13, 19\]\.includes\(hour\)\) flows\.push\("sync-metrics"\)/, '"sync-metrics": "marketing-channel-sync"'],
  ["marketing-health", /hour === 7\) flows\.push\("health-scan"\)/, '"health-scan": "marketing-health"'],
  ["marketing-daily-brief", /hour === 8\) flows\.push\("daily-brief"\)/, '"daily-brief": "marketing-daily-brief"'],
  ["marketing-experiment-review", /hour === 9 && localWeekday\(now, timeZone\) === "Mon"\)/, '"experiment-review": "marketing-experiment-review"'],
  ["marketing-crm-attribution", /isCrmAttributionSyncDue[\s\S]*?\.hour === 7;/, null],
];
for (const [key, pattern, mapping] of marketingChecks) {
  const s = AUTOMATION_SCHEDULES[key];
  ok(s.kind === "local_hours" && s.timezone === "America/Toronto" && pattern.test(marketingSchedule), `${key}：门控小时与 automation-schedule.ts 一致`);
  if (mapping) ok(marketingRoute.includes(mapping), `${key}：路由映射 ${mapping}`);
}
{
  const s = AUTOMATION_SCHEDULES["marketing-experiment-review"];
  ok(s.kind === "local_hours" && s.weekday === 1 && JSON.stringify(s.hours) === "[9]", "营销实验复盘：周一 9 点");
}
{
  const miner = read("src/app/api/cron/employee-ai-practice-miner/route.ts");
  const s = AUTOMATION_SCHEDULES["employee-ai-practice-miner"];
  ok(
    s.kind === "cron" && s.enabledEnv?.name === "EMPLOYEE_AI_LEARNING_ENABLED" && miner.includes(`process.env.EMPLOYEE_AI_LEARNING_ENABLED !== "1"`),
    "practice-miner 的开关与路由一致",
  );
}

// ── cron 解析 ─────────────────────────────────────────────────
console.log("cron 子集解析");
ok(JSON.stringify(parseCron("*/15 * * * *")?.minutes) === "[0,15,30,45]", "*/15 → 0,15,30,45");
ok(parseCron("0 */2 * * *")?.hours.length === 12, "0 */2 → 12 个小时");
ok(parseCron("0 6 * * 1")?.weekday === 1, "0 6 * * 1 → 周一");
for (const bad of ["0 8 1 * *", "0 8 * 1 *", "0 8 * * 1-5", "61 * * * *", "0 8 * *", "@hourly"]) {
  ok(parseCron(bad) === null, `不支持的写法 "${bad}" → null`);
}
ok(iso(nextCronTick(parseCron("25 * * * *")!, new Date("2026-10-26T10:25:00Z"))) === "2026-10-26T11:25:00.000Z", "整点触发时刻本身不算（严格之后）");
ok(iso(nextCronTick(parseCron("0 6 * * 1")!, new Date("2026-10-26T06:00:30Z"))) === "2026-11-02T06:00:00.000Z", "周一触发后下一个周一");

// ── 下次应跑时间 ─────────────────────────────────────────────
console.log("下次应跑时间");
const S = AUTOMATION_SCHEDULES;
ok(iso(nextDueAt(S["daily-brief"], new Date("2026-10-25T22:30:00Z"), "Asia/Shanghai")) === "2026-10-25T23:00:00.000Z", "上海 06:30 → 当天上海 07:00（UTC 23:00）");
ok(iso(nextDueAt(S["daily-brief"], new Date("2026-10-26T11:10:00Z"), "America/Toronto")) === "2026-10-27T11:00:00.000Z", "多伦多 07:10 → 次日多伦多 07:00（跨日）");
ok(iso(nextDueAt(S["daily-brief"], new Date("2026-10-31T11:10:00Z"), "America/Toronto")) === "2026-11-01T12:00:00.000Z", "2026-11-01 夏令时结束：多伦多 07:00 = UTC 12:00");
ok(iso(nextDueAt(S["wechat-push"], new Date("2026-10-26T10:00:00Z"), "America/Toronto")) === "2026-10-26T11:30:00.000Z", "微信补推：多伦多 07:30");
ok(iso(nextDueAt(S["trade-followup"], new Date("2026-10-26T14:00:00Z"), "America/Toronto")) === "2026-10-26T18:00:00.000Z", "跟进建议：多伦多 10:00 之后下一档是 14:00");
ok(iso(nextDueAt(S["marketing-experiment-review"], new Date("2026-10-27T12:00:00Z"), "Asia/Shanghai")) === "2026-11-02T14:05:00.000Z", "营销复盘：固定多伦多时区，忽略组织时区；下一个周一 09:05（EST）");
ok(iso(nextDueAt(S["inquiry-sla"], new Date("2026-10-26T10:03:00Z"), "UTC")) === "2026-10-26T10:05:00.000Z", "询盘提醒每 5 分钟");
ok(iso(nextDueAt(S["approval-timeout"], new Date("2026-10-26T11:00:00Z"), "UTC")) === "2026-10-26T12:00:00.000Z", "审批超时每 2 小时（偶数整点）");
ok(nextDueAt(S["marketing-mmm"], new Date(), "UTC") === null, "按需运行 → null");

// ── 最长正常间隔 ─────────────────────────────────────────────
console.log("最长正常间隔");
const gapCases: Array<[AutomationKey, number]> = [
  ["inquiry-sla", 5],
  ["agent-runs", 2],
  ["approval-timeout", 120],
  ["tender-watch", 60],
  ["project-inspection", 1440],
  ["employee-ai-practice-miner", 10080],
  ["daily-brief", 1440],
  ["trade-followup", 19 * 60],
  ["marketing-channel-sync", 6 * 60],
  ["marketing-experiment-review", 10080],
];
for (const [key, minutes] of gapCases) ok(maxGapMinutes(S[key]) === minutes, `${key} 最长间隔 ${minutes} 分钟`, maxGapMinutes(S[key]));
ok(maxGapMinutes(S["marketing-mmm"]) === null, "按需运行没有间隔");

// ── 健康度 ────────────────────────────────────────────────────
console.log("单个自动化健康度");
const NOW = new Date("2026-10-26T12:00:00Z");
const run = (minutesAgo: number, status = "succeeded"): LastRunSnapshot => ({
  status,
  startedAt: new Date(NOW.getTime() - minutesAgo * MIN),
  completedAt: status === "running" ? null : new Date(NOW.getTime() - minutesAgo * MIN + 1000),
});
const health = (key: AutomationKey, lastRun: LastRunSnapshot | null, configured = true) =>
  automationHealth({ schedule: S[key], configured, lastRun, now: NOW });
ok(health("marketing-mmm", null) === "n/a", "按需 → n/a（先于一切）");
ok(health("aivora-sync", null, false) === "not_configured", "未配置 → not_configured，不是 never_ran");
ok(health("aivora-sync", run(2 * 24 * 60), false) === "not_configured", "未配置且最近没跑过（2 天前的旧运行）→ not_configured");
ok(health("marketing-health", run(3, "failed"), false) === "failed", "未配置但最近确实在跑且失败 → failed（不掩盖失败）");
ok(health("marketing-health", run(3), false) === "on_time", "未配置但最近确实在跑且成功 → on_time");
ok(health("inquiry-sla", null) === "never_ran", "从未运行 → never_ran");
ok(health("inquiry-sla", run(3, "failed")) === "failed", "最近一次失败 → failed");
ok(health("inquiry-sla", run(31, "running")) === "failed", "running 超过 30 分钟 → failed（卡住）");
ok(health("inquiry-sla", run(4, "running")) === "on_time", "刚开始的 running → on_time");
ok(health("inquiry-sla", run(8)) === "late", "每 5 分钟、8 分钟前 → late（8 > 7.5）");
ok(health("inquiry-sla", run(7)) === "on_time", "每 5 分钟、7 分钟前 → on_time");
ok(health("trade-followup", run(20 * 60)) === "on_time", "跟进建议 20 小时前 → on_time（19 × 1.5 = 28.5）");
ok(health("trade-followup", run(30 * 60)) === "late", "跟进建议 30 小时前 → late");
ok(health("inquiry-sla", run(3, "partial")) === "on_time", "partial 视为跑过");
ok(health("aivora-sync", run(3, "skipped")) === "on_time", "skipped 视为跑过");

console.log("是否已配置");
ok(isAutomationConfigured("aivora-sync", {}) === false, "aivora-sync 缺环境变量 → 未配置");
ok(isAutomationConfigured("aivora-sync", { AIVORA_ORG_ID: "o", AIVORA_API_URL: "u", AIVORA_API_KEY: "k" }) === true, "aivora-sync 环境变量齐全 → 已配置");
ok(isAutomationConfigured("aivora-sync", { AIVORA_ORG_ID: "o", AIVORA_API_URL: "u", AIVORA_API_KEY: "  " }) === false, "空白值视为缺失");
ok(isAutomationConfigured("employee-ai-practice-miner", {}) === false, "practice-miner 开关未开 → 未配置");
ok(isAutomationConfigured("employee-ai-practice-miner", { EMPLOYEE_AI_LEARNING_ENABLED: "1" }) === true, "practice-miner 开关开 → 已配置");
ok(isAutomationConfigured("inquiry-sla", {}) === true, "无必需环境变量 → 已配置");

console.log("岗位健康度");
const ph = (hs: AutomationHealth[], quota = false) => postHealth(hs, quota);
ok(ph(["on_time", "late", "on_time"]) === "late", "取最严重：late");
ok(ph(["on_time", "never_ran", "not_configured"]) === "never_ran", "never_ran 严重于 not_configured");
ok(ph(["on_time"], true) === "quota_hit", "配额命中抬升 on_time");
ok(ph(["late"], true) === "quota_hit", "配额命中严重于 late");
ok(ph(["failed", "on_time"], true) === "failed", "failed 严重于配额命中");
ok(ph(["n/a"]) === "n/a" && ph([]) === "n/a", "只有按需 / 没有自动化 → n/a");
ok(ph(["n/a", "on_time"]) === "on_time", "n/a 不压过 on_time");

console.log(`\n组织驾驶舱调度与健康度: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
