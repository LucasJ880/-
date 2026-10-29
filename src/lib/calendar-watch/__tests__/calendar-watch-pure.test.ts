/**
 * CAL-1：日历观察纯函数核心（spec calendar/change-attribution）
 * 运行：npx tsx src/lib/calendar-watch/__tests__/calendar-watch-pure.test.ts
 */
import {
  applySettingsUpdate,
  attributeCalendarEvent,
  baselineFromIso,
  bucketOfRole,
  buildNotification,
  classifyKind,
  DEFAULT_BASELINE_DAYS,
  diffEvent,
  editedViaQingyan,
  fillFromPrevious,
  formatEventWhen,
  mapGoogleEvent,
  notificationRecipients,
  notificationSourceKey,
  parseLedgerAfterData,
  publicView,
  readCalendarWatch,
  reconnectNotification,
  shouldNotify,
  shouldRecord,
  summarizeCalendarAttribution,
  toLedgerAfterData,
  validateCalendarWatchInput,
  withCalendarWatch,
} from "../pure";
import type { AppointmentRef, Attribution, AttributionContext, CalendarChange, LedgerAfterData } from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const TZ = "America/Toronto";
/** 多伦多 10 月为 UTC−4 */
const edt = (local: string) => `${new Date(`${local}-04:00`).toISOString()}`;

function change(p: Partial<CalendarChange> = {}): CalendarChange {
  return {
    id: "ev1",
    status: "confirmed",
    created: edt("2026-10-20T09:00:00"),
    updated: edt("2026-10-20T09:00:00"),
    creatorEmail: null,
    organizerEmail: null,
    summary: "量房 — Smith",
    description: null,
    start: edt("2026-10-30T14:00:00"),
    end: edt("2026-10-30T15:00:00"),
    allDay: false,
    htmlLink: "https://calendar.google.com/event?eid=x",
    recurringEventId: null,
    ...p,
  };
}

const APPT: AppointmentRef = {
  appointmentId: "appt1",
  createdById: "uSales",
  assignedToId: "uAssignee",
  googleSyncedAt: new Date(edt("2026-10-20T09:00:30")),
};

function ctx(p: Partial<AttributionContext> = {}): AttributionContext {
  return {
    appointmentsByEventId: new Map(),
    memberByEmail: new Map([
      ["sales@sunny.ca", "uSales"],
      ["ops@sunny.ca", "uOps"],
      ["private.sales@gmail.com", "uSales"],
    ]),
    bucketByUserId: new Map([
      ["uSales", "sales"],
      ["uOps", "ops"],
      ["uBoss", "management"],
    ]),
    websiteBookerEmails: new Set(["booking@sunny.ca"]),
    websiteMarkers: ["booked via sunnyshutter.ca"],
    ...p,
  };
}

const MEMBER_ATTR: Attribution = { source: "member", rule: "R3", userId: "uSales", bucket: "sales", appointmentId: null };

function ledger(p: Partial<LedgerAfterData> = {}): LedgerAfterData {
  return {
    v: 1,
    calendarId: "cal1",
    eventId: "ev1",
    kind: "created",
    baseline: false,
    googleCreated: edt("2026-10-20T09:00:00"),
    googleUpdated: edt("2026-10-20T09:00:00"),
    creatorEmail: "sales@sunny.ca",
    organizerEmail: "shared@sunny.ca",
    summary: "量房 — Smith",
    start: edt("2026-10-30T14:00:00"),
    end: edt("2026-10-30T15:00:00"),
    allDay: false,
    recurringEventId: null,
    htmlLink: null,
    attribution: MEMBER_ATTR,
    editedVia: null,
    diff: null,
    ...p,
  };
}

