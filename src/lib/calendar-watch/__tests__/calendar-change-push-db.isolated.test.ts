/**
 * CAL-3：日历变更推送——真实 DB（隔离库）+ CAL-1 执行器 + 注入的假 Google 读取与假微信推送（spec calendar/change-push）
 *
 *   首次全量零推送；Muse 关 → 全部站内 + 每人一次微信、正文无邮箱；Muse 开 + 已绑定 → 只有 Muse 事件（Bridge 拉得到）；
 *   企业不在放行名单 → 站内；中断重放与渠道切换不重发不重推；推送失败不影响其它人与账本；
 *   通知键过长 / 摘要会被出站脱敏时回落站内；授权失效当天只推一次且不走 Muse；
 *   推送返回失败计数；同一事件在两个观察日历只送一次；每轮推送上限；缺省推送函数在非生产计为跳过。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/calendar-watch/__tests__/calendar-change-push-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import type { CalendarChangesPage as Page } from "@/lib/google-calendar";

function skip(reason: string): never {
  console.log(`⏭  跳过日历变更推送 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CAL-3 calendar change push DB test" });

delete process.env.MUSE_BRIDGE_ENABLED;
delete process.env.MUSE_BRIDGE_ORG_ALLOWLIST;

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

/** 多伦多 10 月为 UTC−4 */
const edt = (local: string) => new Date(`${local}-04:00`).toISOString();

