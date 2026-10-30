/**
 * CAL-3：日历变更推送纯函数（spec calendar/change-push）
 * 运行：npx tsx src/lib/calendar-watch/__tests__/calendar-change-push-pure.test.ts
 */
import { MUSE_EVENT_TYPES, museEventEnvelopeSchema } from "@/lib/muse-bridge/contract";
import { buildMuseEvent } from "@/lib/muse-bridge/events-pure";
import { buildNotification, notificationSourceKey, toLedgerAfterData } from "../pure";
import {
  calendarChangedEventInput,
  chooseChannel,
  maskEmails,
  MAX_WECHAT_PUSHES_PER_RUN,
  museEnvelopeClean,
  museSourceKey,
  occurredAtOf,
  pushText,
} from "../push-pure";
import type { Attribution, CalendarChange, CalendarChangeKind, FieldDiff } from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

const TZ = "America/Toronto";
const edt = (local: string) => new Date(`${local}-04:00`).toISOString();
const ORG = "org_fixture_1";
const USER = "user_fixture_1";
const CREATOR = "outside.creator@example.test";

function change(p: Partial<CalendarChange> = {}): CalendarChange {
  return {
    id: "ev1",
    status: "confirmed",
    created: edt("2026-10-20T09:00:00"),
    updated: edt("2026-10-29T10:05:00"),
    creatorEmail: CREATOR,
    organizerEmail: null,
    summary: "量房 — Smith",
    description: null,
    start: edt("2026-10-30T16:00:00"),
    end: edt("2026-10-30T17:00:00"),
    allDay: false,
    htmlLink: "https://calendar.google.com/event?eid=x",
    recurringEventId: null,
    ...p,
  };
}
const attr = (p: Partial<Attribution> = {}): Attribution => ({ source: "member", rule: "R3", userId: null, bucket: null, appointmentId: null, ...p });
function entryOf(kind: CalendarChangeKind, c: CalendarChange, a: Attribution, diff: FieldDiff[] | null = null) {
  return toLedgerAfterData({ calendarId: "cal1", change: c, kind, baseline: false, attribution: a, editedVia: null, diff, observedAt: new Date(edt("2026-10-29T11:00:00")) });
}

console.log("\n[1] 渠道选择");
const bound = new Set([USER]);
const matrix: Array<[boolean, boolean, string, "muse" | "site"]> = [
  [true, true, USER, "muse"],
  [false, true, USER, "site"],
  [true, false, USER, "site"],
  [true, true, "someone_else", "site"],
  [false, false, "someone_else", "site"],
];
for (const [museEnabled, orgAllowed, userId, want] of matrix) {
  ok(chooseChannel({ museEnabled, orgAllowed, boundUserIds: bound, userId }) === want, `开关 ${museEnabled} / 放行 ${orgAllowed} / ${userId === USER ? "已绑定" : "未绑定"} → ${want}`);
}
ok(museSourceKey("calwatch:o:e:v:u") === "muse:calwatch:o:e:v:u", "Muse 落库键 = muse: + 通知键（与 emitMuseEvent 一致）");

console.log("\n[2] 推送文案不含邮箱");
const created = entryOf("created", change(), attr());
const createdDraft = buildNotification(created, TZ, null);
ok(createdDraft.summary.includes(CREATOR), "前提：CAL-1 站内摘要含创建者邮箱", createdDraft.summary);
ok(createdDraft.title.includes(CREATOR), "前提：创建者未匹配姓名时 CAL-1 标题回落为邮箱", createdDraft.title);
const t1 = pushText(createdDraft, created);
ok(!t1.title.includes("@") && !t1.body.includes("@"), "推送标题与正文都不含邮箱", t1);
ok(t1.title.includes("[邮箱]") && t1.title.startsWith("【日程新增】"), "标题里的邮箱替换为 [邮箱]，其余照旧", t1.title);
ok(t1.body === "来源：成员（R3）", "正文只有来源与规则", t1.body);

const named = buildNotification(created, TZ, "Example Rep");
ok(pushText(named, created).title === named.title, "标题无邮箱时原样沿用 CAL-1 标题");

const web = entryOf("created", change({ summary: "Measure — jane.doe@mail.test", creatorEmail: "booking@site.test" }), attr({ source: "website", rule: "R2" }));
const tw = pushText(buildNotification(web, TZ, null), web);
ok(tw.title.startsWith("【网站预约】") && tw.title.includes("Measure — [邮箱]") && !tw.title.includes("@"), "日程标题里手写的邮箱也替换", tw.title);
ok(tw.body === "来源：网站预约（R2）", "网站来源正文", tw.body);