// ── 配置 ────────────────────────────────────────────────────────
console.log("配置读写与缺省");
{
  const c = readCalendarWatch(null);
  ok(c.enabled === false, "未配置 → 关闭");
  ok(eq(c.notifyPositions, ["owner", "ops_lead"]), "通知岗位缺省 owner + ops_lead", c.notifyPositions);
  ok(c.baselineFromDays === DEFAULT_BASELINE_DAYS && DEFAULT_BASELINE_DAYS === 60, "基线天数缺省 60");
  ok(eq(c.calendarIds, []) && c.readerUserId === null && eq(c.cursor, {}), "其余字段为空");

  const bad = readCalendarWatch({ calendarWatch: { enabled: "yes", calendarIds: [1, "a", "b", "c", "d"], baselineFromDays: 999, notifyPositions: [] } });
  ok(bad.enabled === false, "enabled 非布尔 → 关闭");
  ok(eq(bad.calendarIds, ["a", "b", "c"]), "calendarIds 过滤非字符串并截到 3 个", bad.calendarIds);
  ok(bad.baselineFromDays === 60, "越界的基线天数回到缺省");
  ok(eq(bad.notifyPositions, ["owner", "ops_lead"]), "空通知岗位回到缺省");

  const read = readCalendarWatch({
    calendarWatch: {
      enabled: true,
      readerUserId: "uReader",
      calendarIds: ["cal1"],
      memberEmailAliases: { "Private.Sales@Gmail.com": "uSales", bad: 3 },
      cursor: { cal1: { phase: "incremental", syncToken: "tok", pageToken: null, lastRunAt: "x" } },
    },
  });
  ok(eq(read.memberEmailAliases, { "private.sales@gmail.com": "uSales" }), "别名键转小写、丢掉坏值", read.memberEmailAliases);
  ok(read.cursor.cal1.phase === "incremental" && read.cursor.cal1.syncToken === "tok", "游标读出");

  const settings = { museBridge: { bindings: { a: 1 } }, other: 2 };
  const written = withCalendarWatch(settings, read);
  ok(eq(written.museBridge, settings.museBridge) && written.other === 2, "写回不动其它键");
  ok(eq(readCalendarWatch(written), read), "写回后读出一致");
  ok(!("calendarWatch" in settings), "写回不改原对象");
}

console.log("配置校验");
{
  const cur = readCalendarWatch(null);
  const vctx = { activeMemberIds: new Set(["uReader", "uSales"]), positionKeys: new Set(["owner", "ops_lead", "sales_rep"]) };
  const good = validateCalendarWatchInput(
    {
      enabled: true,
      readerUserId: "uReader",
      calendarIds: ["cal1", "cal1", "cal2"],
      websiteBookerEmails: ["Booking@Sunny.ca"],
      websiteMarkers: [" Booked via sunnyshutter.ca "],
      memberEmailAliases: { "Private.Sales@gmail.com": "uSales" },
      notifyPositions: ["owner"],
      baselineFromDays: 30,
      cursor: { cal1: { phase: "incremental", syncToken: "hack" } },
    },
    cur,
    vctx,
  );
  ok(good.ok, "合法请求通过", good);
  if (good.ok) {
    ok(eq(good.fields.calendarIds, ["cal1", "cal2"]), "日历去重");
    ok(eq(good.fields.websiteBookerEmails, ["booking@sunny.ca"]), "网站账号转小写");
    ok(eq(good.fields.websiteMarkers, ["Booked via sunnyshutter.ca"]), "标记去首尾空格");
    ok(eq(good.fields.memberEmailAliases, { "private.sales@gmail.com": "uSales" }), "别名键转小写");
    ok(!("cursor" in good.fields), "请求里的 cursor 被忽略");
  }
  const bad = (body: unknown, name: string) => {
    const r = validateCalendarWatchInput(body, cur, vctx);
    ok(!r.ok, name, r);
  };
  bad(null, "非对象 → 拒绝");
  bad({ enabled: "true" }, "enabled 非布尔 → 拒绝");
  bad({ calendarIds: ["a", "b", "c", "d"] }, "超过 3 个日历 → 拒绝");
  bad({ calendarIds: [""] }, "空日历 ID → 拒绝");
  bad({ websiteBookerEmails: ["not-an-email"] }, "不合法网站邮箱 → 拒绝");
  bad({ memberEmailAliases: { "x@y.com": "uGone" } }, "别名指向非在职成员 → 拒绝");
  bad({ memberEmailAliases: { nope: "uSales" } }, "别名键不是邮箱 → 拒绝");
  bad({ notifyPositions: ["ceo"] }, "不存在的岗位 → 拒绝");
  bad({ notifyPositions: [] }, "空岗位 → 拒绝");
  bad({ baselineFromDays: 0 }, "基线天数 0 → 拒绝");
  bad({ baselineFromDays: 367 }, "基线天数 367 → 拒绝");
  bad({ baselineFromDays: 1.5 }, "基线天数非整数 → 拒绝");
  bad({ enabled: true, calendarIds: ["cal1"] }, "开启但无读取账号 → 拒绝");
  bad({ enabled: true, readerUserId: "uReader" }, "开启但无日历 → 拒绝");
  bad({ readerUserId: "uStranger" }, "读取账号非在职成员 → 拒绝");
  const off = validateCalendarWatchInput({ enabled: false }, cur, vctx);
  ok(off.ok, "只关闭开关可通过（回滚用）");
  const merged = validateCalendarWatchInput({ baselineFromDays: 10 }, { ...cur, enabled: true, readerUserId: "uReader", calendarIds: ["cal1"] }, vctx);
  ok(merged.ok && merged.fields.enabled && eq(merged.fields.calendarIds, ["cal1"]) && merged.fields.baselineFromDays === 10, "部分字段合并到现有配置", merged);
}

