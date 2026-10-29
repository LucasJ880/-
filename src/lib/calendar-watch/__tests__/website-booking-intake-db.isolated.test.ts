/**
 * CAL-2：网站预约一键转入——真实 DB（隔离库）+ 真实路由，事件详情读取注入（spec calendar/website-booking-intake）
 *
 *   授权（运营主管 403、老板只读、销售可转入）；列表过滤；详情预填与已有客户、READER_NOT_CONNECTED / EVENT_NOT_FOUND /
 *   NOT_PENDING；转入新建 / 关联 / CUSTOMER_EXISTS 零写入 / CUSTOMER_NOT_FOUND；并发一成一 409；忽略幂等；
 *   审计不含联系方式；不写 Google；转入后 CAL-1 对该事件的修改归因为 R1。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/calendar-watch/__tests__/website-booking-intake-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { readFileSync } from "node:fs";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过网站预约转入 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CAL-2 website booking intake DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "cal-2-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { writeAuditLog } = await import("@/lib/audit/logger");
  const { toLedgerAfterData, withCalendarWatch, readCalendarWatch, mapGoogleEvent, parseLedgerAfterData } = await import("@/lib/calendar-watch/pure");
  const { getWebsiteBookingDetail } = await import("@/lib/calendar-watch/intake");
  const { runCalendarWatch } = await import("@/lib/calendar-watch/run");
  const listRoute = await import("@/app/api/sales/website-bookings/route");
  const detailRoute = await import("@/app/api/sales/website-bookings/[eventId]/route");
  const convertRoute = await import("@/app/api/sales/website-bookings/[eventId]/convert/route");
  const dismissRoute = await import("@/app/api/sales/website-bookings/[eventId]/dismiss/route");

  const stamp = Date.now().toString(36);
  const OWNER = `wbowner_${stamp}`;
  const OPS = `wbops_${stamp}`;
  const REP_A = `wbrepa_${stamp}`;
  const REP_B = `wbrepb_${stamp}`;
  const READER = `wbreader_${stamp}`;
  const users = [OWNER, OPS, REP_A, REP_B, READER];
  const ORG = `wborg_${stamp}`;
  const CAL = `shared_${stamp}@group.calendar.google.com`;
  const EV = (n: string) => `${n}${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Example ${id.split("_")[0]}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Example Shutters Fixture", code: `wbo-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  for (const id of users) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(OWNER, "owner");
  await bind(OPS, "ops_lead");
  await bind(REP_A, "sales_rep");
  await bind(REP_B, "sales_rep");
  // 日历观察开启；读取账号没有 Google 连接（详情路由应 409，不打网络）
  const cfg = { ...readCalendarWatch(null), enabled: true, readerUserId: READER, calendarIds: [CAL] };
  await db.organization.update({ where: { id: ORG }, data: { settingsJson: withCalendarWatch(null, cfg) as object } });

  const EXISTING = `wbcust_${stamp}`;
  await db.salesCustomer.create({ data: { id: EXISTING, orgId: ORG, name: "Jane Existing", phone: "4165550100", createdById: REP_A } });

  // ── CAL-1 账本：时间都相对真实 now（列表按当地今天前 7 天过滤）──
  const iso = (ms: number) => new Date(ms).toISOString();
  const soon = Date.now() + 2 * DAY;
  const ledger = async (eventId: string, p: { kind?: "created" | "updated" | "cancelled"; source?: "website" | "member"; start?: number; summary?: string }) => {
    const start = p.start ?? soon;
    const entry = toLedgerAfterData({
      calendarId: CAL,
      change: {
        id: eventId,
        status: p.kind === "cancelled" ? "cancelled" : "confirmed",
        created: iso(Date.now() - DAY),
        updated: iso(Date.now() + Math.floor(Math.random() * 1000)),
        creatorEmail: p.source === "member" ? email(REP_A) : "booking@site.test",
        organizerEmail: null,
        summary: p.summary ?? "Measure — Web Customer",
        description: null,
        start: iso(start),
        end: iso(start + 3_600_000),
        allDay: false,
        htmlLink: null,
        recurringEventId: null,
      },
      kind: p.kind ?? "created",
      baseline: false,
      attribution:
        p.source === "member"
          ? { source: "member", rule: "R3", userId: REP_A, bucket: "sales", appointmentId: null }
          : { source: "website", rule: "R2", userId: null, bucket: null, appointmentId: null },
      editedVia: null,
      diff: null,
      observedAt: new Date(),
    });
    await writeAuditLog(db, { userId: READER, orgId: ORG, action: "calendar.watch.observed", targetType: "google_calendar_event", targetId: `${CAL}/${eventId}`, afterData: entry });
    await pause(5);
  };
  await ledger(EV("w1"), { summary: "Measure — Jane" });
  await ledger(EV("w2"), { summary: "Measure — Bo", start: soon + DAY });
  await ledger(EV("w3"), { summary: "Consultation — Kim", start: soon + 2 * DAY });
  await ledger(EV("gone"), {});
  await ledger(EV("gone"), { kind: "cancelled" });
  await ledger(EV("mem"), { source: "member" });
  await ledger(EV("old"), { start: Date.now() - 10 * DAY });

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const call = async (handler: unknown, uid: string, path: string, method: "GET" | "POST", params: Json, body?: unknown) => {
    const r = new NextRequest(`http://localhost${path}${path.includes("?") ? "&" : "?"}orgId=${ORG}`, {
      method,
      headers: { cookie: await cookie(uid), "content-type": "application/json", "x-forwarded-for": "10.43.0.1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await (handler as Handler)(r, { params: Promise.resolve(params) });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as Json | null };
  };
  const list = (uid: string) => call(listRoute.GET, uid, "/api/sales/website-bookings", "GET", {});
  const ids = (b: Json | null) => ((b?.items as Json[]) ?? []).map((i) => i.eventId as string);
  const convert = (uid: string, eventId: string, body: unknown) => call(convertRoute.POST, uid, `/api/sales/website-bookings/${eventId}/convert`, "POST", { eventId }, body);
  const counts = async () => ({
    customers: await db.salesCustomer.count({ where: { orgId: ORG } }),
    appts: await db.appointment.count({ where: { customer: { orgId: ORG } } }),
  });

  try {
    console.log("\n[1] 授权");
    ok((await list(OPS)).status === 403, "运营主管 → 403（spec 场景）");
    const ownerList = await list(OWNER);
    ok(ownerList.status === 200 && ownerList.body?.canConvert === false, "老板列表 200、canConvert = false（spec 场景）", ownerList.body);
    const ownerConvert = await convert(OWNER, EV("w1"), { calendarId: CAL, customer: { name: "X" } });
    ok(ownerConvert.status === 403, "老板转入 → 403");
    const repList = await list(REP_A);
    ok(repList.status === 200 && repList.body?.canConvert === true && repList.body?.enabled === true, "销售列表 200、canConvert = true");

    console.log("\n[2] 列表过滤");
    ok(JSON.stringify(ids(repList.body)) === JSON.stringify([EV("w1"), EV("w2"), EV("w3")]), "只剩 3 条网站新建（删除 / 成员 / 7 天前都排除），按开始时间升序", ids(repList.body));
    ok(!repList.text.includes("booking@site.test") && !repList.text.includes("description"), "列表不含创建者邮箱与描述");

    console.log("\n[3] 详情");
    const nr = await call(detailRoute.GET, REP_A, `/api/sales/website-bookings/${EV("w1")}`, "GET", { eventId: EV("w1") });
    ok(nr.status === 409 && nr.body?.code === "READER_NOT_CONNECTED", "读取账号未连接 → 409 READER_NOT_CONNECTED（路由，不打网络）", nr.body);
    const np = await call(detailRoute.GET, REP_A, `/api/sales/website-bookings/${EV("mem")}`, "GET", { eventId: EV("mem") });
    ok(np.status === 404 && np.body?.code === "NOT_PENDING", "成员来源事件 → 404 NOT_PENDING");
    const readCalls: Array<{ reader: string; eventId: string; calendarId: string }> = [];
    const readEvent = async (reader: string, opts: { eventId: string; calendarId: string }) => {
      readCalls.push({ reader, ...opts });
      if (opts.eventId === EV("w3")) return null;
      return {
        id: opts.eventId,
        title: "Measure — Jane",
        startTime: iso(soon),
        endTime: iso(soon + 3_600_000),
        allDay: false,
        location: "12 Main St, Toronto",
        source: "google" as const,
        description: "<p>Name: Jane Doe<br>Phone: +1 416-555-0100<br>Email: jane@example.com</p>",
        htmlLink: "https://calendar.google.com/event?eid=x",
      };
    };
    const detA = await getWebsiteBookingDetail({ orgId: ORG, userId: REP_A, eventId: EV("w1") }, { readEvent });
    ok(detA.ok && detA.data.prefill.name === "Jane Doe" && detA.data.prefill.phone === "+1 416-555-0100" && detA.data.prefill.address === "12 Main St, Toronto", "预填姓名 / 电话 / 地址", detA);
    ok(detA.ok && detA.data.existingCustomers.length === 1 && detA.data.existingCustomers[0].id === EXISTING, "REP_A 名下同电话客户被提示（spec 场景）");
    const detB = await getWebsiteBookingDetail({ orgId: ORG, userId: REP_B, eventId: EV("w1") }, { readEvent });
    ok(detB.ok && detB.data.existingCustomers.length === 0, "REP_B 看不到 REP_A 的客户");
    ok(readCalls[0]?.reader === READER && readCalls[0]?.calendarId === CAL, "用读取账号与账本里的日历读取");
    const gone = await getWebsiteBookingDetail({ orgId: ORG, userId: REP_A, eventId: EV("w3") }, { readEvent });
    ok(!gone.ok && gone.code === "EVENT_NOT_FOUND" && gone.status === 404, "Google 里已无该事件 → 404 EVENT_NOT_FOUND");
    const auditBefore = await db.auditLog.count({ where: { orgId: ORG, action: { startsWith: "calendar.website_booking" } } });
    ok(auditBefore === 0, "读详情不写任何记录");

    console.log("\n[4] 转入：电话重复、客户不存在、参数");
    const before = await counts();
    const dup = await convert(REP_A, EV("w1"), { calendarId: CAL, customer: { name: "Jane Doe", phone: "+1 416-555-0100" } });
    ok(dup.status === 409 && dup.body?.code === "CUSTOMER_EXISTS" && (dup.body?.existingCustomer as Json)?.id === EXISTING, "新建但电话与本人名下客户相同 → 409 CUSTOMER_EXISTS", dup.body);
    ok(JSON.stringify(await counts()) === JSON.stringify(before), "409 后客户与预约条数不变（spec 场景）");
    const foreign = await convert(REP_B, EV("w1"), { calendarId: CAL, customer: { existingCustomerId: EXISTING } });
    ok(foreign.status === 404 && foreign.body?.code === "CUSTOMER_NOT_FOUND", "关联别人名下客户 → 404 CUSTOMER_NOT_FOUND");
    const badInput = await convert(REP_A, EV("w1"), { calendarId: CAL, customer: {} });
    ok(badInput.status === 400 && badInput.body?.code === "INVALID_INPUT", "请求体不合法 → 400 INVALID_INPUT");
    const notPending = await convert(REP_A, EV("mem"), { calendarId: CAL, customer: { name: "X" } });
    ok(notPending.status === 404 && notPending.body?.code === "NOT_PENDING", "不在待转入 → 404 NOT_PENDING");

    console.log("\n[5] 转入：关联已有客户");
    const linked = await convert(REP_A, EV("w1"), { calendarId: CAL, customer: { existingCustomerId: EXISTING }, appointment: { type: "measure" } });
    ok(linked.status === 201 && linked.body?.customerId === EXISTING && linked.body?.linkedExisting === true, "201，挂在已有客户下（spec 场景）", linked.body);
    const appt1 = await db.appointment.findUnique({ where: { id: linked.body!.appointmentId as string } });
    ok(appt1?.googleEventId === EV("w1") && appt1.googleSyncedAt !== null && appt1.assignedToId === REP_A && appt1.createdById === REP_A, "预约记下事件 ID 与同步时间，负责人与创建人为 REP_A");
    ok(appt1?.title === "Measure — Jane" && appt1.contactPhone === "4165550100", "标题缺省取事件标题，联系电话取客户电话", { t: appt1?.title, p: appt1?.contactPhone });
    ok(Math.abs((appt1?.startAt.getTime() ?? 0) - soon) < 1000, "时间缺省取事件时间");
    const again = await convert(REP_A, EV("w1"), { calendarId: CAL, customer: { existingCustomerId: EXISTING } });
    ok(again.status === 409 && again.body?.code === "ALREADY_CONVERTED", "同一事件再转 → 409 ALREADY_CONVERTED");

    console.log("\n[6] 并发认领（新建客户）");
    const [r1, r2] = await Promise.all([
      convert(REP_A, EV("w2"), { calendarId: CAL, customer: { name: "Bo Li", phone: "647-555-0199", email: "bo@example.com" }, appointment: { assignedToId: REP_A } }),
      convert(REP_B, EV("w2"), { calendarId: CAL, customer: { name: "Bo Li", phone: "647-555-0199" } }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    ok(JSON.stringify(statuses) === JSON.stringify([201, 409]), "一个 201、一个 409（spec 场景）", [r1.body, r2.body]);
    ok([r1, r2].some((r) => r.body?.code === "ALREADY_CONVERTED"), "后到者是 ALREADY_CONVERTED");
    ok((await db.appointment.count({ where: { googleEventId: EV("w2") } })) === 1, "该事件只有一条预约");
    const winner = r1.status === 201 ? r1 : r2;
    const newCust = await db.salesCustomer.findUnique({ where: { id: winner.body!.customerId as string } });
    ok(newCust?.source === "website_booking" && newCust.email !== undefined && [REP_A, REP_B].includes(newCust.createdById), "新客户来源 website_booking，归转入的销售", newCust?.source);

    console.log("\n[7] 列表与忽略");
    const after = await list(REP_A);
    ok(JSON.stringify(ids(after.body)) === JSON.stringify([EV("w3")]), "已转入的从列表消失（spec 场景）", ids(after.body));
    const dis = await call(dismissRoute.POST, OWNER, `/api/sales/website-bookings/${EV("w3")}/dismiss`, "POST", { eventId: EV("w3") }, { reason: "测试预约" });
    ok(dis.status === 200 && dis.body?.already === false, "老板（只读）可忽略");
    const dis2 = await call(dismissRoute.POST, REP_A, `/api/sales/website-bookings/${EV("w3")}/dismiss`, "POST", { eventId: EV("w3") }, {});
    ok(dis2.status === 200 && dis2.body?.already === true, "重复忽略幂等");
    ok(ids((await list(REP_A)).body).length === 0, "忽略后列表为空");
    ok((await call(dismissRoute.POST, OPS, `/api/sales/website-bookings/${EV("w3")}/dismiss`, "POST", { eventId: EV("w3") }, {})).status === 403, "运营主管忽略 → 403");

    console.log("\n[8] 审计不含联系方式");
    const audits = await db.auditLog.findMany({ where: { orgId: ORG, action: { startsWith: "calendar.website_booking" } }, orderBy: { createdAt: "asc" } });
    ok(audits.length === 3 && audits.filter((a) => a.action === "calendar.website_booking.converted").length === 2, "两条转入、一条忽略", audits.map((a) => a.action));
    const raw = audits.map((a) => a.afterData ?? "").join(" ");
    ok(!raw.includes("647-555-0199") && !raw.includes("bo@example.com") && !raw.includes("4165550100") && !raw.includes("Bo Li"), "审计不含电话 / 邮箱 / 姓名（spec 场景）", raw.slice(0, 300));
    const conv = JSON.parse(audits[0].afterData ?? "{}") as Json;
    ok(Object.keys(conv).sort().join(",") === "appointmentId,calendarId,customerId,linkedExisting" && audits[0].targetId === EV("w1"), "转入审计只有约定字段");

    console.log("\n[9] 只读 Google");
    // 去掉注释再查（头注释里写着"不调用 syncAppointmentToGoogle"）
    const src = readFileSync("src/lib/calendar-watch/intake.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ok(!/pushEventToGoogle|updateGoogleEvent|deleteGoogleEvent|syncAppointmentToGoogle|unsyncAppointmentFromGoogle|events\.(insert|patch|update|delete)/.test(src), "服务层不引用任何 Google 写接口与预约同步");
    ok(readCalls.every((c) => c.reader === READER), "只调用了注入的读取函数");

    console.log("\n[10] 转入后 CAL-1 归因为 R1");
    const o = await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
    const c2 = readCalendarWatch(o?.settingsJson ?? null);
    c2.cursor[CAL] = { phase: "incremental", syncToken: "s1", pageToken: null, lastRunAt: null, lastError: null, baselineFrom: iso(Date.now() - 60 * DAY) };
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: withCalendarWatch(o?.settingsJson ?? null, c2) as object } });
    const moved = mapGoogleEvent({
      id: EV("w1"),
      status: "confirmed",
      created: iso(Date.now() - DAY),
      updated: iso(Date.now() + 60 * 60 * 1000),
      creator: { email: "booking@site.test" },
      summary: "Measure — Web Customer",
      start: { dateTime: iso(soon + 2 * 3_600_000) },
      end: { dateTime: iso(soon + 3 * 3_600_000) },
    })!;
    await runCalendarWatch({ orgIds: [ORG], readChanges: async () => ({ changes: [moved], nextPageToken: null, nextSyncToken: "s2" }) });
    const rows = await db.auditLog.findMany({ where: { orgId: ORG, action: "calendar.watch.observed", targetId: `${CAL}/${EV("w1")}` }, orderBy: { createdAt: "asc" } });
    const last = parseLedgerAfterData(rows.at(-1)?.afterData);
    ok(last?.kind === "updated" && last.attribution.rule === "R1" && last.attribution.source === "qingyan" && last.attribution.appointmentId === appt1?.id, "转入后 Google 侧改时间 → R1 青砚，关联该预约", last?.attribution);
  } finally {
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.appointment.deleteMany({ where: { customer: { orgId: ORG } } });
    await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\n网站预约转入 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
