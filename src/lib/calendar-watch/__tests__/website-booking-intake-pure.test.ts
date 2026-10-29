/**
 * CAL-2：网站预约一键转入纯函数核心（spec calendar/website-booking-intake）
 * 运行：npx tsx src/lib/calendar-watch/__tests__/website-booking-intake-pure.test.ts
 */
import {
  appointmentTimes,
  derivePendingBookings,
  intakeWindowStart,
  MAX_PENDING,
  parseBookingDescription,
  samePhone,
  stripHtml,
  validateConvertInput,
  validateDismissInput,
  type LedgerRow,
} from "../intake-pure";
import type { Attribution, LedgerAfterData } from "../types";

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

const TZ = "America/Toronto";
const edt = (local: string) => new Date(`${local}-04:00`).toISOString();
const WEB: Attribution = { source: "website", rule: "R2", userId: null, bucket: null, appointmentId: null };
const MEMBER: Attribution = { source: "member", rule: "R3", userId: "u1", bucket: "sales", appointmentId: null };

let seq = 0;
function row(p: Partial<LedgerAfterData> & { at?: string } = {}): LedgerRow {
  const { at, ...rest } = p;
  seq += 1;
  return {
    createdAt: new Date(at ?? `2026-10-${String(10 + (seq % 15)).padStart(2, "0")}T12:00:00Z`),
    data: {
      v: 1,
      calendarId: "cal1",
      eventId: "ev1",
      kind: "created",
      baseline: false,
      googleCreated: edt("2026-10-20T09:00:00"),
      googleUpdated: edt("2026-10-20T09:00:00"),
      creatorEmail: "booking@site.test",
      organizerEmail: null,
      summary: "Measure — Jane",
      start: edt("2026-10-30T14:00:00"),
      end: edt("2026-10-30T15:00:00"),
      allDay: false,
      recurringEventId: null,
      htmlLink: null,
      attribution: WEB,
      editedVia: null,
      diff: null,
      ...rest,
    },
  };
}

const NOW = new Date(edt("2026-10-29T11:00:00"));
const WINDOW = intakeWindowStart(NOW, TZ);
const derive = (rows: LedgerRow[], converted: string[] = [], dismissed: string[] = [], limit?: number) =>
  derivePendingBookings({ rows, convertedEventIds: new Set(converted), dismissedEventIds: new Set(dismissed), windowStart: WINDOW, timezone: TZ, limit });

console.log("待转入推导");
{
  ok(WINDOW === "2026-10-22", "时间窗起点 = 当地今天前 7 天", WINDOW);
  const rows = [
    row({ eventId: "a", at: "2026-10-20T13:00:00Z" }),
    row({ eventId: "b", at: "2026-10-20T13:00:00Z" }),
    row({ eventId: "b", kind: "cancelled", at: "2026-10-21T13:00:00Z" }),
    row({ eventId: "c" }),
    row({ eventId: "d" }),
  ];
  const r = derive(rows, ["c"], ["d"]);
  ok(r.length === 1 && r[0].eventId === "a", "删除 / 已转入 / 已忽略都排除（spec 场景：4 条剩 1 条）", r);
  ok(r[0].summary === "Measure — Jane" && r[0].calendarId === "cal1" && r[0].allDay === false, "带标题、日历与全天标记");
  ok(!("creatorEmail" in r[0]) && !("description" in r[0]), "列表不含创建者邮箱与描述");

  ok(derive([row({ eventId: "m", attribution: MEMBER })]).length === 0, "成员来源不进列表（spec 场景）");
  ok(derive([row({ eventId: "u", kind: "updated" })]).length === 0, "最早一条不是新建（基线前创建）→ 不进列表");
  ok(
    derive([row({ eventId: "x", at: "2026-10-01T00:00:00Z", attribution: MEMBER }), row({ eventId: "x", at: "2026-10-02T00:00:00Z", kind: "updated" })]).length === 0,
    "最早一条归因不是网站 → 不进列表（后续修改不改变来源）",
  );
  const moved = derive([
    row({ eventId: "mv", at: "2026-10-20T00:00:00Z" }),
    row({ eventId: "mv", kind: "updated", at: "2026-10-21T00:00:00Z", start: edt("2026-11-02T10:00:00"), end: edt("2026-11-02T11:00:00"), summary: "Measure — Jane (moved)" }),
  ]);
  ok(moved.length === 1 && moved[0].start === edt("2026-11-02T10:00:00") && moved[0].summary === "Measure — Jane (moved)", "被改过时间的取最近一条的时间与标题", moved);

  ok(derive([row({ eventId: "old", start: edt("2026-10-21T23:00:00"), end: edt("2026-10-21T23:30:00") })]).length === 0, "开始早于时间窗起点 → 不进列表");
  ok(derive([row({ eventId: "edge", start: edt("2026-10-22T00:30:00"), end: edt("2026-10-22T01:00:00") })]).length === 1, "开始在时间窗起点当天 → 进列表");
  ok(derive([row({ eventId: "ad", allDay: true, start: "2026-10-22", end: "2026-10-23" })]).length === 1, "全天事件按日期比较");
  ok(derive([row({ eventId: "ns", start: null, end: null })]).length === 0, "没有开始时间 → 不进列表");

  const two = derive([row({ eventId: "dup", calendarId: "cal1", at: "2026-10-20T00:00:00Z" }), row({ eventId: "dup", calendarId: "cal2", at: "2026-10-21T00:00:00Z" })]);
  ok(two.length === 1 && two[0].calendarId === "cal2", "跨日历去重，取最近一条的日历", two);

  const order = derive([
    row({ eventId: "late", start: edt("2026-11-05T10:00:00"), end: edt("2026-11-05T11:00:00") }),
    row({ eventId: "early", start: edt("2026-10-31T10:00:00"), end: edt("2026-10-31T11:00:00") }),
    row({ eventId: "allday", allDay: true, start: "2026-11-01", end: "2026-11-02" }),
  ]);
  ok(order.map((o) => o.eventId).join(",") === "early,allday,late", "按开始时间升序", order.map((o) => o.eventId));
  const many = Array.from({ length: 205 }, (_, i) => row({ eventId: `e${i}` }));
  ok(derive(many).length === MAX_PENDING && MAX_PENDING === 200, "最多 200 条");
  ok(derive(many, [], [], 5).length === 5, "可传更小上限");
}