console.log("合并写回保留游标");
{
  const cursorA = { phase: "incremental" as const, syncToken: "tA", pageToken: null, lastRunAt: "t", lastError: null, baselineFrom: "b" };
  const cur = { ...readCalendarWatch(null), enabled: true, readerUserId: "uReader", calendarIds: ["a", "b"], cursor: { a: cursorA, b: { ...cursorA, syncToken: "tB" } } };
  const { cursor: _c, ...fields } = cur;
  void _c;
  const next = applySettingsUpdate(cur, { ...fields, calendarIds: ["a", "c"] });
  ok(next.cursor.a?.syncToken === "tA", "保留仍在观察的日历游标");
  ok(!next.cursor.b, "移除日历的游标删除");
  ok(!next.cursor.c, "新增日历没有游标（从全量开始）");
  const swapped = applySettingsUpdate(cur, { ...fields, readerUserId: "uOther" });
  ok(eq(swapped.cursor, {}), "换读取账号 → 游标全部清空");
  const view = publicView(next);
  const s = JSON.stringify(view);
  ok(!s.includes("syncToken") && !s.includes("pageToken") && !s.includes("tA"), "GET 视图不含令牌", view);
  ok(view.calendars.length === 2 && view.calendars[0].phase === "incremental" && view.calendars[1].phase === "full", "GET 视图列出每个日历阶段");
}

console.log("基线起点");
{
  const iso = baselineFromIso(new Date("2026-10-29T15:00:00Z"), TZ, 60);
  ok(iso === new Date("2026-08-30T00:00:00-04:00").toISOString(), "当地今天减 60 天的 0 点", iso);
  const iso2 = baselineFromIso(new Date("2026-10-30T02:00:00Z"), TZ, 1);
  ok(iso2 === new Date("2026-10-28T00:00:00-04:00").toISOString(), "UTC 已过午夜仍按当地日期", iso2);
}

// ── 映射 ────────────────────────────────────────────────────────
console.log("Google 事件映射");
{
  const timed = mapGoogleEvent({
    id: "e1",
    status: "confirmed",
    created: "2026-10-20T13:00:00.000Z",
    updated: "2026-10-21T13:00:00.000Z",
    creator: { email: "Sales@Sunny.ca" },
    organizer: { email: "shared@group.calendar.google.com" },
    summary: "量房",
    description: "desc",
    start: { dateTime: "2026-10-30T14:00:00-04:00", timeZone: "America/Toronto" },
    end: { dateTime: "2026-10-30T15:00:00-04:00" },
    htmlLink: "https://x",
  });
  ok(timed?.creatorEmail === "sales@sunny.ca" && timed.allDay === false && timed.start === "2026-10-30T14:00:00-04:00", "定时事件映射（邮箱转小写）", timed);
  const allDay = mapGoogleEvent({ id: "e2", start: { date: "2026-10-30" }, end: { date: "2026-10-31" } });
  ok(allDay?.allDay === true && allDay.start === "2026-10-30" && allDay.end === "2026-10-31" && allDay.status === "confirmed", "全天事件映射", allDay);
  const del = mapGoogleEvent({ id: "e3", status: "cancelled" });
  ok(
    del?.status === "cancelled" && del.created === null && del.summary === null && del.start === null && del.creatorEmail === null,
    "已删除事件只有 id 与状态",
    del,
  );
  const inst = mapGoogleEvent({ id: "e4_20261030", recurringEventId: "e4", start: { dateTime: "2026-10-30T14:00:00Z" } });
  ok(inst?.recurringEventId === "e4", "重复系列例外带 recurringEventId");
  ok(mapGoogleEvent({ summary: "no id" }) === null && mapGoogleEvent(null) === null, "无 id → null");

  const filled = fillFromPrevious(del!, ledger({ eventId: "e3" }));
  ok(filled.creatorEmail === "sales@sunny.ca" && filled.summary === "量房 — Smith" && filled.start !== null && filled.status === "cancelled", "删除事件沿用上一条账本字段", filled);
  ok(fillFromPrevious(del!, null) === del, "没有账本时原样返回");
}

