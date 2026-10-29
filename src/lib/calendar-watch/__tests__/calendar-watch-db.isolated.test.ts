/**
 * CAL-1：日历观察——真实 DB（隔离库）+ 真实路由 + 注入的假 Google 读取函数端到端（spec calendar/change-attribution）
 *
 *   设置接口 403 / 400（READER_NOT_CONNECTED / CALENDAR_NOT_ACCESSIBLE / INVALID_SETTINGS）/ 200 且不含令牌；
 *   首次全量零通知、只记基线起点后的新建、中断后按分页位置续读；增量新建 / 修改 / 删除的账本、归因与收件人；
 *   重放幂等；410 重置游标；授权失效当天只通知一次；一个组织出错不影响另一个；
 *   统计接口 org / own 形态；关闭开关回滚不丢游标；Google 写接口零调用、预约表不变。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/calendar-watch/__tests__/calendar-watch-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { readFileSync } from "node:fs";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import type { CalendarChangesPage as Page } from "@/lib/google-calendar";

function skip(reason: string): never {
  console.log(`⏭  跳过日历观察 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CAL-1 calendar watch DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "cal-1-isolated-test-secret-0123456789abcdef";

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

/** 多伦多 10 月为 UTC−4 */
const edt = (local: string) => new Date(`${local}-04:00`).toISOString();
/** 多伦多 11 月 1 日起为 UTC−5 */
const est = (local: string) => new Date(`${local}-05:00`).toISOString();

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { GoogleSyncTokenExpiredError, GoogleTokenExpiredError } = await import("@/lib/google-calendar");
  const { mapGoogleEvent, readCalendarWatch, parseLedgerAfterData } = await import("@/lib/calendar-watch/pure");
  const { runCalendarWatch } = await import("@/lib/calendar-watch/run");
  const { saveCalendarWatchSettings } = await import("@/lib/calendar-watch/settings");
  const settingsRoute = await import("@/app/api/organizations/[orgId]/calendar-watch-settings/route");
  const statsRoute = await import("@/app/api/sales/calendar/attribution/route");
  type ReadOpts = { calendarId: string; syncToken?: string | null; pageToken?: string | null };

  const stamp = Date.now().toString(36);
  const OWNER = `cwowner_${stamp}`;
  const OPSLEAD = `cwops_${stamp}`;
  const REP = `cwrep_${stamp}`;
  const READER = `cwreader_${stamp}`;
  const PLAIN = `cwplain_${stamp}`;
  const OWNER_B = `cwownerb_${stamp}`;
  const READER_B = `cwreaderb_${stamp}`;
  const users = [OWNER, OPSLEAD, REP, READER, PLAIN, OWNER_B, READER_B];
  const ORG = `cworg_${stamp}`;
  const ORG_B = `cworgb_${stamp}`;
  const CUST = `cwcust_${stamp}`;
  const CAL = `shared_${stamp}@group.calendar.google.com`;
  const CAL_B = `sharedb_${stamp}@group.calendar.google.com`;
  const CAL2 = `shared2_${stamp}@group.calendar.google.com`;
  const EV = (n: string) => `${n}${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const REP_GOOGLE = `rep.google.${stamp}@gmail.test`;
  const OPS_PRIVATE = `ops.private.${stamp}@gmail.test`;
  const BOOKING = `booking.${stamp}@site.test`;
  const STRANGER = `stranger.${stamp}@example.test`;
  const NOW = new Date(edt("2026-10-29T11:00:00"));

  for (const id of users) {
    await db.user.create({ data: { id, email: email(id), name: `Example ${id.split("_")[0]}`, role: "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Shutters Fixture", code: `cwo-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Shutters Fixture", code: `cwb-${stamp}`, ownerId: OWNER_B, industryPackId: "window_covering_services_v1" } });
  for (const [orgId, userId] of [[ORG, OWNER], [ORG, OPSLEAD], [ORG, REP], [ORG, READER], [ORG, PLAIN], [ORG_B, OWNER_B], [ORG_B, READER_B]] as const) {
    await db.organizationMember.create({ data: { orgId, userId, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  await seedOrgAuthorizationProfiles(ORG_B);
  const bind = async (orgId: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
    await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(ORG, OWNER, "owner");
  await bind(ORG, OPSLEAD, "ops_lead");
  await bind(ORG, REP, "sales_rep");
  await bind(ORG_B, OWNER_B, "owner");
  // 读取账号与 REP 的 Google 连接（令牌是假的；本测试从不打真 Google）
  await db.calendarProvider.create({ data: { type: "google", name: "Google", userId: READER, accessToken: "fake", accountEmail: email(READER) } });
  await db.calendarProvider.create({ data: { type: "google", name: "Google", userId: READER_B, accessToken: "fake", accountEmail: email(READER_B) } });
  await db.calendarProvider.create({ data: { type: "google", name: "Google", userId: REP, accessToken: "fake", accountEmail: REP_GOOGLE } });

  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", createdById: REP } });
  const APPT_Q1 = `cwappt1_${stamp}`;
  const APPT_Q2 = `cwappt2_${stamp}`;
  await db.appointment.create({
    data: { id: APPT_Q1, customerId: CUST, title: "量房", startAt: new Date(edt("2026-10-31T10:00:00")), endAt: new Date(edt("2026-10-31T11:00:00")), assignedToId: REP, createdById: REP, googleEventId: EV("q1"), googleSyncedAt: new Date(edt("2026-10-13T09:00:20")) },
  });
  await db.appointment.create({
    data: { id: APPT_Q2, customerId: CUST, title: "安装", startAt: new Date(edt("2026-11-02T10:00:00")), endAt: new Date(edt("2026-11-02T12:00:00")), assignedToId: REP, createdById: REP, googleEventId: EV("q2"), googleSyncedAt: new Date(edt("2026-10-29T10:20:20")) },
  });
  const apptSnapshot = async () => JSON.stringify(await db.appointment.findMany({ where: { customerId: CUST }, orderBy: { id: "asc" } }));
  const apptBefore = await apptSnapshot();

  // ── 假 Google 读取函数：按日历脚本返回，记录每次调用 ──
  const scripts: Record<string, (o: ReadOpts) => Page> = {};
  const calls: Array<ReadOpts & { userId: string }> = [];
  const readChanges = async (userId: string, opts: ReadOpts): Promise<Page> => {
    calls.push({ userId, ...opts });
    const s = scripts[opts.calendarId];
    if (!s) throw new Error(`no script for ${opts.calendarId}`);
    return s(opts);
  };
  const run = (orgIds: string[] = [ORG]) => runCalendarWatch({ readChanges, orgIds, now: () => NOW });

  const g = (p: { id: string; created?: string; updated?: string; creator?: string; summary?: string; description?: string; start?: string; end?: string; status?: string }) =>
    mapGoogleEvent({
      id: p.id,
      status: p.status ?? "confirmed",
      created: p.created,
      updated: p.updated ?? p.created,
      creator: p.creator ? { email: p.creator } : undefined,
      summary: p.summary,
      description: p.description,
      start: p.start ? { dateTime: p.start } : undefined,
      end: p.end ? { dateTime: p.end } : undefined,
      htmlLink: `https://calendar.google.com/event?eid=${p.id}`,
    })!;

  const old = Array.from({ length: 300 }, (_, i) =>
    g({ id: EV(`old${i}_`), created: edt("2026-05-01T09:00:00"), creator: email(REP), summary: `历史日程 ${i}`, start: edt("2026-05-02T10:00:00"), end: edt("2026-05-02T11:00:00") }),
  );
  const m1 = g({ id: EV("m1"), created: edt("2026-10-10T09:00:00"), creator: email(REP), summary: "量房 — Example A", start: edt("2026-10-30T14:00:00"), end: edt("2026-10-30T15:00:00") });
  const w1 = g({ id: EV("w1"), created: edt("2026-10-11T09:00:00"), creator: BOOKING, summary: "Measure — Web Customer", start: edt("2026-11-01T10:00:00"), end: edt("2026-11-01T11:00:00") });
  const u1 = g({ id: EV("u1"), created: edt("2026-10-12T09:00:00"), creator: STRANGER, summary: "外部日程", start: edt("2026-11-03T10:00:00"), end: edt("2026-11-03T11:00:00") });
  const q1 = g({ id: EV("q1"), created: edt("2026-10-13T09:00:00"), creator: email(READER), summary: "📏 量房 Example B", start: edt("2026-10-31T10:00:00"), end: edt("2026-10-31T11:00:00") });

  const ledgerRows = async (orgId = ORG) =>
    (await db.auditLog.findMany({ where: { orgId, action: "calendar.watch.observed" }, orderBy: { createdAt: "asc" }, select: { afterData: true, userId: true, targetId: true } })).map((r) => ({
      ...parseLedgerAfterData(r.afterData)!,
      _raw: r.afterData ?? "",
      _userId: r.userId,
      _targetId: r.targetId,
    }));
  const notes = (where: Json = {}) => db.notification.findMany({ where: { orgId: ORG, category: "calendar_watch", ...where }, orderBy: { createdAt: "asc" } });
  const cursorOf = async (orgId = ORG, cal = CAL) => readCalendarWatch((await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }))?.settingsJson ?? null).cursor[cal];
  const settingsJsonOf = async () => JSON.stringify((await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson ?? null);

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const settingsCall = async (uid: string, method: "GET" | "PUT", body?: unknown) => {
    const r = new NextRequest(`http://localhost/api/organizations/${ORG}/calendar-watch-settings`, {
      method,
      headers: { cookie: await cookie(uid), "content-type": "application/json", "x-forwarded-for": "10.41.0.8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const handler = (method === "GET" ? settingsRoute.GET : settingsRoute.PUT) as unknown as Handler;
    const res = await handler(r, { params: Promise.resolve({ orgId: ORG }) });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as Json | null };
  };
  const statsCall = async (uid: string, query: string) => {
    const r = new NextRequest(`http://localhost/api/sales/calendar/attribution${query}`, { method: "GET", headers: { cookie: await cookie(uid), "x-forwarded-for": "10.41.0.9" } });
    const res = await (statsRoute.GET as unknown as Handler)(r, { params: Promise.resolve({}) });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as Json | null };
  };
  const visible = (ids: string[]) => ({ listCalendars: async () => ids.map((id) => ({ id, summary: id, backgroundColor: "", foregroundColor: "", primary: false, accessRole: "reader", selected: true })), hasProvider: async () => true });

  try {
    console.log("\n[1] 设置接口授权与缺省");
    const deniedGet = await settingsCall(REP, "GET");
    const deniedPut = await settingsCall(REP, "PUT", { enabled: false });
    ok(deniedGet.status === 403 && deniedPut.status === 403, "只持 sales_rep → GET / PUT 均 403", [deniedGet.status, deniedPut.status]);
    ok((await settingsCall(PLAIN, "GET")).status === 403, "无岗位成员 → 403");
    const g0 = await settingsCall(OWNER, "GET");
    const s0 = g0.body?.settings as Json;
    ok(g0.status === 200 && s0?.enabled === false && JSON.stringify(s0?.notifyPositions) === JSON.stringify(["owner", "ops_lead"]), "老板 GET → 200，缺省关闭、通知岗位 owner + ops_lead", g0.body);

    console.log("\n[2] 保存校验（配置不变）");
    const before = await settingsJsonOf();
    const r1 = await settingsCall(OWNER, "PUT", { enabled: true, readerUserId: PLAIN, calendarIds: [CAL] });
    ok(r1.status === 400 && r1.body?.code === "READER_NOT_CONNECTED", "读取账号未连接 Google → 400 READER_NOT_CONNECTED", r1.body);
    const r2 = await saveCalendarWatchSettings({ orgId: ORG, actorUserId: OWNER, body: { enabled: true, readerUserId: READER, calendarIds: [CAL] }, deps: visible(["other@group.calendar.google.com"]) });
    ok(!r2.ok && r2.code === "CALENDAR_NOT_ACCESSIBLE" && r2.status === 400, "读取账号看不到该日历 → 400 CALENDAR_NOT_ACCESSIBLE", r2);
    const r1b = await settingsCall(OWNER, "PUT", { readerUserId: OWNER_B });
    ok(r1b.status === 400 && r1b.body?.code === "READER_NOT_CONNECTED", "读取账号不是本企业在职成员 → 400 READER_NOT_CONNECTED", r1b.body);
    const r3 = await settingsCall(OWNER, "PUT", { notifyPositions: ["ceo"] });
    ok(r3.status === 400 && r3.body?.code === "INVALID_SETTINGS", "不存在的岗位 → 400 INVALID_SETTINGS", r3.body);
    const r4 = await settingsCall(OWNER, "PUT", { websiteBookerEmails: ["nope"] });
    ok(r4.status === 400 && r4.body?.code === "INVALID_SETTINGS", "不合法邮箱 → 400 INVALID_SETTINGS");
    ok((await settingsJsonOf()) === before, "五次失败后配置不变");

    console.log("\n[3] 保存成功");
    const saved = await saveCalendarWatchSettings({
      orgId: ORG,
      actorUserId: OWNER,
      body: {
        enabled: true,
        readerUserId: READER,
        calendarIds: [CAL],
        websiteBookerEmails: [BOOKING.toUpperCase()],
        websiteMarkers: ["Booked via Example Site"],
        memberEmailAliases: { [OPS_PRIVATE]: OPSLEAD },
        cursor: { [CAL]: { phase: "incremental", syncToken: "forged" } },
      },
      deps: visible([CAL]),
    });
    ok(saved.ok, "开启并保存 → ok", saved);
    ok((await cursorOf()) === undefined, "请求里伪造的 cursor 被忽略");
    const audit = await db.auditLog.count({ where: { orgId: ORG, action: "calendar.watch.settings_updated", userId: OWNER } });
    ok(audit === 1, "写一条设置审计", audit);
    const savedB = await saveCalendarWatchSettings({ orgId: ORG_B, actorUserId: OWNER_B, body: { enabled: true, readerUserId: READER_B, calendarIds: [CAL_B] }, deps: visible([CAL_B]) });
    ok(savedB.ok, "第二个组织开启");

    console.log("\n[4] 首次全量：中断后续读、零通知、只记基线后新建");
    let page2Fails = true;
    scripts[CAL] = (o) => {
      if (o.syncToken) throw new Error("unexpected syncToken in full phase");
      if (!o.pageToken) return { changes: [...old, m1, w1], nextPageToken: "p2", nextSyncToken: null };
      if (page2Fails) throw new Error("network blip");
      return { changes: [u1, q1], nextPageToken: null, nextSyncToken: "s1" };
    };
    const run1 = await run();
    const c1 = await cursorOf();
    ok(run1.failedCount === 1 && c1?.phase === "full" && c1.pageToken === "p2" && Boolean(c1.lastError), "第 2 页出错：组织记为出错，游标停在 p2", { run1: run1.results, c1 });
    ok((await ledgerRows()).length === 2, "第 1 页只记基线后的 2 条（300 条历史不记）", (await ledgerRows()).length);
    page2Fails = false;
    const run2 = await run();
    const c2 = await cursorOf();
    ok(run2.failedCount === 0 && c2?.phase === "incremental" && c2.syncToken === "s1" && c2.pageToken === null && c2.lastError === null, "续读第 2 页 → 转入增量，保存 s1", c2);
    ok(calls.at(-1)?.pageToken === "p2" && !calls.at(-1)?.syncToken, "续读用的是保存的分页位置");
    const base = await ledgerRows();
    ok(base.length === 4 && base.every((r) => r.baseline && r.kind === "created"), "全量共记 4 条，均为基线新建", base.map((r) => [r.eventId, r.kind, r.baseline]));
    ok((await notes()).length === 0, "全量零通知");
    const byId = (rows: typeof base, id: string) => rows.filter((r) => r.eventId === EV(id));
    ok(byId(base, "m1")[0]?.attribution.rule === "R3" && byId(base, "m1")[0]?.attribution.bucket === "sales", "m1 → 成员（销售）");
    ok(byId(base, "w1")[0]?.attribution.rule === "R2", "w1 → 网站（账号命中，不区分大小写）");
    ok(byId(base, "u1")[0]?.attribution.rule === "R4", "u1 → 不明");
    ok(byId(base, "q1")[0]?.attribution.rule === "R1" && byId(base, "q1")[0]?.attribution.userId === REP, "q1 → 青砚预约（创建人 REP）");
    ok(base.every((r) => r._userId === READER && r._targetId === `${CAL}/${r.eventId}`), "账本 userId = 读取账号，targetId = 日历/事件");

    console.log("\n[5] 增量：新建 / 修改 / 删除 / 青砚推送");
    const m2 = g({ id: EV("m2"), created: edt("2026-10-29T10:00:00"), creator: OPS_PRIVATE, summary: "回访 — Example C", start: edt("2026-11-04T10:00:00"), end: edt("2026-11-04T11:00:00") });
    const m3 = g({ id: EV("m3"), created: edt("2026-10-29T10:01:00"), creator: REP_GOOGLE, summary: "量房 — Example D", description: "客户电话 416-555-0100", start: edt("2026-11-05T10:00:00"), end: edt("2026-11-05T11:00:00") });
    const m1moved = g({ id: EV("m1"), created: edt("2026-10-10T09:00:00"), updated: edt("2026-10-29T10:05:00"), creator: email(REP), summary: "量房 — Example A", start: edt("2026-10-30T16:00:00"), end: edt("2026-10-30T17:00:00") });
    const w2 = g({ id: EV("w2"), created: edt("2026-10-29T10:06:00"), creator: STRANGER, summary: "Consultation", description: "Booked via example site /book-now", start: edt("2026-11-06T10:00:00"), end: edt("2026-11-06T11:00:00") });
    const q1gone = g({ id: EV("q1"), status: "cancelled", updated: edt("2026-10-29T10:07:00") });
    const q2 = g({ id: EV("q2"), created: edt("2026-10-29T10:10:00"), updated: edt("2026-10-29T10:10:05"), creator: email(READER), summary: "🔧 安装 Example E", start: edt("2026-11-02T10:00:00"), end: edt("2026-11-02T12:00:00") });
    const incPage = [m2, m3, m1moved, w2, q1gone, q2];
    scripts[CAL] = (o) => {
      if (o.syncToken === "s1") return { changes: incPage, nextPageToken: null, nextSyncToken: "s2" };
      throw new Error(`unexpected token ${o.syncToken}`);
    };
    await run();
    const inc = await ledgerRows();
    ok(inc.length === 10, "增量新记 6 条（共 10）", inc.length);
    const last = (id: string) => byId(inc, id).at(-1)!;
    ok(last("m2").kind === "created" && last("m2").attribution.userId === OPSLEAD && last("m2").attribution.bucket === "ops", "m2 别名命中 → 运营主管、ops 桶");
    ok(last("m3").attribution.userId === REP && last("m3").attribution.rule === "R3", "m3 日历连接邮箱命中 → REP");
    ok(!last("m3")._raw.includes("416-555-0100"), "账本不含描述");
    ok(last("m1").kind === "updated" && last("m1").diff?.some((d) => d.field === "start"), "m1 修改记 diff");
    ok(last("w2").attribution.rule === "R2", "w2 描述含网站标记 → 网站");
    ok(last("q1").kind === "cancelled" && last("q1").attribution.rule === "R1" && last("q1").summary === "📏 量房 Example B" && last("q1").editedVia === null, "q1 Google 侧删除：沿用标题、R1、非经青砚");
    ok(last("q2").kind === "created" && last("q2").attribution.source === "qingyan", "q2 青砚推送的新建");

    const all = await notes();
    const to = (id: string) => all.filter((n) => n.entityId === `${CAL}/${EV(id)}`).map((n) => n.userId).sort();
    ok(JSON.stringify(to("m2")) === JSON.stringify([OWNER]), "m2 新建只发老板（创建者运营主管本人不收）", to("m2"));
    ok(JSON.stringify(to("m3")) === JSON.stringify([OPSLEAD, OWNER].sort()), "m3 新建发老板与运营主管（创建者 REP 不收）", to("m3"));
    const moved = all.filter((n) => n.entityId === `${CAL}/${EV("m1")}`);
    ok(moved.length === 2 && moved.every((n) => n.title.includes("14:00 → 16:00") && n.title.includes("修改人未知")), "m1 改时间：两条，正文含 14:00 → 16:00 与修改人未知", moved.map((n) => n.title));
    ok(all.filter((n) => n.entityId === `${CAL}/${EV("w2")}`).every((n) => n.title.startsWith("【网站预约】")) && to("w2").length === 2, "w2 网站预约文案");
    ok(JSON.stringify(to("q1")) === JSON.stringify([OPSLEAD, OWNER, REP].sort()), "q1 删除：岗位持有人 + 预约负责人", to("q1"));
    ok(to("q2").length === 0, "q2 青砚来源新建不通知");
    ok(all.length === 10, "共 10 条通知", all.length);
    ok(all.every((n) => n.type === "calendar_event" && n.sourceKey?.startsWith(`calwatch:${ORG}:`)), "通知类型与 sourceKey");

    console.log("\n[6] 重放幂等 + 青砚推送修改 + 只改描述");
    const q2pushed = g({ id: EV("q2"), created: edt("2026-10-29T10:10:00"), updated: edt("2026-10-29T10:20:00"), creator: email(READER), summary: "🔧 安装 Example E", start: edt("2026-11-02T13:00:00"), end: edt("2026-11-02T15:00:00") });
    const m3desc = g({ id: EV("m3"), created: edt("2026-10-29T10:01:00"), updated: edt("2026-10-29T10:30:00"), creator: REP_GOOGLE, summary: "量房 — Example D", description: "改了描述", start: edt("2026-11-05T10:00:00"), end: edt("2026-11-05T11:00:00") });
    scripts[CAL] = (o) => {
      if (o.syncToken === "s2") return { changes: [...incPage, q2pushed, m3desc], nextPageToken: null, nextSyncToken: "s3" };
      throw new Error(`unexpected token ${o.syncToken}`);
    };
    await run();
    const rep = await ledgerRows();
    ok(rep.length === 12, "同一批变更重放不新增；只新增 q2 推送修改与 m3 描述修改", rep.length);
    ok(byId(rep, "q2").at(-1)?.editedVia === "qingyan", "q2 修改标为经青砚");
    ok((await notes()).length === 10, "通知条数不变（重放、青砚推送、只改描述都不通知）", (await notes()).length);

    console.log("\n[7] 410 → 清空游标，下一轮全量不重复记账");
    scripts[CAL] = (o) => {
      if (o.syncToken) throw new GoogleSyncTokenExpiredError();
      return { changes: [m1moved, w1, u1, m2, m3desc, w2, q2pushed], nextPageToken: null, nextSyncToken: "s9" };
    };
    await run();
    const c410 = await cursorOf();
    ok(c410?.phase === "full" && c410.syncToken === null && c410.lastError === "sync_token_expired", "410 → 游标清空、阶段回到全量", c410);
    await run();
    const cFull = await cursorOf();
    ok(cFull?.phase === "incremental" && cFull.syncToken === "s9", "下一轮从头全量并转回增量", cFull);
    ok((await ledgerRows()).length === 12 && (await notes()).length === 10, "重做全量不新增账本与通知");

    console.log("\n[8] 授权失效：当天只通知一次");
    scripts[CAL] = () => {
      throw new GoogleTokenExpiredError();
    };
    await run();
    await run();
    const cTok = await cursorOf();
    ok(cTok?.lastError === "token_expired" && cTok.syncToken === "s9", "lastError = token_expired，令牌保留", cTok);
    const rc = await db.notification.findMany({ where: { userId: READER, sourceKey: { startsWith: "calwatch:reconnect:" } } });
    ok(rc.length === 1 && rc[0].title.includes("重新连接") && rc[0].sourceKey!.endsWith(":2026-10-29"), "读取账号只收到一条重连通知（按当地日期）", rc.map((n) => n.sourceKey));

    console.log("\n[9] 一个组织出错不影响另一个");
    const m4 = g({ id: EV("m4"), created: edt("2026-10-29T10:40:00"), creator: email(REP), summary: "安装 — Example F", start: edt("2026-11-07T10:00:00"), end: edt("2026-11-07T11:00:00") });
    scripts[CAL] = (o) => {
      if (o.syncToken === "s9") return { changes: [m4], nextPageToken: null, nextSyncToken: "s10" };
      throw new Error(`unexpected token ${o.syncToken}`);
    };
    scripts[CAL_B] = () => {
      throw new Error("org B exploded");
    };
    const both = await run([ORG_B, ORG]);
    const resB = both.results.find((r) => r.orgId === ORG_B);
    const resA = both.results.find((r) => r.orgId === ORG);
    ok(both.organizations === 2 && both.failedCount === 1 && Boolean(resB?.calendars[0]?.error), "结果列出出错组织", both.results);
    ok(resA?.calendars[0]?.recorded === 1 && !resA.calendars[0].error && (await cursorOf()).syncToken === "s10", "另一个组织照常处理", resA);
    ok(calls.some((c) => c.userId === READER_B && c.calendarId === CAL_B), "第二个组织用自己的读取账号");

    console.log("\n[9b] 读取账号离开企业 → 不再用其授权读取");
    await db.organizationMember.updateMany({ where: { orgId: ORG_B, userId: READER_B }, data: { status: "inactive" } });
    const callsB = calls.filter((c) => c.userId === READER_B).length;
    const gone = await run([ORG_B]);
    ok(gone.results[0]?.error === "reader_not_member" && gone.failedCount === 1, "结果标 reader_not_member", gone.results);
    ok(calls.filter((c) => c.userId === READER_B).length === callsB, "没有再调用读取函数");

    console.log("\n[10] 统计接口");
    const OCT = `?orgId=${ORG}&from=2026-10-01&to=2026-10-31`;
    ok((await statsCall(PLAIN, OCT)).status === 403, "无 sales.analytics.read → 403");
    const bad = await statsCall(OWNER, `?orgId=${ORG}&from=2026-10-31&to=2026-10-01`);
    ok(bad.status === 400 && bad.body?.code === "INVALID_PERIOD", "期间不合法 → 400 INVALID_PERIOD");
    const org = await statsCall(OWNER, OCT);
    const bs = org.body?.bySource as Json;
    ok(org.status === 200 && JSON.stringify(bs) === JSON.stringify({ qingyan: 2, member: 4, website: 2, unknown: 1 }), "bySource：青砚 2、成员 4、网站 2、不明 1", org.body);
    const actors = org.body?.byActor as Array<Json>;
    const repRow = actors?.find((a) => a.userId === REP);
    const opsRow = actors?.find((a) => a.userId === OPSLEAD);
    ok(repRow?.created === 5 && repRow.updated === 3 && repRow.cancelled === 1 && repRow.bucket === "sales", "REP：新建 5、修改 3、删除 1", repRow);
    ok(opsRow?.created === 1 && opsRow.bucket === "ops", "运营主管：新建 1", opsRow);
    const samples = org.body?.unknownSamples as Array<Json>;
    ok(samples?.length === 1 && samples[0].creatorEmail === STRANGER, "不明来源样例含创建者邮箱", samples);
    ok(org.body?.truncated === false && org.body?.enabled === true && (org.body?.period as Json)?.days === 31, "truncated = false，enabled = true，期间 31 天");
    const own = await statsCall(REP, OCT);
    const ownActors = own.body?.byActor as Array<Json>;
    ok(own.status === 200 && own.body?.scope === "own" && ownActors?.length === 1 && ownActors[0].userId === REP && ownActors[0].created === 5, "销售只看本人一行", own.body);
    ok(!("bySource" in (own.body ?? {})) && !("unknownSamples" in (own.body ?? {})), "本人范围无 bySource 与 unknownSamples");
    ok(!own.text.includes("@") && !own.text.includes("cwops"), "本人范围不含邮箱与他人姓名");

    console.log("\n[10b] 基线前日程被改、重复系列单次例外、同一事件在两个观察日历");
    const addCal2 = await saveCalendarWatchSettings({ orgId: ORG, actorUserId: OWNER, body: { calendarIds: [CAL, CAL2] }, deps: visible([CAL, CAL2]) });
    ok(addCal2.ok && (await cursorOf())?.syncToken === "s10" && (await cursorOf(ORG, CAL2)) === undefined, "新增第二个日历：原日历游标保留，新日历从全量开始", addCal2);
    const oldMoved = g({ id: EV("old0_"), created: edt("2026-05-01T09:00:00"), updated: edt("2026-10-29T11:00:00"), creator: email(REP), summary: "历史日程 0", start: est("2026-11-10T16:00:00"), end: est("2026-11-10T17:00:00") });
    const series = g({ id: EV("r1"), created: edt("2026-10-20T09:00:00"), creator: email(REP), summary: "每周例会", start: edt("2026-10-22T15:00:00"), end: edt("2026-10-22T16:00:00") });
    const excId = `${EV("r1")}_20261105T190000Z`;
    const exc = mapGoogleEvent({ id: excId, recurringEventId: EV("r1"), status: "confirmed", created: edt("2026-10-20T09:00:00"), updated: edt("2026-10-29T11:01:00"), creator: { email: email(REP) }, summary: "每周例会", start: { dateTime: est("2026-11-05T16:00:00") }, end: { dateTime: est("2026-11-05T17:00:00") } })!;
    const x1 = g({ id: EV("x1"), created: edt("2026-10-29T11:02:00"), creator: BOOKING, summary: "Measure — Shared Invite", start: edt("2026-11-08T10:00:00"), end: edt("2026-11-08T11:00:00") });
    scripts[CAL] = (o) => {
      if (o.syncToken === "s10") return { changes: [series], nextPageToken: null, nextSyncToken: "s11" };
      if (o.syncToken === "s11") return { changes: [oldMoved, exc, x1], nextPageToken: null, nextSyncToken: "s12" };
      throw new Error(`unexpected token ${o.syncToken}`);
    };
    scripts[CAL2] = (o) => {
      if (!o.syncToken) return { changes: [], nextPageToken: null, nextSyncToken: "t1" };
      if (o.syncToken === "t1") return { changes: [x1], nextPageToken: null, nextSyncToken: "t2" };
      throw new Error(`unexpected token ${o.syncToken}`);
    };
    await run(); // CAL：系列新建；CAL2：全量（空）→ 增量
    const notesBefore = (await notes()).length;
    const r2nd = await run(); // CAL：基线前改动 + 单次例外 + x1；CAL2：x1
    const rows2 = await ledgerRows();
    const om = rows2.filter((r) => r.eventId === EV("old0_"));
    ok(om.length === 1 && om[0].kind === "updated" && om[0].firstObserved === true, "基线前日程被改 → updated、firstObserved", om);
    const omNotes = (await notes()).filter((n) => n.entityId === `${CAL}/${EV("old0_")}`);
    ok(omNotes.length === 2 && omNotes.every((n) => n.title.includes("现为 11/10 16:00–17:00") && n.title.includes("修改人未知")), "基线前日程被改照常通知（按现值）", omNotes.map((n) => n.title));
    const ex = rows2.filter((r) => r.eventId === excId);
    ok(ex.length === 1 && ex[0].kind === "updated" && ex[0].attribution.userId === REP, "单次例外记 updated（不冒充新建）、归因系列创建者", ex);
    const exNotes = (await notes()).filter((n) => n.entityId === `${CAL}/${excId}`);
    ok(exNotes.length === 2 && exNotes.every((n) => n.title.startsWith("【日程改动】") && n.title.includes("现为 11/5 16:00–17:00")), "单次例外通知为改动、时间是这一次的", exNotes.map((n) => n.title));
    const xr = rows2.filter((r) => r.eventId === EV("x1"));
    ok(xr.length === 2 && new Set(xr.map((r) => r.calendarId)).size === 2, "x1 在两个日历各记一条账本");
    const xNotes = (await notes()).filter((n) => n.metadata && JSON.stringify(n.metadata).includes(EV("x1")));
    ok(xNotes.length === 2 && new Set(xNotes.map((n) => n.userId)).size === 2, "x1 每位收件人只收一条", xNotes.map((n) => [n.userId, n.entityId]));
    ok((await notes()).length - notesBefore === 6 && r2nd.notified === 6, "本轮新增通知 6 条，计数只算新建的", { added: (await notes()).length - notesBefore, notified: r2nd.notified });
    const after = await statsCall(OWNER, OCT);
    ok(JSON.stringify(after.body?.bySource) === JSON.stringify({ qingyan: 2, member: 5, website: 3, unknown: 1 }), "统计：系列新建 +1 成员、x1 跨日历只计 1、例外与基线前改动不计新建", after.body?.bySource);

    console.log("\n[11] GET 不含令牌；关闭开关回滚不丢游标");
    const g1 = await settingsCall(OWNER, "GET");
    ok(g1.status === 200 && !g1.text.includes("syncToken") && !g1.text.includes("pageToken") && !g1.text.includes("s12") && !g1.text.includes("t2"), "GET 无 syncToken / pageToken 字样", g1.text.slice(0, 400));
    const cals = (g1.body?.settings as Json)?.calendars as Array<Json>;
    ok(cals?.[0]?.phase === "incremental" && cals[0].calendarId === CAL, "GET 显示日历阶段");
    const off = await settingsCall(OWNER, "PUT", { enabled: false });
    ok(off.status === 200 && (off.body?.settings as Json)?.enabled === false, "PUT { enabled: false } → 200（不查 Google）", off.body);
    ok((await cursorOf())?.syncToken === "s12" && (await cursorOf(ORG, CAL2))?.syncToken === "t2", "关闭后游标仍在");
    const callsBefore = calls.length;
    const idle = await run();
    ok(idle.organizations === 0 && calls.length === callsBefore, "关闭后执行器不处理该组织");

    console.log("\n[12] 只读 Google");
    const src = readFileSync("src/lib/calendar-watch/run.ts", "utf8");
    ok(!/pushEventToGoogle|updateGoogleEvent|deleteGoogleEvent|events\.(insert|patch|update|delete|move)/.test(src), "执行器不引用任何 Google 写接口");
    ok(calls.every((c) => Object.keys(c).every((k) => ["userId", "calendarId", "syncToken", "pageToken"].includes(k))), "读取调用只带日历与令牌");
    ok((await apptSnapshot()) === apptBefore, "预约表未被改动");
  } finally {
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG_B] } }] } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG_B] } }] } });
    await db.appointment.deleteMany({ where: { customerId: CUST } });
    await db.salesCustomer.deleteMany({ where: { id: CUST } });
    await db.calendarProvider.deleteMany({ where: { userId: { in: users } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\n日历观察 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