console.log("描述解析");
{
  const p = parseBookingDescription("Name: Jane Doe\nPhone: (416) 555-0100\nEmail: jane@example.com", "12 Main St");
  ok(p.name === "Jane Doe" && p.phone === "(416) 555-0100" && p.email === "jane@example.com" && p.address === "12 Main St", "标签行 + 地点（spec 场景）", p);
  const html = parseBookingDescription("<p><b>Full Name:</b> Bo Li<br>Mobile: +1 647.555.0199<br/>Service Address: 9 King St W &amp; Bay</p>", null);
  ok(html.name === "Bo Li" && html.phone === "+1 647.555.0199" && html.address === "9 King St W & Bay", "HTML 清理、标签别名、实体解码", html);
  const zh = parseBookingDescription("姓名：王小明\n电话：416-555-0123\n地址：多伦多 1 号", null);
  ok(zh.name === "王小明" && zh.phone === "416-555-0123" && zh.address === "多伦多 1 号", "中文标签与全角冒号", zh);
  const loose = parseBookingDescription("Booked online. Call me at 905 555 0142 or mail sam@example.org thanks", "Mississauga");
  ok(loose.name === null && loose.phone === "905 555 0142" && loose.email === "sam@example.org" && loose.address === "Mississauga", "无标签时用正则，姓名不猜", loose);
  const none = parseBookingDescription(null, null);
  ok(none.name === null && none.phone === null && none.email === null && none.address === null, "空描述 → 全空");
  const badEmail = parseBookingDescription("Email: not-an-email", null);
  ok(badEmail.email === null, "标签值不是邮箱 → 不填");
  const long = parseBookingDescription(`Name: ${"x".repeat(300)}`, null);
  ok([...(long.name ?? "")].length === 200, "单个字段截 200 字");
  const first = parseBookingDescription("Name: A\nName: B", null);
  ok(first.name === "A", "同一标签取第一条");
  ok(stripHtml("a<br>b&nbsp;c") === "a\nb c", "stripHtml");
}

console.log("电话比对");
{
  ok(samePhone("+1 416-555-0100", "4165550100"), "+1 前缀与 10 位相同（spec 场景）");
  ok(samePhone("(416) 555-0100", "416.555.0100"), "格式不同、号码相同");
  ok(!samePhone("416-555-0100", "416-555-0101"), "号码不同");
  ok(!samePhone(null, "4165550100") && !samePhone("123", "123"), "空或过短不算相同");
}