// ── 归因 ────────────────────────────────────────────────────────
console.log("归因 R1–R4 与优先级");
{
  const withAppt = ctx({ appointmentsByEventId: new Map([["ev1", APPT]]) });
  const r1 = attributeCalendarEvent(change({ creatorEmail: "sales@sunny.ca" }), withAppt);
  ok(r1.rule === "R1" && r1.source === "qingyan" && r1.userId === "uSales" && r1.appointmentId === "appt1" && r1.bucket === "sales", "R1 优先于成员邮箱", r1);
  const r1web = attributeCalendarEvent(change({ creatorEmail: "booking@sunny.ca" }), withAppt);
  ok(r1web.rule === "R1", "R1 优先于网站账号");

  const r2acct = attributeCalendarEvent(change({ creatorEmail: "BOOKING@sunny.ca" }), ctx());
  ok(r2acct.rule === "R2" && r2acct.source === "website" && r2acct.userId === null, "R2 网站账号（不区分大小写）", r2acct);
  const r2title = attributeCalendarEvent(change({ creatorEmail: "x@y.com", summary: "Measure — BOOKED VIA SunnyShutter.ca" }), ctx());
  ok(r2title.rule === "R2", "R2 标题含标记（不区分大小写）");
  const r2desc = attributeCalendarEvent(change({ creatorEmail: null, description: "Booked via sunnyshutter.ca/book-now" }), ctx());
  ok(r2desc.rule === "R2", "R2 描述含标记");
  const both = ctx({ memberByEmail: new Map([["booking@sunny.ca", "uOps"]]) });
  const r2over = attributeCalendarEvent(change({ creatorEmail: "booking@sunny.ca" }), both);
  ok(r2over.rule === "R2" && r2over.userId === null, "网站账号同时是成员 → 网站（R2 先于 R3）", r2over);

  const r3 = attributeCalendarEvent(change({ creatorEmail: "Sales@Sunny.ca" }), ctx());
  ok(r3.rule === "R3" && r3.source === "member" && r3.userId === "uSales" && r3.bucket === "sales", "R3 成员邮箱", r3);
  const r3alias = attributeCalendarEvent(change({ creatorEmail: "private.sales@gmail.com" }), ctx());
  ok(r3alias.rule === "R3" && r3alias.userId === "uSales", "R3 别名命中");
  const r3ops = attributeCalendarEvent(change({ creatorEmail: "ops@sunny.ca" }), ctx());
  ok(r3ops.bucket === "ops", "运营岗 → ops 桶");
  const r3nobucket = attributeCalendarEvent(change({ creatorEmail: "x@sunny.ca" }), ctx({ memberByEmail: new Map([["x@sunny.ca", "uX"]]) }));
  ok(r3nobucket.bucket === "other", "没有信号的成员 → other");

  const r4 = attributeCalendarEvent(change({ creatorEmail: "stranger@gmail.com" }), ctx());
  ok(r4.rule === "R4" && r4.source === "unknown" && r4.userId === null, "R4 不明");
  const r4none = attributeCalendarEvent(change({ creatorEmail: null }), ctx());
  ok(r4none.rule === "R4", "无创建者 → R4");
}

console.log("分桶");
{
  ok(bucketOfRole("boss") === "management", "boss → management");
  ok(bucketOfRole("super_admin") === "management" && bucketOfRole("manager") === "management", "保留 / 旧模式管理角色 → management");
  ok(bucketOfRole("sales") === "sales", "sales → sales");
  ok(bucketOfRole("operations") === "ops", "operations → ops");
  ok(bucketOfRole("trade") === "other" && bucketOfRole("user") === "other" && bucketOfRole(null) === "other", "其余 → other");
}

console.log("经青砚判定");
{
  const r1: Attribution = { source: "qingyan", rule: "R1", userId: "uSales", bucket: "sales", appointmentId: "appt1" };
  ok(editedViaQingyan({ kind: "updated", attribution: r1, appointment: APPT, updated: edt("2026-10-20T09:02:00"), prev: null }), "推送后 ≤2 分钟 → 经青砚");
  ok(!editedViaQingyan({ kind: "updated", attribution: r1, appointment: APPT, updated: edt("2026-10-20T09:03:00"), prev: null }), ">2 分钟 → 不是经青砚");
  ok(!editedViaQingyan({ kind: "updated", attribution: MEMBER_ATTR, appointment: null, updated: edt("2026-10-20T09:00:00"), prev: null }), "非 R1 → 不是经青砚");
  ok(!editedViaQingyan({ kind: "updated", attribution: r1, appointment: { ...APPT, googleSyncedAt: null }, updated: edt("2026-10-20T09:00:00"), prev: null }), "未推送过 → 不是经青砚");
  const prevQ = ledger({ attribution: r1 });
  const unknown: Attribution = { source: "unknown", rule: "R4", userId: null, bucket: null, appointmentId: null };
  ok(editedViaQingyan({ kind: "cancelled", attribution: unknown, appointment: null, updated: null, prev: prevQ }), "青砚解除同步的删除 → 经青砚");
  ok(!editedViaQingyan({ kind: "cancelled", attribution: r1, appointment: APPT, updated: null, prev: prevQ }), "预约仍持有事件的删除 → Google 侧删除");
  ok(!editedViaQingyan({ kind: "created", attribution: r1, appointment: APPT, updated: edt("2026-10-20T09:00:00"), prev: null }), "新建不打经青砚标记");
}

