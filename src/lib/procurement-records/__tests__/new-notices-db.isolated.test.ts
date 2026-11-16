/**
 * P2-1 收尾：新标视图、公告链接、改扫描时间——真实接口 + 隔离库
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/procurement-records/__tests__/new-notices-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不发任何外部请求、不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-1 新标视图 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-1 new notices DB test" });
process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "1";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const candidatesRoute = await import("@/app/api/procurement/candidates/route");
  const watchRoute = await import("@/app/api/procurement/watch/route");
  const followRoute = await import("@/app/api/procurement/instruments/[id]/follow/route");
  const { scheduleBodyIfChanged, scheduleFormOf, applyPreset } = await import("../new-notices-pure");

  console.log("P2-1 new notices — isolated DB");
  const stamp = Date.now().toString(36);
  const ADMIN = `nnadmin_${stamp}`, MEMBER = `nnmember_${stamp}`, OUTSIDER = `nnout_${stamp}`;
  const ORG = `nnorg_${stamp}`, ORG_B = `nnorgb_${stamp}`;
  const users = [ADMIN, MEMBER, OUTSIDER];
  const orgs = [ORG, ORG_B];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  const now = new Date();
  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const getJson = async (h: unknown, url: string, uid: string, params: Rec = {}) => {
    const res = await (h as (r: unknown, c: unknown) => Promise<Response>)(new NextRequest(`http://localhost${url}`, { headers: { cookie: await cookie(uid) } }), { params: Promise.resolve(params) });
    return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Rec };
  };
  let seq = 0;
  const mkInst = async (orgId: string, o: Rec = {}) => {
    seq += 1;
    const num = `NN${stamp}${seq}`;
    const inst = await db.procurementInstrument.create({
      data: {
        orgId, jurisdiction: "CA-FED", instrumentClass: "SOLICITATION", officialNumber: num, normalizedNumber: num.toLowerCase(),
        procuringEntityKey: "pspc", dedupeKey: `CA-FED|pspc|SOLICITATION|${num.toLowerCase()}`, title: `Fixture notice ${seq}`,
        publishedAt: new Date(now.getTime() - seq * DAY), closingAt: new Date(now.getTime() + 20 * DAY), triageStatus: "CANDIDATE", origin: "SCAN",
        priorityJson: { score: seq * 10, dimensions: [] }, ...o,
      } as never,
    });
    return inst.id;
  };
  const mkEv = (orgId: string, instrumentId: string, sourceType: string, sourceUrl: string | null, ageDays: number) =>
    db.procurementSourceEvidence.create({ data: { orgId, instrumentId, sourceType, sourceKey: `${sourceType}:${instrumentId}:${ageDays}`, sourceUrl, isOfficial: true, contentHash: `h${ageDays}${instrumentId}`, fetchedAt: new Date(now.getTime() - ageDays * DAY), lastSeenAt: now, parseStatus: "PARSED" } });

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id.split("_")[0]}`, role: "user" } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Shutters", code: `nn-${stamp}`, ownerId: ADMIN } });
    await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `nnb-${stamp}`, ownerId: OUTSIDER } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

    // 新标：A（3 天前发布）、B（1 天前，已关注）、C（没有发布日期）、D（截标未知）
    const A = await mkInst(ORG, { publishedAt: new Date(now.getTime() - 3 * DAY), priorityJson: { score: 90 } });
    const B = await mkInst(ORG, { publishedAt: new Date(now.getTime() - 1 * DAY), triageStatus: "WATCHING", priorityJson: { score: 10 } });
    const C = await mkInst(ORG, { publishedAt: null, priorityJson: { score: 99 } });
    const D = await mkInst(ORG, { publishedAt: new Date(now.getTime() - 2 * DAY), closingAt: null });
    // 不该出现：已截标、合同、被忽略、归档、别的组织
    const CLOSED = await mkInst(ORG, { publishedAt: new Date(now.getTime() - DAY / 2), closingAt: new Date(now.getTime() - 1000) });
    const AWARD = await mkInst(ORG, { instrumentClass: "AWARD_INSTRUMENT", publishedAt: new Date(now.getTime() - DAY / 3) });
    const IGN = await mkInst(ORG, { publishedAt: new Date(now.getTime() - DAY / 4), triageStatus: "IGNORED" });
    const ARCH = await mkInst(ORG, { publishedAt: new Date(now.getTime() - DAY / 5), triageStatus: "ARCHIVED" });
    const OTHER = await mkInst(ORG_B, { publishedAt: new Date(now.getTime() - DAY / 6) });
    await mkEv(ORG, A, "OPEN_CANADA_CONTRACTS", "https://open.canada.ca/x", 0);
    await mkEv(ORG, A, "CANADABUYS_TENDER_NOTICES", "https://canadabuys.canada.ca/a-new", 1);
    await mkEv(ORG, A, "CANADABUYS_TENDER_NOTICES", "https://canadabuys.canada.ca/a-old", 4);
    await mkEv(ORG, B, "CANADABUYS_TENDER_NOTICES", null, 0);

    /* ---------- 1. 新标视图 ---------- */
    const r = await getJson(candidatesRoute.GET, `/api/procurement/candidates?orgId=${ORG}&view=new`, MEMBER);
    const items = (r.body.items ?? []) as Rec[];
    const ids = items.map((x) => x.id);
    ok(r.status === 200 && JSON.stringify(ids) === JSON.stringify([B, D, A, C]), "新标视图：只列未截标（含截标未知）、没被忽略 / 归档的招标公告；按发布日期新到旧，没有发布日期的排最后；不按优先级重排", { ids, expect: [B, D, A, C] });
    ok(![CLOSED, AWARD, IGN, ARCH, OTHER].some((x) => ids.includes(x)), "已截标、合同、被忽略、归档、别的组织都不出现");
    const a = items.find((x) => x.id === A) as Rec;
    ok(a.noticeUrl === "https://canadabuys.canada.ca/a-new" && typeof a.publishedAt === "string", "公告链接取最新一条 CanadaBuys；带发布日期", a);
    ok((items.find((x) => x.id === B) as Rec).noticeUrl === null && (items.find((x) => x.id === C) as Rec).publishedAt === null, "没有链接、没有发布日期的都是空");
    const all = await getJson(candidatesRoute.GET, `/api/procurement/candidates?orgId=${ORG}`, MEMBER);
    const allIds = ((all.body.items ?? []) as Rec[]).map((x) => x.id);
    ok(allIds.includes(CLOSED) && allIds.includes(AWARD) && allIds.indexOf(C) < allIds.indexOf(A) && allIds.indexOf(A) < allIds.indexOf(B), "全部视图照旧：含合同与已截标，按优先级排", allIds);
    ok(((all.body.items ?? []) as Rec[]).every((x) => "noticeUrl" in x && "publishedAt" in x), "全部视图每行也带 noticeUrl / publishedAt");
    const q = await getJson(candidatesRoute.GET, `/api/procurement/candidates?orgId=${ORG}&view=new&q=${encodeURIComponent(`NN${stamp}1`)}`, MEMBER);
    ok(((q.body.items ?? []) as Rec[]).every((x) => String(x.officialNumber).startsWith(`NN${stamp}1`)) && ((q.body.items ?? []) as Rec[]).length >= 1, "新标视图也能按编号搜");
    const b = await getJson(candidatesRoute.GET, `/api/procurement/candidates?orgId=${ORG}&view=new`, OUTSIDER);
    ok(b.status !== 200 || !((b.body.items ?? []) as Rec[]).some((x) => x.id === A), "别的组织的人看不到本组织的新标", b.status);

    /* ---------- 2. 公告链接与跟标一致 ---------- */
    const f = await (followRoute.POST as unknown as (r: unknown, c: unknown) => Promise<Response>)(new NextRequest(`http://localhost/api/procurement/instruments/${A}/follow`, { method: "POST", headers: { cookie: await cookie(MEMBER) } }), { params: Promise.resolve({ id: A }) });
    const fj = (await f.json()) as Rec;
    const proj = await db.project.findUnique({ where: { id: String(fj.projectId) }, select: { sourceMetadataJson: true } });
    ok(JSON.parse(proj?.sourceMetadataJson ?? "{}").noticeUrl === a.noticeUrl, "候选里的公告链接与跟标建出的项目里的相同");

    /* ---------- 3. 改扫描时间 ---------- */
    const w0 = await getJson(watchRoute.GET, `/api/procurement/watch?orgId=${ORG}`, ADMIN);
    const view0 = rec(w0.body.watch);
    const initial = scheduleFormOf(rec(view0.config).schedule as never);
    ok(JSON.stringify(initial) === JSON.stringify({ weekdays: [1, 4], time: "08:00" }) && String(view0.scheduleText).startsWith("每周一、周四 08:00"), "默认：周一、周四 08:00", { initial, text: view0.scheduleText });
    const sb = scheduleBodyIfChanged(applyPreset(initial, "daily"), initial);
    const put = async (body: unknown, uid = ADMIN) => {
      const res = await watchRoute.PUT(new NextRequest(`http://localhost/api/procurement/watch?orgId=${ORG}`, { method: "PUT", headers: { cookie: await cookie(uid), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({}) } as never);
      return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Rec };
    };
    const p1 = await put({ schedule: sb.ok ? sb.schedule : null, filters: { keywords: ["curtain"] } });
    const w1 = await getJson(watchRoute.GET, `/api/procurement/watch?orgId=${ORG}`, ADMIN);
    const v1 = rec(w1.body.watch);
    ok(p1.status === 200 && JSON.stringify(rec(v1.config).schedule) === JSON.stringify({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0 }) && String(v1.scheduleText).startsWith("每天 08:00"), "页面点「每天」保存：读回七天、08:00，说明写「每天」", { p1: p1.status, v1: rec(v1.config).schedule, text: v1.scheduleText });
    // 只改关键词：页面算出的请求里没有排期，排期不被覆盖
    const sb2 = scheduleBodyIfChanged(scheduleFormOf(rec(v1.config).schedule as never), scheduleFormOf(rec(v1.config).schedule as never));
    const p2 = await put({ ...(sb2.ok && sb2.schedule ? { schedule: sb2.schedule } : {}), filters: { keywords: ["curtain", "blind"] } });
    const w2 = await getJson(watchRoute.GET, `/api/procurement/watch?orgId=${ORG}`, ADMIN);
    ok(p2.status === 200 && sb2.ok && sb2.schedule === undefined && JSON.stringify(rec(rec(w2.body.watch).config).schedule) === JSON.stringify({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0 }), "只改关键词：请求里没有排期，排期不变");
    // 启用后下一次运行在 24 小时内
    const en = await (await import("@/app/api/procurement/watch/enable/route")).POST(new NextRequest(`http://localhost/api/procurement/watch/enable?orgId=${ORG}`, { method: "POST", headers: { cookie: await cookie(ADMIN) } }), { params: Promise.resolve({}) } as never);
    const w3 = await getJson(watchRoute.GET, `/api/procurement/watch?orgId=${ORG}`, ADMIN);
    const next = new Date(String(rec(w3.body.watch).nextRunAt));
    ok(en.status === 200 && next.getTime() > Date.now() && next.getTime() - Date.now() <= DAY + 60_000, "改成每天并启用：下一次运行在 24 小时内", rec(w3.body.watch).nextRunAt);
    // 工作日的说明文字
    await put({ schedule: { weekdays: [1, 2, 3, 4, 5], hour: 6, minute: 0 } });
    const w4 = await getJson(watchRoute.GET, `/api/procurement/watch?orgId=${ORG}`, ADMIN);
    ok(String(rec(w4.body.watch).scheduleText).startsWith("每个工作日 06:00"), "工作日：说明写「每个工作日」", rec(w4.body.watch).scheduleText);
    // 普通成员不能改
    const pm = await put({ schedule: { weekdays: [0], hour: 1, minute: 0 } }, MEMBER);
    const w5 = await getJson(watchRoute.GET, `/api/procurement/watch?orgId=${ORG}`, ADMIN);
    ok(pm.status === 403 && JSON.stringify(rec(rec(w5.body.watch).config).schedule) === JSON.stringify({ weekdays: [1, 2, 3, 4, 5], hour: 6, minute: 0 }), "普通成员改排期：403，不变", pm.status);
  } finally {
    const pids = (await db.project.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { userId: { in: users } }] } });
    await db.calendarEvent.deleteMany({ where: { projectId: { in: pids } } });
    await db.procurementTenderLink.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementSourceEvidence.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementInstrument.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementScanRun.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementWatch.deleteMany({ where: { orgId: { in: orgs } } });
    await db.projectMessage.deleteMany({ where: { projectId: { in: pids } } });
    await db.environment.deleteMany({ where: { projectId: { in: pids } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: pids } } });
    await db.project.deleteMany({ where: { id: { in: pids } } });
    await db.notification.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