const upd = entryOf("updated", change(), attr(), [{ field: "start", before: edt("2026-10-30T14:00:00"), after: edt("2026-10-30T16:00:00") }]);
const tu = pushText(buildNotification(upd, TZ, null), upd);
ok(tu.title.includes("14:00 → 16:00") && tu.title.includes("修改人未知"), "修改文案含前后值与修改人未知", tu.title);
ok(maskEmails("a.b+c@x.co 与 d@e.org") === "[邮箱] 与 [邮箱]", "多个邮箱都替换");
ok(maskEmails("没有邮箱 @ 符号") === "没有邮箱 @ 符号", "孤立的 @ 不误伤");
ok(maskEmails("contact john.smith@acme") === "contact [邮箱]" && maskEmails("call john@") === "call [邮箱]", "截断在邮箱中间（无顶级域 / 无域名）也替换");
const cut = entryOf("created", change({ summary: `${"量".repeat(100)} contact jo@acmecorp.com`, creatorEmail: null }), attr({ source: "unknown", rule: "R4" }));
ok(cut.summary !== null && cut.summary.length === 120 && cut.summary.endsWith("jo@acmecorp"), "前提：账本标题截到 120 字，截在邮箱中间", cut.summary?.slice(-20));
const tc = pushText(buildNotification(cut, TZ, null), cut);
ok(!tc.title.includes("@") && tc.title.includes("contact [邮箱]"), "截断标题里的半个邮箱也不外发", tc.title.slice(-40));
const updCut = entryOf("updated", change({ summary: "Measure — mary@x" }), attr(), [{ field: "summary", before: "Measure — jane.doe@ex", after: "Measure — mary@x" }]);
const tdc = pushText(buildNotification(updCut, TZ, null), updCut);
ok(!tdc.title.includes("@") && (tdc.title.match(/\[邮箱\]/g) ?? []).length >= 2, "标题改动的前后值里的邮箱都替换", tdc.title);

console.log("\n[3] Muse 事件信封");
ok((MUSE_EVENT_TYPES as readonly string[]).includes("calendar.changed") && MUSE_EVENT_TYPES[MUSE_EVENT_TYPES.length - 1] === "calendar.changed", "calendar.changed 追加在事件类型末尾");
const key = notificationSourceKey(ORG, upd, USER);
const input = calendarChangedEventInput({ sourceKey: key, orgId: ORG, userId: USER, text: tu, occurredAt: new Date(edt("2026-10-29T11:00:00")) });
const env = buildMuseEvent(input);
ok(env !== null && museEventEnvelopeSchema.safeParse(env).success, "信封通过契约校验", env);
ok(env?.eventId === key && env?.type === "calendar.changed" && env?.orgId === ORG && env?.userId === USER, "eventId = 通知键，类型 / 企业 / 收件人正确", env);
ok(env !== null && env.action === undefined && env.approval === undefined, "不带动作、不带审批");
ok(env?.summary.split("\n")[0] === tu.title && env?.summary.split("\n")[1] === tu.body, "摘要 = 标题 + 换行 + 正文", env?.summary);
ok(!JSON.stringify(env).includes("@"), "整个信封不含邮箱");
const longKey = notificationSourceKey(ORG, { ...upd, eventId: "x".repeat(200) }, USER);
ok(longKey.length > 200 && buildMuseEvent({ ...input, eventId: longKey }) === null, "通知键超过 200 字 → 信封不成立（执行器回落站内）", longKey.length);
ok(museEnvelopeClean(input), "普通修改：可走 Muse");
ok(!museEnvelopeClean({ ...input, eventId: longKey }), "通知键过长：不走 Muse");
const marginText = pushText(buildNotification(entryOf("created", change({ summary: "Margin trim install" }), attr()), TZ, "Example Rep"), entryOf("created", change({ summary: "Margin trim install" }), attr()));
const marginInput = calendarChangedEventInput({ sourceKey: key, orgId: ORG, userId: USER, text: marginText, occurredAt: new Date() });
ok(buildMuseEvent(marginInput)?.summary !== marginInput.summary && !museEnvelopeClean(marginInput), "标题命中出站敏感词（margin）会被整段替换 → 不走 Muse（执行器改走站内）", buildMuseEvent(marginInput)?.summary);
ok(MAX_WECHAT_PUSHES_PER_RUN === 30, "每轮微信推送上限 30");
const at = occurredAtOf(edt("2026-10-29T10:05:00"), new Date(edt("2026-10-29T11:00:00")));
ok(at.toISOString() === edt("2026-10-29T10:05:00"), "事件时间取 Google 更新时间");
ok(occurredAtOf(null, new Date(0)).getTime() === 0 && occurredAtOf("garbage", new Date(0)).getTime() === 0, "缺失或不合法时取本轮时间");
const longTitle = { title: "长".repeat(400), body: "来源：成员（R3）" };
const envLong = buildMuseEvent(calendarChangedEventInput({ sourceKey: key, orgId: ORG, userId: USER, text: longTitle, occurredAt: new Date() }));
ok(envLong !== null && envLong.summary.length === 300, "超长摘要截到 300 字仍成立", envLong?.summary.length);
const sens = buildMuseEvent(calendarChangedEventInput({ sourceKey: key, orgId: ORG, userId: USER, text: { title: "【日程新增】讨论毛利", body: "来源：成员（R3）" }, occurredAt: new Date() }));
ok(sens !== null && !sens.summary.includes("毛利"), "命中出站敏感词时摘要被既有脱敏整段替换", sens?.summary);

console.log(`\n日历变更推送纯函数：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