// ── 账本 ────────────────────────────────────────────────────────
console.log("幂等与变更类型");
{
  ok(shouldRecord(null, change()), "没有账本 → 记");
  ok(!shouldRecord(ledger(), change()), "同一更新时间 → 不记");
  ok(!shouldRecord(ledger({ googleUpdated: edt("2026-10-21T00:00:00") }), change()), "账本更新时间更晚 → 不记");
  ok(shouldRecord(ledger(), change({ updated: edt("2026-10-20T10:00:00") })), "更新时间更晚 → 记");
  ok(!shouldRecord(ledger({ kind: "cancelled" }), change({ status: "cancelled", updated: null })), "无更新时间的删除、上一条已删除 → 不记");
  ok(shouldRecord(ledger(), change({ status: "cancelled", updated: null })), "无更新时间的删除、上一条未删除 → 记");

  const base = Date.parse(edt("2026-08-30T00:00:00"));
  const k = (c: CalendarChange, prev: LedgerAfterData | null, phase: "full" | "incremental") => classifyKind({ change: c, prev, baselineFromMs: base, phase });
  ok(k(change(), null, "full") === "created", "全量：基线后创建 → created");
  ok(k(change({ created: edt("2026-08-29T23:59:00") }), null, "full") === null, "全量：基线前创建 → 不记");
  ok(k(change({ status: "cancelled" }), null, "full") === null, "全量：没有账本的删除 → 不记");
  ok(k(change(), ledger(), "full") === "updated", "全量（410 重做）：有账本 → updated");
  ok(k(change(), null, "incremental") === "created", "增量：首次见到 → created");
  ok(k(change({ created: edt("2026-01-01T00:00:00") }), null, "incremental") === "updated", "增量：基线前创建、首次见到 → updated");
  ok(k(change({ status: "cancelled" }), null, "incremental") === "cancelled", "增量：首次见到的删除 → cancelled");
  ok(k(change({ status: "cancelled" }), ledger(), "incremental") === "cancelled", "增量：有账本的删除 → cancelled");
  ok(k(change(), ledger(), "incremental") === "updated", "增量：有账本 → updated");
}

console.log("差异");
{
  const d = diffEvent(ledger(), change({ start: edt("2026-10-30T16:00:00"), end: edt("2026-10-30T17:00:00") }));
  ok(d.length === 2 && d[0].field === "start" && d[1].field === "end", "改时间 → start / end 两项", d);
  ok(diffEvent(ledger(), change({ start: "2026-10-30T14:00:00-04:00" })).length === 0, "同一时刻不同写法不算改动");
  ok(diffEvent(ledger(), change({ summary: "安装 — Smith" }))[0]?.field === "summary", "改标题");
  ok(diffEvent(ledger(), change({ description: "新描述" })).length === 0, "只改描述 → 无差异");
  ok(diffEvent(null, change()).length === 0, "没有账本 → 无差异");
  ok(diffEvent(ledger(), change({ start: null, end: null, summary: null })).length === 0, "缺字段不算改动");
}

console.log("账本 afterData");
{
  const long = "长".repeat(130);
  const a = toLedgerAfterData({
    calendarId: "cal1",
    change: change({ description: "客户电话 416-555-0100，门禁 1234", summary: long }),
    kind: "created",
    baseline: false,
    attribution: MEMBER_ATTR,
    editedVia: null,
    diff: [],
    observedAt: new Date("2026-10-29T00:00:00Z"),
  });
  const s = JSON.stringify(a);
  ok(!s.includes("416-555-0100") && !("description" in a), "账本不含描述", a);
  ok([...(a.summary ?? "")].length === 120, "标题截 120 字");
  ok(a.diff === null, "空差异存 null");
  ok(a.v === 1 && a.eventId === "ev1" && a.calendarId === "cal1" && a.googleUpdated === change().updated, "版本、事件、日历、更新时间");
  const noUpd = toLedgerAfterData({ calendarId: "c", change: change({ updated: null, status: "cancelled" }), kind: "cancelled", baseline: false, attribution: MEMBER_ATTR, editedVia: null, diff: null, observedAt: new Date("2026-10-29T00:00:00Z") });
  ok(noUpd.googleUpdated === "2026-10-29T00:00:00.000Z", "无 updated 时用观察时间");

  ok(eq(parseLedgerAfterData(JSON.stringify(a)), a), "账本字符串可解析回来");
  ok(parseLedgerAfterData("{bad") === null && parseLedgerAfterData({ v: 2 }) === null && parseLedgerAfterData(null) === null, "坏账本 → null");
  ok(parseLedgerAfterData({ ...a, kind: "moved" }) === null, "未知类型 → null");
}

