/**
 * P2-1 收尾：扫描时间规则、说明文字、公告链接、新标筛选、呈现与接线
 * 运行：npx tsx src/lib/procurement-records/__tests__/new-notices-pure.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NEW_VIEW_VALUE,
  NOTICE_LINK_ZH,
  SCHEDULE_BAD_TIME_ZH,
  SCHEDULE_HINT_ZH,
  SCHEDULE_NEED_DAY_ZH,
  SCHEDULE_PRESETS,
  applyPreset,
  candidatesQuery,
  parseTime,
  presetOf,
  scheduleBodyIfChanged,
  scheduleFormOf,
  toggleDay,
} from "../new-notices-pure";
import { describeSchedule, DEFAULT_SCHEDULE } from "../schedule";
import { noticeUrlOf, pickNoticeEvidence, projectFieldsFromInstrument } from "../tender-follow-pure";
import { NoticeLine, ScheduleEditor } from "@/components/procurement-records/procurement-monitor";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("扫描时间");
{
  const base = scheduleFormOf(DEFAULT_SCHEDULE);
  ok("打开时：默认周一、周四 08:00", JSON.stringify(base) === JSON.stringify({ weekdays: [1, 4], time: "08:00" }));
  ok("读回的星期几去重、排序、去掉越界", JSON.stringify(scheduleFormOf({ weekdays: [4, 1, 4, 9, -1], hour: 6, minute: 5 })) === JSON.stringify({ weekdays: [1, 4], time: "06:05" }));
  ok("时刻解析", JSON.stringify(parseTime("06:30")) === JSON.stringify({ hour: 6, minute: 30 }) && JSON.stringify(parseTime(" 7:05 ")) === JSON.stringify({ hour: 7, minute: 5 }));
  ok("时刻不合法", parseTime("24:00") === null && parseTime("08:60") === null && parseTime("8") === null && parseTime("ab:cd") === null && parseTime("") === null);
  const daily = applyPreset(base, "daily");
  ok("点「每天」：七天，时刻不动", JSON.stringify(daily) === JSON.stringify({ weekdays: [0, 1, 2, 3, 4, 5, 6], time: "08:00" }));
  ok("快捷按钮不动时刻（06:30 点「每天」仍是 06:30）", applyPreset({ weekdays: [2], time: "06:30" }, "daily").time === "06:30" && applyPreset({ weekdays: [2], time: "06:30" }, "weekdays").time === "06:30");
  ok("点「工作日」：周一到周五", JSON.stringify(applyPreset(base, "weekdays").weekdays) === "[1,2,3,4,5]");
  ok("点「默认」：周一、周四", JSON.stringify(applyPreset(daily, "default").weekdays) === "[1,4]");
  ok("高亮哪个快捷按钮", presetOf([6, 5, 4, 3, 2, 1, 0]) === "daily" && presetOf([1, 2, 3, 4, 5]) === "weekdays" && presetOf([4, 1]) === "default" && presetOf([2]) === null);
  ok("勾 / 取消一天", JSON.stringify(toggleDay(base, 3).weekdays) === "[1,3,4]" && JSON.stringify(toggleDay(base, 4).weekdays) === "[1]");
  ok("没改：不放排期", (() => { const r = scheduleBodyIfChanged(base, base); return r.ok && r.schedule === undefined; })());
  ok("时刻前后空格：算没改", (() => { const r = scheduleBodyIfChanged({ ...base, time: " 08:00 " }, base); return r.ok && r.schedule === undefined; })());
  const r1 = scheduleBodyIfChanged(daily, base);
  ok("改成每天：放进请求（七天、08:00）", r1.ok && JSON.stringify(r1.schedule) === JSON.stringify({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0 }), r1);
  const r2 = scheduleBodyIfChanged({ weekdays: [1, 4], time: "06:00" }, base);
  ok("只改时刻：放进请求", r2.ok && JSON.stringify(r2.schedule) === JSON.stringify({ weekdays: [1, 4], hour: 6, minute: 0 }));
  const r3 = scheduleBodyIfChanged({ weekdays: [], time: "08:00" }, base);
  ok("一天都没选：不发，写明至少选一天", !r3.ok && r3.error === SCHEDULE_NEED_DAY_ZH);
  const r4 = scheduleBodyIfChanged({ weekdays: [1], time: "25:00" }, base);
  ok("时刻不合法：不发，写明格式", !r4.ok && r4.error === SCHEDULE_BAD_TIME_ZH);
  ok("说明不夸大：每天扫一次，前一天的新标第二天看到", SCHEDULE_HINT_ZH.includes("前一天发布的新标第二天这个时候就能看到") && !SCHEDULE_HINT_ZH.includes("当天就能看到"));
  ok("三个快捷按钮：每天 / 工作日 / 默认（周一、周四）", SCHEDULE_PRESETS.map((p) => p.label).join("|") === "每天|工作日|默认（周一、周四）");
}

console.log("说明文字");
{
  ok("七天：每天", describeSchedule({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 6, minute: 0 }, "America/Toronto").startsWith("每天 06:00（America/Toronto）"));
  ok("周一到周五：每个工作日", describeSchedule({ weekdays: [5, 4, 3, 2, 1], hour: 8, minute: 0 }, "America/Toronto").startsWith("每个工作日 08:00"));
  ok("其它照旧列星期几", describeSchedule({ weekdays: [4, 1], hour: 8, minute: 0 }, "America/Toronto").startsWith("每周一、周四 08:00"));
  ok("六天：照样列星期几（不是「每天」）", describeSchedule({ weekdays: [0, 1, 2, 3, 4, 5], hour: 6, minute: 0 }, "UTC").startsWith("每周日、周一、周二、周三、周四、周五 06:00"));
  ok("五天但不是周一到周五：照样列星期几（不是「每个工作日」）", describeSchedule({ weekdays: [0, 1, 2, 3, 6], hour: 6, minute: 0 }, "UTC").startsWith("每周日、周一、周二、周三、周六 06:00"));
  ok("重复的星期几不影响", describeSchedule({ weekdays: [0, 1, 2, 3, 4, 5, 6, 6], hour: 6, minute: 0 }, "UTC").startsWith("每天"));
}

console.log("公告链接（与跟标同一规则）");
{
  const ev = [
    { sourceType: "OPEN_CANADA_CONTRACTS", sourceUrl: "https://open.canada.ca/x" },
    { sourceType: "CANADABUYS_TENDER_NOTICES", sourceUrl: " https://canadabuys.canada.ca/new " },
    { sourceType: "CANADABUYS_TENDER_NOTICES", sourceUrl: "https://canadabuys.canada.ca/old" },
  ];
  ok("取最新一条 CanadaBuys 招标公告来源（去空格）", noticeUrlOf(ev) === "https://canadabuys.canada.ca/new");
  ok("与跟标预填的链接相同", projectFieldsFromInstrument({ id: "i", officialNumber: "N", title: "T", jurisdiction: "CA-FED", origin: "SCAN", contractingInstitution: null, buyingInstitution: null, publishedAt: null, closingAt: null }, ev).sourceMetadata.noticeUrl === noticeUrlOf(ev));
  ok("没有 CanadaBuys：取最新一条有链接的", noticeUrlOf([{ sourceType: "MANUAL_LINK", sourceUrl: null }, { sourceType: "MANUAL_LINK", sourceUrl: "https://merx.example/1" }]) === "https://merx.example/1");
  ok("都没有链接：空", noticeUrlOf([{ sourceType: "CANADABUYS_TENDER_NOTICES", sourceUrl: "  " }]) === null && pickNoticeEvidence([]) === null);
}

console.log("新标筛选");
{
  ok("下拉「新标」→ view=new", candidatesQuery(NEW_VIEW_VALUE) === "&view=new");
  ok("下拉「候选」→ triage=CANDIDATE；「全部」→ 不带", candidatesQuery("CANDIDATE") === "&triage=CANDIDATE" && candidatesQuery("ALL") === "");
}

console.log("呈现");
{
  const h = renderToStaticMarkup(React.createElement(NoticeLine, { publishedAt: "2026-11-01", closingAt: "2026-12-01T19:00:00.000Z", noticeUrl: "https://canadabuys.canada.ca/n1" }));
  ok("招标公告一行：发布日期原样（不退一天）、截标（多伦多时间）、看公告（新窗口）", h.includes("发布 2026-11-01") && !h.includes("2026-10-31") && h.includes("截标 2026-12-01 14:00") && h.includes(NOTICE_LINK_ZH) && h.includes('href="https://canadabuys.canada.ca/n1"') && h.includes('target="_blank"') && h.includes('rel="noreferrer noopener"'), h);
  const h2 = renderToStaticMarkup(React.createElement(NoticeLine, { publishedAt: null, closingAt: null, noticeUrl: null }));
  ok("都未知、没有链接：写未知，不出链接", h2.includes("发布 未知") && h2.includes("截标 未知") && !h2.includes("<a"));
  const e = renderToStaticMarkup(React.createElement(ScheduleEditor, { value: { weekdays: [0, 1, 2, 3, 4, 5, 6], time: "06:00" }, onChange: () => undefined, disabled: false }));
  ok("扫描时间：三个快捷按钮，「每天」高亮", e.includes('data-testid="schedule-preset-daily"') && /data-testid="schedule-preset-daily"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="schedule-preset-daily"/.test(e) && /data-testid="schedule-preset-default"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-testid="schedule-preset-default"/.test(e));
  ok("扫描时间：七个星期几复选框都勾上，时刻 06:00", (e.match(/type="checkbox"[^>]*checked=""/g) ?? []).length === 7 && e.includes('value="06:00"'));
  const ed = renderToStaticMarkup(React.createElement(ScheduleEditor, { value: { weekdays: [1, 4], time: "08:00" }, onChange: () => undefined, disabled: true }));
  ok("非管理员：全部禁用", (ed.match(/disabled=""/g) ?? []).length === 3 + 7 + 1);
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const ui = read("src/components/procurement-records/procurement-monitor.tsx");
  ok("保存：先算排期，不合规就提示并不发；改过才放进请求", ui.includes("const sb = scheduleBodyIfChanged(sched, schedInitial);") && ui.includes("...(sb.schedule ? { schedule: sb.schedule } : {}),") && ui.indexOf("const sb = scheduleBodyIfChanged") < ui.indexOf('api.call("save"'));
  ok("读回时同时更新表单与打开时的值（扫描结束后的刷新不覆盖正在改的）", ui.includes("setSched(sf);") && ui.includes("setSchedInitial(sf);") && ui.includes("if (!opts.keepEdits) {") && ui.includes("if (!opts.keepEdits) setForm({") && ui.includes("void load({ keepEdits: true });"));
  ok("保存失败不重新读取（保留错误与正在改的）；成功先读再提示", /const r = await api\.call\("save"[\s\S]*?if \(!r\.ok\) return;[\s\S]*?await load\(\);\s*api\.setNote\(\{ tone: "good", text: enableAfter/.test(ui));
  ok("人工导入成功：先读再提示", /const r = await api\.call\("import"[\s\S]*?await load\(\);\s*api\.setNote\(\{ tone: "good", text: "已人工导入/.test(ui));
  ok("停用后的刷新不把接口返回值当成参数", ui.includes(".then(() => load())") && !ui.includes(".then(load)"));
  ok("候选读取用 candidatesQuery；下拉有「新标」", ui.includes("${candidatesQuery(triage, sort)}") /* P2-2 加了排序参数 */ && ui.includes("<option value={NEW_VIEW_VALUE}>{NEW_VIEW_LABEL_ZH}</option>"));
  ok("招标公告的卡片显示发布 / 截标 / 看公告", ui.includes('c.instrumentClass === "SOLICITATION" ? <NoticeLine'));
  const pure = read("src/lib/procurement-records/new-notices-pure.ts");
  ok("纯规则文件不引用任何模块（浏览器端也用）", !/^\s*import\s/m.test(pure));
  const route = read("src/app/api/procurement/candidates/route.ts");
  ok("候选接口把 view 传给取数", route.includes('view: sp.get("view")'));
  const views = read("src/lib/procurement-records/views.ts");
  ok("取数：只给招标公告公告链接，用 noticeUrlOf（与跟标同一规则）；发布日期按日期返回", views.includes('noticeUrl: r.instrumentClass === "SOLICITATION" ? noticeUrlOf(evidenceByInstrument.get(r.id) ?? []) : null,') && views.includes("publishedAt: day(r.publishedAt),"));
  const follow = read("src/lib/procurement-records/tender-follow.ts");
  ok("跟标与候选列表同一查询（有链接的证据、同一排序）", follow.includes("sourceUrl: { not: null } },\n      orderBy: NOTICE_EVIDENCE_ORDER,") && views.includes("sourceUrl: { not: null } }, orderBy: NOTICE_EVIDENCE_ORDER,"));
}

console.log(`\nnew-notices-pure: ${passed} passed`);