async function main() {
  const { db } = await import("@/lib/db");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { GoogleTokenExpiredError } = await import("@/lib/google-calendar");
  const { NonProdSideEffectDisabledError } = await import("@/lib/env/runtime-isolation");
  const { mapGoogleEvent } = await import("@/lib/calendar-watch/pure");
  const { runCalendarWatch } = await import("@/lib/calendar-watch/run");
  const { saveCalendarWatchSettings } = await import("@/lib/calendar-watch/settings");
  const { withMuseBinding } = await import("@/lib/muse-bridge/binding-pure");
  const { listMuseEvents } = await import("@/lib/muse-bridge/events");

  const stamp = Date.now().toString(36);
  const OWNER = `cpowner_${stamp}`;
  const OPSLEAD = `cpops_${stamp}`;
  const READER = `cpreader_${stamp}`;
  const users = [OWNER, OPSLEAD, READER];
  const ORG = `cporg_${stamp}`;
  const CAL = `pushcal_${stamp}@group.calendar.google.com`;
  const CAL2 = `pushcal2_${stamp}@group.calendar.google.com`;
  const EV = (n: string) => `${n}${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const STRANGER = `stranger.${stamp}@example.test`;
  const NOW = new Date(edt("2026-10-29T11:00:00"));

  for (const id of users) {
    await db.user.create({ data: { id, email: email(id), name: `Example ${id.split("_")[0]}`, role: "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Push Fixture", code: `cpo-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  for (const userId of users) await db.organizationMember.create({ data: { orgId: ORG, userId, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  for (const [userId, key] of [[OWNER, "owner"], [OPSLEAD, "ops_lead"]] as const) {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  }
  await db.calendarProvider.create({ data: { type: "google", name: "Google", userId: READER, accessToken: "fake", accountEmail: email(READER) } });

  // ── 假 Google：CAL 每轮返回 page、CAL2 返回 page2；假微信：记录每次调用，可按收件人抛错或返回失败 ──
  let page: Page = { changes: [], nextPageToken: null, nextSyncToken: "s0" };
  let page2: Page = { changes: [], nextPageToken: null, nextSyncToken: "t0" };
  let readError: Error | null = null;
  const readChanges = async (_userId: string, opts: { calendarId: string }): Promise<Page> => {
    if (readError) throw readError;
    return opts.calendarId === CAL2 ? page2 : page;
  };
  const pushes: Array<{ userId: string; title: string; content: string }> = [];
  const throwFor = new Map<string, Error>();
  const failFor = new Set<string>();
  const pushWechat = async (userId: string, title: string, content: string) => {
    const err = throwFor.get(userId);
    if (err) throw err;
    if (failFor.has(userId)) return { sent: 0, failed: 1 };
    pushes.push({ userId, title, content });
    return { sent: 1, failed: 0 };
  };
  const run = (extra: { maxWechatPushes?: number; defaultPush?: boolean } = {}) =>
    runCalendarWatch({ readChanges, pushWechat: extra.defaultPush ? undefined : pushWechat, maxWechatPushes: extra.maxWechatPushes, orgIds: [ORG], now: () => NOW });

  const g = (p: { id: string; created: string; updated?: string; creator?: string; summary: string; start: string; end: string }) =>
    mapGoogleEvent({
      id: p.id,
      status: "confirmed",
      created: p.created,
      updated: p.updated ?? p.created,
      creator: p.creator ? { email: p.creator } : undefined,
      summary: p.summary,
      start: { dateTime: p.start },
      end: { dateTime: p.end },
    })!;

  const notesFor = (eventId: string) =>
    db.notification.findMany({ where: { orgId: ORG, sourceKey: { contains: `:${eventId}:` } }, orderBy: { createdAt: "asc" } });
  const ledgerCount = () => db.auditLog.count({ where: { orgId: ORG, action: "calendar.watch.observed" } });
  const setBinding = async (ref: string, userId: string | null) => {
    const org = await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
    const next = withMuseBinding(org?.settingsJson ?? null, ref, userId ? { userId, boundAt: NOW.toISOString(), boundBy: OWNER } : null);
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: next as object } });
  };

  try {
    const saved = await saveCalendarWatchSettings({
      orgId: ORG,
      actorUserId: OWNER,
      body: { enabled: true, readerUserId: READER, calendarIds: [CAL, CAL2] },
      deps: {
        listCalendars: async () => [CAL, CAL2].map((id) => ({ id, summary: id, backgroundColor: "", foregroundColor: "", primary: false, accessRole: "reader", selected: true })),
        hasProvider: async () => true,
      },
    });
    ok(saved.ok, "开启日历观察", saved);

    console.log("\n[1] 首次全量零推送");
    const b1 = g({ id: EV("b1"), created: edt("2026-10-20T09:00:00"), creator: STRANGER, summary: "量房 — Example A", start: edt("2026-10-30T14:00:00"), end: edt("2026-10-30T15:00:00") });
    page = { changes: [b1], nextPageToken: null, nextSyncToken: "s1" };
    const r0 = await run();
    ok(r0.recorded === 1 && r0.notified === 0 && pushes.length === 0 && r0.wechatSent === 0, "全量记 1 条、零通知、零推送", r0);

    console.log("\n[2] Muse 关：站内 + 每人一次微信，正文无邮箱");
    const b1moved = g({ id: EV("b1"), created: edt("2026-10-20T09:00:00"), updated: edt("2026-10-29T10:05:00"), creator: STRANGER, summary: "量房 — Example A", start: edt("2026-10-30T16:00:00"), end: edt("2026-10-30T17:00:00") });
    const n1 = g({ id: EV("n1"), created: edt("2026-10-29T10:06:00"), creator: STRANGER, summary: "外部日程", start: edt("2026-11-03T10:00:00"), end: edt("2026-11-03T11:00:00") });
    await setBinding("muse_owner", OWNER); // 已绑定但 Muse 关：仍走站内
    page = { changes: [b1moved, n1], nextPageToken: null, nextSyncToken: "s2" };
    const r1 = await run();
    const b1Notes = await notesFor(EV("b1"));
    const n1Notes = await notesFor(EV("n1"));
    ok(b1Notes.length === 2 && b1Notes.every((n) => n.category === "calendar_watch"), "修改：老板与运营主管各一条 calendar_watch", b1Notes.map((n) => [n.userId, n.category]));
    ok(n1Notes.length === 2 && n1Notes.every((n) => n.category === "calendar_watch" && (n.summary ?? "").includes(STRANGER)), "新建：站内摘要仍含创建者邮箱（CAL-1 不变）", n1Notes.map((n) => n.summary));
    ok(pushes.length === 4 && new Set(pushes.map((p) => p.userId)).size === 2 && pushes.every((p) => [OWNER, OPSLEAD].includes(p.userId)), "4 次推送：每条变更每位收件人一次", pushes.map((p) => p.userId));
    ok(pushes.every((p) => !p.title.includes("@") && !p.content.includes("@")), "推送标题与正文不含邮箱", pushes);
    ok(pushes.some((p) => p.title.includes("14:00 → 16:00") && p.title.includes("修改人未知")), "修改推送含前后值与修改人未知", pushes.map((p) => p.title));
    ok(pushes.some((p) => p.title.startsWith("【日程新增】") && p.content === "来源：来源不明（R4）"), "新建推送正文只有来源与规则", pushes.map((p) => p.content));
    ok(r1.notified === 4 && r1.muse === 0 && r1.wechatSent === 4 && r1.wechatFailed === 0, "运行结果：通知 4、Muse 0、微信成功 4", r1);

    console.log("\n[3] 重放：零新增、零推送");
    const r2 = await run();
    ok(r2.notified === 0 && pushes.length === 4, "同一批变更再跑一次不新增、不推送", { r2: r2.notified, pushes: pushes.length });

    console.log("\n[4] Muse 开 + 老板已绑定：老板只有 Muse 事件");
    process.env.MUSE_BRIDGE_ENABLED = "1";
    const n2 = g({ id: EV("n2"), created: edt("2026-10-29T10:10:00"), creator: STRANGER, summary: "回访 — Example B", start: edt("2026-11-04T10:00:00"), end: edt("2026-11-04T11:00:00") });
    page = { changes: [n2], nextPageToken: null, nextSyncToken: "s3" };
    const before4 = pushes.length;
    const r3 = await run();
    const n2Notes = await notesFor(EV("n2"));
    const ownerN2 = n2Notes.filter((n) => n.userId === OWNER);
    const opsN2 = n2Notes.filter((n) => n.userId === OPSLEAD);
    ok(ownerN2.length === 1 && ownerN2[0].category === "muse_bridge" && ownerN2[0].type === "calendar_event", "老板：一条 muse_bridge（站内类型 calendar_event），没有 calendar_watch", ownerN2.map((n) => [n.category, n.type]));
    ok(ownerN2[0]?.title.startsWith("【日程新增】") && !ownerN2[0]?.title.includes("@") && !(ownerN2[0]?.summary ?? "").includes("@"), "Muse 站内通知标题为 CAL-1 标题、无邮箱", [ownerN2[0]?.title, ownerN2[0]?.summary]);
    ok(opsN2.length === 1 && opsN2[0].category === "calendar_watch", "运营主管未绑定：calendar_watch", opsN2.map((n) => n.category));
    const pulled = await listMuseEvents({ userId: OWNER, orgId: ORG });
    const ev = pulled.events.find((e) => e.type === "calendar.changed");
    ok(Boolean(ev) && ev!.eventId === ownerN2[0]?.sourceKey?.replace(/^muse:/, "") && ev!.eventId.startsWith(`calwatch:${ORG}:${EV("n2")}:`) && !ev!.action, "Bridge 拉到 calendar.changed，eventId = CAL-1 通知键，无动作", ev);
    ok(pushes.length - before4 === 2 && r3.muse === 1 && r3.notified === 2 && r3.wechatSent === 2, "两人都推微信；运行结果 Muse 1、通知 2", { pushed: pushes.length - before4, r3 });

    console.log("\n[5] 中断重放 + 渠道切换：不重发、不重推");
    // 模拟上一轮发完通知、写账本前中断：删掉 n2 的账本，换渠道后同一变更再来
    await db.auditLog.deleteMany({ where: { orgId: ORG, action: "calendar.watch.observed", targetId: `${CAL}/${EV("n2")}` } });
    delete process.env.MUSE_BRIDGE_ENABLED; // 老板这轮会选站内
    await setBinding("muse_ops", OPSLEAD); // 运营主管刚绑定（Muse 关，仍站内）
    const before5 = pushes.length;
    const ledger5 = await ledgerCount();
    const r4 = await run();
    ok((await notesFor(EV("n2"))).length === 2 && pushes.length === before5 && r4.notified === 0, "Muse 关闭后重放：老板不补 calendar_watch，零推送", { notes: (await notesFor(EV("n2"))).length, r4 });
    ok((await ledgerCount()) === ledger5 + 1, "账本照常补记", { before: ledger5, after: await ledgerCount() });
    await db.auditLog.deleteMany({ where: { orgId: ORG, action: "calendar.watch.observed", targetId: `${CAL}/${EV("n2")}` } });
    process.env.MUSE_BRIDGE_ENABLED = "1"; // 运营主管这轮会选 Muse
    const r5 = await run();
    ok((await notesFor(EV("n2"))).length === 2 && pushes.length === before5 && r5.notified === 0 && r5.muse === 0, "Muse 开启后重放：运营主管不补 Muse 事件，零推送", { notes: (await notesFor(EV("n2"))).map((n) => [n.userId, n.category]), r5 });
    await setBinding("muse_ops", null);

    console.log("\n[6] 企业不在放行名单 → 站内");
    process.env.MUSE_BRIDGE_ORG_ALLOWLIST = "some_other_org";
    const n3 = g({ id: EV("n3"), created: edt("2026-10-29T10:20:00"), creator: STRANGER, summary: "安装 — Example C", start: edt("2026-11-05T10:00:00"), end: edt("2026-11-05T12:00:00") });
    page = { changes: [n3], nextPageToken: null, nextSyncToken: "s4" };
    const r6 = await run();
    const n3Notes = await notesFor(EV("n3"));
    ok(n3Notes.length === 2 && n3Notes.every((n) => n.category === "calendar_watch") && r6.muse === 0, "老板已绑定但企业未放行：calendar_watch", n3Notes.map((n) => [n.userId, n.category]));
    delete process.env.MUSE_BRIDGE_ORG_ALLOWLIST;

    console.log("\n[7] 推送失败不影响其它人与账本");
    throwFor.set(OWNER, new Error("adapter down"));
    const n4 = g({ id: EV("n4"), created: edt("2026-10-29T10:30:00"), creator: STRANGER, summary: "量房 — Example D", start: edt("2026-11-06T10:00:00"), end: edt("2026-11-06T11:00:00") });
    page = { changes: [n4], nextPageToken: null, nextSyncToken: "s5" };
    const before7 = pushes.length;
    const ledger7 = await ledgerCount();
    const r7 = await run();
    ok(r7.failedCount === 0 && r7.wechatFailed === 1 && r7.wechatSent === 1, "运行成功；微信失败 1、成功 1", r7);
    ok(pushes.length - before7 === 1 && pushes.at(-1)?.userId === OPSLEAD, "运营主管照常收到推送", pushes.slice(before7));
    ok((await notesFor(EV("n4"))).length === 2 && (await ledgerCount()) === ledger7 + 1, "两条通知都建了，账本照记");
    throwFor.set(OWNER, new NonProdSideEffectDisabledError(undefined, "wechat"));
    const n5 = g({ id: EV("n5"), created: edt("2026-10-29T10:31:00"), creator: STRANGER, summary: "量房 — Example E", start: edt("2026-11-07T10:00:00"), end: edt("2026-11-07T11:00:00") });
    page = { changes: [n5], nextPageToken: null, nextSyncToken: "s6" };
    const r8 = await run();
    ok(r8.results[0]?.calendars[0]?.wechatSkipped === 1 && r8.wechatFailed === 0 && r8.wechatSent === 1, "非生产禁用外发计为跳过、不算失败", r8.results[0]?.calendars[0]);
    throwFor.clear();

    console.log("\n[8] 通知键过长 → 回落站内");
    const longId = `l${"0".repeat(210)}${stamp}`;
    const nl = g({ id: longId, created: edt("2026-10-29T10:40:00"), creator: STRANGER, summary: "长 ID 日程", start: edt("2026-11-08T10:00:00"), end: edt("2026-11-08T11:00:00") });
    page = { changes: [nl], nextPageToken: null, nextSyncToken: "s7" };
    const r9 = await run();
    const longNotes = await notesFor(longId);
    ok(longNotes.length === 2 && longNotes.every((n) => n.category === "calendar_watch") && r9.muse === 0 && r9.wechatSent === 2, "老板已绑定、Muse 开，但信封不成立 → calendar_watch 且照推微信", { cats: longNotes.map((n) => n.category), r9 });

    console.log("\n[9] 授权失效：当天只推一次，不走 Muse");
    await setBinding("muse_reader", READER);
    readError = new GoogleTokenExpiredError();
    const before9 = pushes.length;
    await run();
    await run();
    const readerPushes = pushes.slice(before9);
    ok(readerPushes.length === 1 && readerPushes[0].userId === READER && readerPushes[0].title.includes("重新连接"), "读取账号只收到一次微信推送", readerPushes);
    const reconnect = await db.notification.findMany({ where: { orgId: ORG, userId: READER } });
    ok(reconnect.length === 1 && reconnect[0].category === "calendar_watch", "重新连接提醒仍是一条 calendar_watch（读取账号已绑定也不走 Muse）", reconnect.map((n) => n.category));
    readError = null;

    console.log("\n[10] 推送返回失败计数");
    failFor.add(OWNER);
    const n6 = g({ id: EV("n6"), created: edt("2026-10-29T10:41:00"), creator: STRANGER, summary: "量房 — Example F", start: edt("2026-11-09T10:00:00"), end: edt("2026-11-09T11:00:00") });
    page = { changes: [n6], nextPageToken: null, nextSyncToken: "s8" };
    const r10 = await run();
    ok(r10.wechatFailed === 1 && r10.wechatSent === 1, "适配器失败（返回 failed）计入失败数", r10);
    failFor.clear();

    console.log("\n[11] 同一事件在两个观察日历：每人只送一次");
    const x1 = g({ id: EV("x1"), created: edt("2026-10-29T10:42:00"), creator: STRANGER, summary: "安装 — Example G", start: edt("2026-11-10T10:00:00"), end: edt("2026-11-10T12:00:00") });
    page = { changes: [x1], nextPageToken: null, nextSyncToken: "s9" };
    page2 = { changes: [x1], nextPageToken: null, nextSyncToken: "t9" };
    const before11 = pushes.length;
    const ledger11 = await ledgerCount();
    const r11 = await run();
    const x1Notes = await notesFor(EV("x1"));
    ok((await ledgerCount()) === ledger11 + 2 && x1Notes.length === 2 && new Set(x1Notes.map((n) => n.userId)).size === 2, "账本按日历各记一条，每位收件人一条通知", { ledger: (await ledgerCount()) - ledger11, notes: x1Notes.map((n) => [n.userId, n.category]) });
    ok(pushes.length - before11 === 2 && r11.notified === 2, "每位收件人只推一次", { pushed: pushes.length - before11, r11: r11.notified });
    page2 = { changes: [], nextPageToken: null, nextSyncToken: "t10" };

    console.log("\n[12] 摘要会被出站脱敏 → 已绑定的人也走站内");
    const mg = g({ id: EV("mg"), created: edt("2026-10-29T10:43:00"), creator: STRANGER, summary: "Margin trim install", start: edt("2026-11-11T10:00:00"), end: edt("2026-11-11T11:00:00") });
    page = { changes: [mg], nextPageToken: null, nextSyncToken: "s10" };
    const r12 = await run();
    const mgOwner = (await notesFor(EV("mg"))).filter((n) => n.userId === OWNER);
    ok(mgOwner.length === 1 && mgOwner[0].category === "calendar_watch" && mgOwner[0].title.includes("Margin trim install") && r12.muse === 0, "老板（已绑定、Muse 开）收到完整的 calendar_watch，不是脱敏提示", mgOwner.map((n) => [n.category, n.title]));

    console.log("\n[13] 每轮推送上限");
    const c1 = g({ id: EV("c1"), created: edt("2026-10-29T10:44:00"), creator: STRANGER, summary: "量房 — Example H", start: edt("2026-11-12T10:00:00"), end: edt("2026-11-12T11:00:00") });
    const c2 = g({ id: EV("c2"), created: edt("2026-10-29T10:45:00"), creator: STRANGER, summary: "量房 — Example I", start: edt("2026-11-12T13:00:00"), end: edt("2026-11-12T14:00:00") });
    page = { changes: [c1, c2], nextPageToken: null, nextSyncToken: "s11" };
    const before13 = pushes.length;
    const r13 = await run({ maxWechatPushes: 1 });
    ok(r13.notified === 4 && pushes.length - before13 === 1 && r13.wechatCapped === 3, "4 条新通知只推 1 条，其余 3 条计为超额，通知照建", { notified: r13.notified, pushed: pushes.length - before13, capped: r13.wechatCapped });

    console.log("\n[14] 缺省推送函数：非生产禁用外发计为跳过");
    const d1 = g({ id: EV("d1"), created: edt("2026-10-29T10:46:00"), creator: STRANGER, summary: "回访 — Example J", start: edt("2026-11-13T10:00:00"), end: edt("2026-11-13T11:00:00") });
    page = { changes: [d1], nextPageToken: null, nextSyncToken: "s12" };
    const r14 = await run({ defaultPush: true });
    ok(r14.failedCount === 0 && r14.notified === 2 && r14.wechatSkipped === 2 && r14.wechatFailed === 0 && r14.wechatSent === 0, "走真实 pushSalesReminder：测试环境被拦下，计跳过 2、不算失败", r14);
  } finally {
    delete process.env.MUSE_BRIDGE_ENABLED;
    delete process.env.MUSE_BRIDGE_ORG_ALLOWLIST;
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.calendarProvider.deleteMany({ where: { userId: { in: users } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\n日历变更推送 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