// ── 通知 ────────────────────────────────────────────────────────
console.log("是否通知");
{
  ok(shouldNotify(ledger()), "增量成员新建 → 通知");
  ok(!shouldNotify(ledger({ baseline: true })), "基线 → 不通知");
  const q: Attribution = { source: "qingyan", rule: "R1", userId: "uSales", bucket: "sales", appointmentId: "appt1" };
  ok(!shouldNotify(ledger({ attribution: q })), "青砚来源的新建 → 不通知");
  ok(!shouldNotify(ledger({ kind: "updated", attribution: q, editedVia: "qingyan", diff: [{ field: "start", before: "a", after: "b" }] })), "青砚推送的修改 → 不通知");
  ok(shouldNotify(ledger({ kind: "updated", attribution: q, diff: [{ field: "start", before: "a", after: "b" }] })), "Google 侧改青砚预约 → 通知");
  ok(shouldNotify(ledger({ kind: "cancelled", attribution: q })), "Google 侧删青砚预约 → 通知");
  ok(!shouldNotify(ledger({ kind: "cancelled", attribution: q, editedVia: "qingyan" })), "青砚解除同步的删除 → 不通知");
  ok(!shouldNotify(ledger({ kind: "updated", diff: null })), "标题与时间都没变的修改 → 不通知");
  ok(!shouldNotify(ledger({ kind: "cancelled", summary: null, start: null })), "既无标题又无时间的删除 → 不通知");
}

console.log("青砚推送不通知、Google 侧删除通知（场景）");
{
  // 青砚建预约 → 推到 Google → 观察到（R1，新建）→ 有人在 Google 删除
  const withAppt = ctx({ appointmentsByEventId: new Map([["ev1", APPT]]) });
  const c1 = change({ creatorEmail: "sales@sunny.ca", updated: edt("2026-10-20T09:00:10") });
  const at1 = attributeCalendarEvent(c1, withAppt);
  const k1 = classifyKind({ change: c1, prev: null, baselineFromMs: 0, phase: "incremental" })!;
  const e1 = toLedgerAfterData({ calendarId: "cal1", change: c1, kind: k1, baseline: false, attribution: at1, editedVia: null, diff: null, observedAt: new Date() });
  ok(e1.kind === "created" && e1.attribution.rule === "R1" && !shouldNotify(e1), "推送观察：记账本、不通知", e1.kind);

  const raw2 = mapGoogleEvent({ id: "ev1", status: "cancelled", updated: edt("2026-10-25T10:00:00") })!;
  ok(shouldRecord(e1, raw2), "删除晚于上一条 → 记");
  const c2 = fillFromPrevious(raw2, e1);
  const at2 = attributeCalendarEvent(c2, withAppt);
  const k2 = classifyKind({ change: c2, prev: e1, baselineFromMs: 0, phase: "incremental" })!;
  const via = editedViaQingyan({ kind: k2, attribution: at2, appointment: APPT, updated: c2.updated, prev: e1 }) ? "qingyan" : null;
  const e2 = toLedgerAfterData({ calendarId: "cal1", change: c2, kind: k2, baseline: false, attribution: at2, editedVia: via, diff: null, observedAt: new Date() });
  ok(e2.kind === "cancelled" && e2.summary === "量房 — Smith" && shouldNotify(e2), "Google 侧删除：记账本、通知", e2);
}

