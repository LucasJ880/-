/**
 * A-3 首页展示规则（openspec change org-cockpit-home，spec cockpit/home-view）
 * 运行：npx tsx src/lib/cockpit/__tests__/presentation.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workforceOrgFailureHttp } from "@/lib/workforce-runtime/read-model/api-org";
import {
  ACCOUNT_DISABLED_ERROR,
  HEALTH_PRESENTATION,
  NO_ORG_ERROR,
  KPI_STATUS_LABELS,
  abnormalAutomations,
  actorLabel,
  entryActorLabel,
  errorKindFrom,
  formatCount,
  formatKpiValue,
  formatRelativeTime,
  healthPresentation,
  isPostKey,
  kpiWindowLabel,
  postName,
  serverNow,
  waitingCountLabel,
} from "../presentation";
import { POST_HEALTH_ORDER } from "../schedule";

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

console.log("健康度");
ok(POST_HEALTH_ORDER.every((h) => HEALTH_PRESENTATION[h]?.label), "七种岗位健康度都有标签");
const tones = Object.fromEntries(POST_HEALTH_ORDER.map((h) => [h, HEALTH_PRESENTATION[h].tone]));
ok(tones.failed === "danger" && tones.quota_hit === "danger", "失败 / 配额已满 → 危险色", tones);
ok(tones.late === "warning" && tones.never_ran === "warning", "迟到 / 未运行过 → 警示色");
ok(tones.on_time === "success", "正常 → 成功色");
ok(tones.not_configured === "neutral" && tones["n/a"] === "neutral", "未配置 / 按需 → 中性色");
ok(healthPresentation("failed").label === "失败" && healthPresentation("weird").tone === "neutral", "未知健康度回退中性色");

console.log("KPI 格式化");
const cases: Array<[number | string | null, Parameters<typeof formatKpiValue>[1], string]> = [
  [1234, "count", "1,234"],
  [0, "count", "0"],
  [0.8, "rate", "80%"],
  [0.666, "rate", "66.6%"],
  [0.57, "rate", "57%"],
  [0.9996, "rate", "99.9%"],
  [1, "rate", "100%"],
  [0, "rate", "0%"],
  ["25.0", "percentage_string", "25.0%"],
  [42, "minutes", "42 分钟"],
  [60, "minutes", "1 小时"],
  [135, "minutes", "2 小时 15 分"],
  [61.4, "score", "61"],
  [null, "count", "—"],
  [null, "rate", "—"],
  [Number.NaN, "minutes", "—"],
  ["abc", "percentage_string", "—"],
  ["", "count", "—"],
];
for (const [value, format, expected] of cases) {
  ok(formatKpiValue(value, format) === expected, `${JSON.stringify(value)} (${format}) → ${expected}`, formatKpiValue(value, format));
}

console.log("口径与状态文案");
ok(kpiWindowLabel({ kind: "rolling_days", days: 30 }) === "近 30 天", "近 30 天");
ok(kpiWindowLabel({ kind: "month_to_date" }) === "本月至今", "本月至今");
ok(kpiWindowLabel({ kind: "point_in_time" }) === "当前", "当前");
ok(kpiWindowLabel({ kind: "all_time" }) === "累计", "累计");
ok(KPI_STATUS_LABELS.unavailable === "未接入" && KPI_STATUS_LABELS.disabled === "未开启" && KPI_STATUS_LABELS.error === "暂不可用", "KPI 不可用三种文案");

console.log("相对时间");
const NOW = new Date("2026-10-26T12:00:00Z");
const rel = (iso: string | null) => formatRelativeTime(iso, NOW);
ok(rel("2026-10-26T11:59:30Z") === "刚刚", "30 秒前 → 刚刚");
ok(rel("2026-10-26T11:55:00Z") === "5 分钟前", "5 分钟前");
ok(rel("2026-10-26T09:00:00Z") === "3 小时前", "3 小时前");
ok(rel("2026-10-24T12:00:00Z") === "2 天前", "2 天前");
ok(rel("2026-10-26T12:05:00Z") === "5 分钟后", "5 分钟后");
ok(rel("2026-10-27T11:00:00Z") === "23 小时后", "23 小时后");
ok(rel("2026-10-26T12:00:20Z") === "1 分钟内", "20 秒后 → 1 分钟内");
ok(rel(null) === "—" && rel("not-a-date") === "—", "空 / 非法 → —");

console.log("页面时钟");
{
  const generatedAt = "2026-10-26T12:00:00.000Z";
  const received = Date.parse("2026-10-26T12:05:00.000Z"); // 客户端时钟快 5 分钟
  ok(serverNow(generatedAt, received, received).toISOString() === generatedAt, "以服务端 generatedAt 为准，不受客户端时钟偏差影响");
  ok(serverNow(generatedAt, received, received + 3 * 60_000).toISOString() === "2026-10-26T12:03:00.000Z", "收到响应后流逝的时间累加上去");
  ok(serverNow(generatedAt, received, received - 60_000).toISOString() === generatedAt, "客户端时钟回拨不倒退");
  ok(serverNow("bad", received, received + 1).getTime() === received + 1, "generatedAt 非法 → 回退客户端时间");
}

console.log("错误类型");
ok(errorKindFrom(401, null) === "session_expired", "401 → 登录已过期");
ok(errorKindFrom(403, { error: "请先选择工作组织", needsSelection: true }) === "org_selection", "403 needsSelection → 需选择组织");
ok(errorKindFrom(403, workforceOrgFailureHttp("NO_ORG").body) === "no_org", "403 无组织（workforce 组织解析的真实响应体）→ 无组织");
ok(errorKindFrom(403, workforceOrgFailureHttp("ORG_SELECTION_REQUIRED").body) === "org_selection", "403 需选择组织（真实响应体）→ 需选择组织");
ok(workforceOrgFailureHttp("NO_ORG").body.error === NO_ORG_ERROR, "无组织文案与 workforce 组织解析一致");
ok(
  readFileSync(join(process.cwd(), "src/lib/auth/guards.ts"), "utf8").includes(`{ error: "${ACCOUNT_DISABLED_ERROR}" }, { status: 403 }`),
  "停用账号文案与 withAuth 一致",
);
ok(errorKindFrom(403, { error: ACCOUNT_DISABLED_ERROR }) === "account_disabled", "403 账号已停用 → 账号停用");
ok(errorKindFrom(403, { error: "仅管理层可查看岗位视图" }) === "forbidden" && errorKindFrom(403, null) === "forbidden", "其余 403 → 无权限");
ok(errorKindFrom(500, { error: "x" }) === "server" && errorKindFrom(400, null) === "server" && errorKindFrom(0, null) === "server", "其余 → 服务端错误");

console.log("操作者、计数、岗位名");
ok(formatCount(1234567) === "1,234,567" && formatCount(0) === "0" && formatCount(Number.NaN) === "—", "计数千分位");
ok(actorLabel("system", null) === "系统" && actorLabel("ai", null) === "AI", "system → 系统，ai → AI");
{
  // org-cockpit-timeline-labels：系统 / FDE 以负责人名义写的审计
  const audit = (source: string, actorName: string | null) => ({ kind: "audit", actor: "u_owner", actorName, source });
  const ai = entryActorLabel(audit("ai", "Lin"));
  const sys = entryActorLabel(audit("system", null));
  const human = entryActorLabel(audit("human", "Lin"));
  ok(ai.label === "AI" && ai.title === "以Lin名义记录", "AI 来源的审计：显示 AI，提示挂名的人", ai);
  ok(sys.label === "系统" && sys.title === "以成员名义记录", "系统来源的审计：显示系统；没有姓名时提示以成员名义", sys);
  ok(human.label === "Lin" && human.title === null, "人工条目照旧显示姓名、无提示");
  ok(entryActorLabel({ kind: "agent_event", actor: "ai", actorName: null, source: "ai" }).label === "AI" && entryActorLabel({ kind: "automation_run", actor: "system", actorName: null, source: "system" }).title === null, "AI 运行事件 / 自动化运行照旧，无名义提示");
  ok(entryActorLabel({ kind: "audit", actor: "u1", actorName: "Ann" }).label === "Ann", "旧响应没有 source 字段时按人工显示");
}
ok(actorLabel("u1", "Lucas") === "Lucas" && actorLabel("u1", null) === "成员" && actorLabel("u1", "  ") === "成员", "用户 → 名字，无名字 → 成员");
ok(waitingCountLabel(5, false) === "5" && waitingCountLabel(100, true) === "100+", "截断时加 +");
ok(waitingCountLabel(1200, false) === "1,200" && waitingCountLabel(1200, true) === "1,200+", "计数千分位");
ok(postName("tender") === "投标" && postName(null) === "未归属" && postName("ceo") === "ceo", "岗位名查找");
ok(isPostKey("content") && !isPostKey("ceo"), "岗位键判定");

console.log("异常自动化");
{
  const list = [
    { name: "A", health: "on_time" },
    { name: "B", health: "never_ran" },
    { name: "C", health: "failed" },
    { name: "D", health: "late" },
    { name: "E", health: "not_configured" },
    { name: "F", health: "failed" },
    { name: "G", health: "n/a" },
  ];
  ok(JSON.stringify(abnormalAutomations(list).map((a) => a.name)) === '["C","F","D"]', "按失败 → 迟到 → 未运行过排序，最多 3 个", abnormalAutomations(list));
  ok(abnormalAutomations([{ name: "E", health: "not_configured" }, { name: "G", health: "n/a" }]).length === 0, "未配置 / 按需不算异常");
}

console.log(`\n组织驾驶舱展示规则: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
