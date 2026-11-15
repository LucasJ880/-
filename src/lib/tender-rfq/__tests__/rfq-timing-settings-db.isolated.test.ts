/**
 * W-2b 询价节奏三项——页面产出的请求体走真实接口（隔离库），读回来的值就是建轮次 / 催单此刻会用的值
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不调任何模型，不发任何请求。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 W-2b 询价节奏 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "W-2b rfq timing settings DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
/** jsonb 会重排键：按内容比较 */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const route = await import("@/app/api/organizations/[orgId]/tender-rfq-settings/route");
  const { bodyFromForm, formFromView } = await import("../settings-form");
  const { readTenderRfqSettings, decideRoundLock } = await import("../round-pure");
  const { resolveChaseAfterDays } = await import("../chase-pure");
  const { computeReplyBy } = await import("../build");
  const { readUserPrefs } = await import("@/lib/muse-bridge/prefs-pure");
  const { loadRfqWebEntry } = await import("../web-entry");
  type View = import("../settings-form").TenderRfqSettingsView;

  console.log("W-2b rfq timing settings — isolated DB");
  const stamp = Date.now().toString(36);
  const ADMIN = `w2badmin_${stamp}`, MEMBER = `w2bmember_${stamp}`, OWNER = `w2bowner_${stamp}`;
  const ORG = `w2borg_${stamp}`, ORG_B = `w2borgb_${stamp}`;
  const PROJ = `w2bproj_${stamp}`;
  const MAILBOX = `w2b-mailbox-${stamp}@fixture.test`;
  const supplierIds: string[] = [];
  const users = [ADMIN, MEMBER, OWNER];
  const orgs = [ORG, ORG_B];
  const email = (id: string) => `${id}@fixture.test`;
  const STORED = {
    tenderRfq: { fromName: "Fixture Procurement", mailboxEmail: MAILBOX, landedCost: { insurancePct: 1, projects: {} } },
    museBridge: { userPrefs: { [OWNER]: { defaultSupplierIds: [], defaultIncoterm: null, chaseAfterDays: 8, lastUpdatedAt: null } }, keep: "untouched" },
  };

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const get = async (orgId: string, userId = ADMIN) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/organizations/${orgId}/tender-rfq-settings`, { headers: { cookie: await cookie(userId) } }), { params: Promise.resolve({ orgId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const put = async (orgId: string, body: unknown, userId = ADMIN) => {
    const res = await route.PUT(new NextRequest(`http://localhost/api/organizations/${orgId}/tender-rfq-settings`, { method: "PUT", headers: { cookie: await cookie(userId), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const settings = async (orgId: string) => (await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }))?.settingsJson ?? null;
  const tr = async (orgId: string) => rec(rec(await settings(orgId)).tenderRfq);
  const pageSave = async (orgId: string, mut: (f: ReturnType<typeof formFromView>) => ReturnType<typeof formFromView>) => {
    const v = (await get(orgId)).body as unknown as View;
    const r = bodyFromForm(mut(formFromView(v)), formFromView(v));
    if (!r.ok || r.empty) return { r, res: null };
    return { r, res: await put(orgId, r.body) };
  };
  const timing = (b: Rec) => rec(b.timing);
  const st = (b: Rec) => rec(b.stored);

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
    for (const id of orgs) await db.organization.create({ data: { id, name: `Fixture Org ${id}`, code: id, ownerId: ADMIN, settingsJson: JSON.parse(JSON.stringify(STORED)) } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: ADMIN, role: "org_admin", status: "active" } });
    // 真实取数（loadRfqWebEntry）用的夹具：一个招投标项目（负责人 ADMIN，本人没设催单天数），4 天前建的第 1 轮已发出给 1 家；授权邮箱有读信权限
    const realNow = new Date();
    await db.project.create({ data: { id: PROJ, name: "Fixture Tender W2b", orgId: ORG, ownerId: ADMIN, workDomain: "tender", intakeStatus: "dispatched", closeDate: new Date(realNow.getTime() + 30 * 86400000) } as never });
    const sup = await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${stamp}`, contactEmail: `w2bsup-${stamp}@supplier-fixture.test`, status: "active", createdById: ADMIN } as never });
    supplierIds.push(sup.id);
    const inq = await db.projectInquiry.create({ data: { projectId: PROJ, roundNumber: 1, status: "in_progress", createdById: ADMIN, createdAt: new Date(realNow.getTime() - 4 * 86400000) } as never });
    await db.inquiryItem.create({ data: { inquiryId: inq.id, supplierId: sup.id, createdById: ADMIN, status: "sent", sentAt: new Date(realNow.getTime() - 4 * 86400000) } as never });
    await db.emailProvider.create({ data: { userId: ADMIN, type: "gmail", accessToken: "fixture-not-a-token", accountEmail: MAILBOX, grantedScopes: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose" } });
    const entry = async () => (await loadRfqWebEntry({ projectId: PROJ, orgId: ORG, userId: ADMIN })) as unknown as Rec;
    const e0 = await entry();
    ok(rec(e0.state).reason !== "recently_sent", "默认轮次锁 3 天：4 天前发的一轮不锁（真实取数）", e0.state);
    ok(String(rec(e0.autoIngest).message).includes("3 天没回"), "默认催单天数 3（真实取数）", e0.autoIngest);

    /* ---------- 1. 读：没存 = 默认 ---------- */
    let g = await get(ORG);
    ok(g.status === 200 && JSON.stringify(timing(g.body)) === JSON.stringify({ replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 }), "什么都没存：生效值 7 / 3 / 3", g.body);
    ok(JSON.stringify(g.body.timingDefaults) === JSON.stringify({ replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 }), "默认值 7 / 3 / 3");
    ok(st(g.body).replyLeadDays === false && st(g.body).roundLockDays === false && st(g.body).chaseAfterDays === false, "三项都没存", g.body.stored);
    ok(timing(g.body).chaseAfterDays === 3, "负责人个人偏好 8 天不算组织层");

    /* ---------- 2. 页面只改回复提前量 ---------- */
    const s1 = await pageSave(ORG, (f) => ({ ...f, timing: { ...f.timing, replyLeadDays: "10" } }));
    ok(!!s1.res && s1.res.status === 200 && JSON.stringify(s1.r.ok && s1.r.body) === JSON.stringify({ replyLeadDays: 10 }), "页面只改回复提前量：请求里只有这一项，保存成功", s1);
    ok(timing(s1.res!.body).replyLeadDays === 10 && st(s1.res!.body).replyLeadDays === true, "PUT 返回的就是新的生效值", s1.res?.body);
    const t = await tr(ORG);
    ok(t.replyLeadDays === 10 && !("roundLockDays" in t) && !("chaseAfterDays" in t) && t.fromName === "Fixture Procurement" && rec(t.landedCost).insurancePct === 1, "库里只多了 replyLeadDays；别的不变", t);
    ok(canon(rec(rec(await settings(ORG)).museBridge)) === canon(STORED.museBridge), "个人偏好与 museBridge 的其它键没动");
    const resolved = readTenderRfqSettings(await settings(ORG));
    const now = new Date("2026-11-01T12:00:00Z");
    ok(resolved.replyLeadDays === 10 && computeReplyBy("2026-11-30T12:00:00Z", now, resolved.replyLeadDays)?.startsWith("2026-11-20") === true, "建轮次读到 10 天：截标 11-30 → 回复截止 11-20", resolved);
    ok((await tr(ORG_B)).replyLeadDays === undefined, "别的组织不受影响");

    /* ---------- 3. 与直接调接口相同 ---------- */
    const dir = await put(ORG_B, { replyLeadDays: 10 });
    const a = await get(ORG), b = await get(ORG_B);
    ok(dir.status === 200 && JSON.stringify(a.body.timing) === JSON.stringify(b.body.timing) && JSON.stringify(a.body.stored) === JSON.stringify(b.body.stored), "页面保存与直接调接口读回来相同", { a: a.body.timing, b: b.body.timing });

    /* ---------- 4. 轮次锁、催单天数 ---------- */
    const s2 = await pageSave(ORG, (f) => ({ ...f, timing: { ...f.timing, roundLockDays: "5", chaseAfterDays: "4" } }));
    ok(!!s2.res && s2.res.status === 200 && JSON.stringify(s2.r.ok && s2.r.body) === JSON.stringify({ roundLockDays: 5, chaseAfterDays: 4 }), "改轮次锁 5、催单 4：只发这两项", s2);
    const sj = await settings(ORG);
    const lockDays = readTenderRfqSettings(sj).roundLockDays;
    const round = { inquiryId: "i1", roundNumber: 1, status: "sent", createdAt: new Date(now.getTime() - 4 * 86400000), createdByName: "Fixture", sentCount: 2, hasPendingSend: false };
    ok(lockDays === 5 && decideRoundLock([round], now, lockDays).locked === true && decideRoundLock([round], now, 3).locked === false, "轮次锁读到 5 天：4 天前发的一轮仍锁（默认 3 天时不锁）", decideRoundLock([round], now, lockDays));
    ok(resolveChaseAfterDays(null, sj) === 4, "组织层催单天数 4");
    ok(resolveChaseAfterDays(readUserPrefs(sj, OWNER).chaseAfterDays, sj) === 8, "项目负责人自己设了 8 天：仍按个人设置");
    ok(resolveChaseAfterDays(readUserPrefs(sj, MEMBER).chaseAfterDays, sj) === 4, "负责人没设：按组织 4 天");
    const e1 = await entry();
    ok(rec(e1.state).reason === "recently_sent" && String(rec(e1.state).message).includes("5 天内不开新轮"), "真实取数：轮次锁读到 5 天，4 天前发的一轮锁住", e1.state);
    ok(String(rec(e1.autoIngest).message).includes("4 天没回"), "真实取数：催单天数读到组织的 4 天", e1.autoIngest);
    ok(JSON.stringify(rec(s2.res!.body).timingDefaults) === JSON.stringify({ replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 }), "存了之后默认值仍是 7 / 3 / 3", s2.res?.body.timingDefaults);

    /* ---------- 5. 清空回到默认 ---------- */
    const s3 = await pageSave(ORG, (f) => ({ ...f, timing: { ...f.timing, chaseAfterDays: "" } }));
    ok(!!s3.res && s3.res.status === 200 && JSON.stringify(s3.r.ok && s3.r.body) === JSON.stringify({ chaseAfterDays: null }), "清空催单天数：发 null", s3);
    g = await get(ORG);
    ok(timing(g.body).chaseAfterDays === 3 && st(g.body).chaseAfterDays === false && timing(g.body).roundLockDays === 5, "读回来是默认 3、算没存；轮次锁仍是 5", g.body);
    ok(resolveChaseAfterDays(null, await settings(ORG)) === 3, "催单扫描读到默认 3");
    ok(formFromView(g.body as unknown as View).timing.chaseAfterDays === "", "页面上显示为空");
    ok(String(rec((await entry()).autoIngest).message).includes("3 天没回"), "真实取数：清空后催单天数回到 3");

    /* ---------- 6. 不合规 ---------- */
    const before = JSON.stringify(await settings(ORG));
    for (const bad of [{ roundLockDays: 0 }, { chaseAfterDays: 2.5 }, { replyLeadDays: 61 }, { replyLeadDays: "10" }, { roundLockDays: -1 }]) {
      const r = await put(ORG, bad);
      ok(r.status === 400, `PUT ${JSON.stringify(bad)} → 400`, r);
    }
    ok(JSON.stringify(await settings(ORG)) === before, "不合规的请求都没改设置");

    /* ---------- 7. 普通成员 ---------- */
    ok((await put(ORG, { chaseAfterDays: 9 }, MEMBER)).status === 403, "普通成员 PUT → 403");
    ok((await get(ORG, MEMBER)).status === 403, "普通成员 GET → 403");
    ok(JSON.stringify(await settings(ORG)) === before, "设置不变");

    /* ---------- 8. 审计 ---------- */
    const audits = await db.auditLog.findMany({ where: { orgId: ORG, action: "tender_rfq_settings:update" }, orderBy: { createdAt: "asc" } });
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
    const last = rec(rec(parse(audits[audits.length - 1]?.afterData)).tenderRfq);
    ok(audits.length === 3 && last.chaseAfterDays === null && last.roundLockDays === 5 && last.replyLeadDays === 10, "每次保存都记审计（3 次），最后一次的保存后含这三项", { n: audits.length, last });
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { userId: { in: users } }] } });
    await db.emailProvider.deleteMany({ where: { userId: { in: users } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: PROJ } } });
    await db.projectInquiry.deleteMany({ where: { projectId: PROJ } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.project.deleteMany({ where: { id: PROJ } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