console.log("收件人");
{
  const r = notificationRecipients({ positionHolderIds: ["uBoss", "uOpsLead", "uBoss"], fallbackOwnerId: "uOwner", appointmentAssigneeId: "uAssignee", entry: ledger({ kind: "updated" }) });
  ok(eq(r, ["uBoss", "uOpsLead", "uAssignee"]), "岗位持有人 ∪ 预约负责人，去重", r);
  const self = notificationRecipients({ positionHolderIds: ["uBoss", "uSales"], fallbackOwnerId: null, appointmentAssigneeId: null, entry: ledger() });
  ok(eq(self, ["uBoss"]), "新建不发给创建者本人", self);
  const upd = notificationRecipients({ positionHolderIds: ["uBoss", "uSales"], fallbackOwnerId: null, appointmentAssigneeId: null, entry: ledger({ kind: "updated" }) });
  ok(eq(upd, ["uBoss", "uSales"]), "修改照常发给创建者");
  const fb = notificationRecipients({ positionHolderIds: [], fallbackOwnerId: "uOwner", appointmentAssigneeId: null, entry: ledger() });
  ok(eq(fb, ["uOwner"]), "没有岗位持有人 → 回落企业 owner");
  ok(eq(notificationRecipients({ positionHolderIds: [], fallbackOwnerId: null, appointmentAssigneeId: null, entry: ledger() }), []), "都没有 → 空");
  const key = notificationSourceKey("org1", ledger(), "uBoss");
  ok(key === `calwatch:org1:cal1:ev1:${ledger().googleUpdated}:uBoss`, "sourceKey 形态", key);
}

console.log("通知文案");
{
  ok(formatEventWhen(edt("2026-10-30T14:00:00"), edt("2026-10-30T15:00:00"), false, TZ) === "10/30 14:00–15:00", "同日定时");
  ok(formatEventWhen("2026-10-30", "2026-10-31", true, TZ) === "10/30（全天）", "全天");
  ok(formatEventWhen(edt("2026-10-30T22:00:00"), edt("2026-10-31T09:00:00"), false, TZ) === "10/30 22:00 – 10/31 09:00", "跨日");
  ok(formatEventWhen(null, null, false, TZ) === "", "无时间 → 空");

  const web = buildNotification(ledger({ attribution: { source: "website", rule: "R2", userId: null, bucket: null, appointmentId: null }, creatorEmail: "booking@sunny.ca" }), TZ, null);
  ok(web.title === "【网站预约】10/30 14:00–15:00 量房 — Smith（Google 侧新建）", "网站预约文案", web.title);
  const mem = buildNotification(ledger(), TZ, "王销售");
  ok(mem.title === "【日程新增】10/30 14:00–15:00 量房 — Smith（王销售，Google 侧新建）", "成员新建文案", mem.title);
  ok(mem.summary.includes("R3") && mem.summary.includes("sales@sunny.ca"), "正文含规则与创建者", mem.summary);
  const unk = buildNotification(ledger({ attribution: { source: "unknown", rule: "R4", userId: null, bucket: null, appointmentId: null } }), TZ, null);
  ok(unk.title.includes("来源不明"), "不明来源新建文案", unk.title);

  const moved = ledger({
    kind: "updated",
    start: edt("2026-10-30T16:00:00"),
    end: edt("2026-10-30T17:00:00"),
    diff: [
      { field: "start", before: edt("2026-10-30T14:00:00"), after: edt("2026-10-30T16:00:00") },
      { field: "end", before: edt("2026-10-30T15:00:00"), after: edt("2026-10-30T17:00:00") },
    ],
  });
  const mv = buildNotification(moved, TZ, null);
  ok(mv.title.includes("14:00 → 16:00") && mv.title.includes("修改人未知") && mv.title.startsWith("【日程改动】10/30 量房"), "改时间文案含前后值与修改人未知", mv.title);
  const nextDay = buildNotification(
    ledger({ kind: "updated", diff: [{ field: "start", before: edt("2026-10-30T14:00:00"), after: edt("2026-10-31T14:00:00") }] }),
    TZ,
    null,
  );
  ok(nextDay.title.includes("10/30 14:00 → 10/31 14:00"), "跨日改动带日期", nextDay.title);
  const renamed = buildNotification(ledger({ kind: "updated", diff: [{ field: "summary", before: "量房", after: "安装" }] }), TZ, null);
  ok(renamed.title.includes("标题「量房」→「安装」"), "改标题文案", renamed.title);
  const del = buildNotification(ledger({ kind: "cancelled" }), TZ, null);
  ok(del.title === "【日程取消】10/30 14:00–15:00 量房 — Smith（Google 侧删除）", "删除文案", del.title);

  const rc = reconnectNotification("org1", "uReader", "2026-10-29");
  ok(rc.sourceKey === "calwatch:reconnect:org1:uReader:2026-10-29" && rc.title.includes("重新连接"), "重连通知按当地日期幂等");
}