console.log("转入请求体");
{
  const members = { activeMemberIds: new Set(["u_rep", "u_other"]) };
  const good = validateConvertInput({ calendarId: "cal1", customer: { name: " Jane ", phone: "416-555-0100", email: "jane@example.com" }, appointment: { title: "量房" } }, members);
  ok(good.ok && good.value.customer.kind === "new" && good.value.appointment.type === "measure" && good.value.appointment.startAt === null, "新客户 + 缺省类型 measure + 时间留空", good);
  if (good.ok && good.value.customer.kind === "new") ok(good.value.customer.name === "Jane", "姓名去空格");
  const link = validateConvertInput({ calendarId: "cal1", customer: { existingCustomerId: "c1" } }, members);
  ok(link.ok && link.value.customer.kind === "existing", "关联已有客户");
  const bad = (body: unknown, name: string) => ok(!validateConvertInput(body, members).ok, name);
  bad(null, "非对象 → 拒绝");
  bad({ customer: { name: "A" } }, "缺 calendarId → 拒绝");
  bad({ calendarId: "c" }, "缺 customer → 拒绝");
  bad({ calendarId: "c", customer: {} }, "新客户缺姓名 → 拒绝");
  bad({ calendarId: "c", customer: { existingCustomerId: "c1", name: "A" } }, "二选一同时填 → 拒绝");
  bad({ calendarId: "c", customer: { name: "A", email: "nope" } }, "邮箱格式不对 → 拒绝");
  bad({ calendarId: "c", customer: { name: "A" }, appointment: { type: "party" } }, "未知预约类型 → 拒绝");
  bad({ calendarId: "c", customer: { name: "A" }, appointment: { startAt: edt("2026-10-30T14:00:00") } }, "只给开始时间 → 拒绝");
  bad({ calendarId: "c", customer: { name: "A" }, appointment: { startAt: edt("2026-10-30T14:00:00"), endAt: edt("2026-10-30T13:00:00") } }, "结束早于开始 → 拒绝");
  bad({ calendarId: "c", customer: { name: "A" }, appointment: { assignedToId: "u_gone" } }, "负责人不是在职成员 → 拒绝");
  bad({ calendarId: "c", customer: { name: "A" }, appointment: { title: "x".repeat(201) } }, "标题超长 → 拒绝");
  const assigned = validateConvertInput({ calendarId: "c", customer: { name: "A" }, appointment: { assignedToId: "u_other", type: "install" } }, members);
  ok(assigned.ok && assigned.value.appointment.assignedToId === "u_other" && assigned.value.appointment.type === "install", "指定在职负责人与类型");
}

console.log("忽略请求体与预约时间");
{
  const d = validateDismissInput({ reason: " 测试预约 ", calendarId: "cal1" });
  ok(d.ok && d.reason === "测试预约" && d.calendarId === "cal1", "原因去空格");
  ok(validateDismissInput(undefined).ok, "无请求体也可");
  ok(!validateDismissInput({ reason: "x".repeat(201) }).ok, "原因超 200 字 → 拒绝");

  const timed = appointmentTimes({ start: edt("2026-10-30T14:00:00"), end: edt("2026-10-30T15:00:00"), allDay: false }, { startAt: null, endAt: null });
  ok(timed.startAt.toISOString() === edt("2026-10-30T14:00:00") && timed.endAt.toISOString() === edt("2026-10-30T15:00:00") && !timed.allDay, "留空取事件时间");
  const noEnd = appointmentTimes({ start: edt("2026-10-30T14:00:00"), end: null, allDay: false }, { startAt: null, endAt: null });
  ok(noEnd.endAt.getTime() - noEnd.startAt.getTime() === 3_600_000, "事件无结束时间 → 缺省 1 小时");
  const allDay = appointmentTimes({ start: "2026-10-30", end: "2026-10-31", allDay: true }, { startAt: null, endAt: null });
  ok(allDay.allDay && allDay.startAt.toISOString().startsWith("2026-10-30") && allDay.endAt.toISOString().startsWith("2026-10-31"), "全天事件");
  const given = appointmentTimes({ start: edt("2026-10-30T14:00:00"), end: null, allDay: false }, { startAt: edt("2026-10-31T09:00:00"), endAt: edt("2026-10-31T10:00:00") });
  ok(given.startAt.toISOString() === edt("2026-10-31T09:00:00"), "请求体给了时间以请求体为准");
}

console.log(`\nCAL-2 website-booking-intake-pure: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