// ── 统计 ────────────────────────────────────────────────────────
console.log("统计");
{
  const OCT = { start: new Date(edt("2026-10-01T00:00:00")), end: new Date(edt("2026-11-01T00:00:00")) };
  const names = new Map([
    ["uSales", "王销售"],
    ["uOps", "李运营"],
  ]);
  const web: Attribution = { source: "website", rule: "R2", userId: null, bucket: null, appointmentId: null };
  const unk: Attribution = { source: "unknown", rule: "R4", userId: null, bucket: null, appointmentId: null };
  const ops: Attribution = { source: "member", rule: "R3", userId: "uOps", bucket: "ops", appointmentId: null };
  const rows: LedgerAfterData[] = [
    ledger({ eventId: "m1" }),
    ledger({ eventId: "m2" }),
    ledger({ eventId: "m3", attribution: ops }),
    ledger({ eventId: "m3", calendarId: "cal2", attribution: ops }), // 同一事件在第二个日历 → 只计一次
    ledger({ eventId: "w1", attribution: web, creatorEmail: "booking@sunny.ca" }),
    ledger({ eventId: "u1", attribution: unk, creatorEmail: "stranger@gmail.com", googleCreated: edt("2026-10-25T09:00:00") }),
    ledger({ eventId: "old", googleCreated: edt("2026-09-30T23:59:00") }), // 9 月创建 → 不计
    ledger({ eventId: "m1", kind: "updated", googleUpdated: edt("2026-10-22T09:00:00") }),
    ledger({ eventId: "m1", kind: "updated", calendarId: "cal2", googleUpdated: edt("2026-10-22T09:00:00") }), // 跨日历同一修改
    ledger({ eventId: "old", kind: "cancelled", googleCreated: edt("2026-09-30T23:59:00"), googleUpdated: edt("2026-10-05T09:00:00") }), // 9 月建、10 月删 → 删除计
    ledger({ eventId: "m2", kind: "updated", googleUpdated: edt("2026-11-02T09:00:00") }), // 11 月修改 → 不计
    ledger({ eventId: "w1", kind: "cancelled", attribution: web, googleUpdated: edt("2026-10-26T09:00:00") }), // 网站无归因人 → 不进 byActor
  ];
  const org = summarizeCalendarAttribution({ rows, period: OCT, scope: { kind: "org" }, names, truncated: false });
  ok(eq(org.bySource, { qingyan: 0, member: 3, website: 1, unknown: 1 }), "bySource：成员 3、网站 1、不明 1、青砚 0（跨日历去重）", org.bySource);
  const s = org.byActor.find((a) => a.userId === "uSales");
  const o = org.byActor.find((a) => a.userId === "uOps");
  ok(s?.created === 2 && s.updated === 1 && s.cancelled === 1 && s.name === "王销售" && s.bucket === "sales", "byActor 销售：新建 2、修改 1（去重）、删除 1（按更新时间）", s);
  ok(o?.created === 1 && o.updated === 0 && o.bucket === "ops", "byActor 运营：新建 1", o);
  ok(org.byActor.length === 2 && org.byActor[0].userId === "uSales", "按新建数降序");
  ok(org.unknownSamples?.length === 1 && org.unknownSamples[0].creatorEmail === "stranger@gmail.com", "不明来源样例含创建者邮箱", org.unknownSamples);
  ok(org.truncated === false && org.scope === "org", "truncated 透传 false");

  const own = summarizeCalendarAttribution({ rows, period: OCT, scope: { kind: "own", userId: "uSales" }, names, truncated: true });
  ok(own.byActor.length === 1 && own.byActor[0].userId === "uSales" && own.byActor[0].created === 2, "本人范围只有本人一行", own.byActor);
  ok(!("bySource" in own) && !("unknownSamples" in own), "本人范围无 bySource 与样例");
  ok(!JSON.stringify(own).includes("@") && !JSON.stringify(own).includes("李运营"), "本人范围不含邮箱与他人姓名");
  ok(own.truncated === true, "truncated 透传 true");
  const nobody = summarizeCalendarAttribution({ rows: [], period: OCT, scope: { kind: "own", userId: "uNew" }, names, truncated: false });
  ok(nobody.byActor.length === 1 && nobody.byActor[0].created === 0, "本人没有日程 → 一行全 0");

  const many: LedgerAfterData[] = Array.from({ length: 15 }, (_, i) =>
    ledger({ eventId: `u${i}`, attribution: unk, googleCreated: edt(`2026-10-${String(i + 1).padStart(2, "0")}T09:00:00`) }),
  );
  const capped = summarizeCalendarAttribution({ rows: many, period: OCT, scope: { kind: "org" }, names, truncated: false });
  ok(capped.unknownSamples?.length === 10 && capped.unknownSamples[0].eventId === "u14", "样例最多 10 条，新到旧", capped.unknownSamples?.map((x) => x.eventId));
  ok(capped.bySource?.unknown === 15, "样例截断不影响计数");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
