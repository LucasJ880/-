/**
 * W-2 组织页「询价与落地价设置」——页面产出的请求体走真实接口（隔离库）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/settings-form-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不调任何模型，不发任何请求。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 W-2 询价与落地价设置 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "W-2 tender rfq settings page DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const route = await import("@/app/api/organizations/[orgId]/tender-rfq-settings/route");
  const { bodyFromForm, formFromView } = await import("../settings-form");
  type View = import("../settings-form").TenderRfqSettingsView;

  console.log("W-2 tender rfq settings page — isolated DB");
  const stamp = Date.now().toString(36);
  const ADMIN = `w2admin_${stamp}`, MEMBER = `w2member_${stamp}`, OUTSIDER = `w2out_${stamp}`;
  const ORG = `w2org_${stamp}`, ORG_DIRECT = `w2orgd_${stamp}`, ORG_B = `w2orgb_${stamp}`;
  const users = [ADMIN, MEMBER, OUTSIDER];
  const orgs = [ORG, ORG_DIRECT, ORG_B];
  const email = (id: string) => `${id}@fixture.test`;
  const ENV_FROM = "rfq-env-default@fixture.test";
  const prevEnv = process.env.TENDER_RFQ_FROM_EMAIL;
  process.env.TENDER_RFQ_FROM_EMAIL = ENV_FROM;
  const projectIds: string[] = [];

  const STORED = {
    tenderRfq: {
      fromName: "Fixture Procurement",
      mailboxEmail: "owner@fixture.test",
      landedCost: { fxRates: { USD: 1.36 }, fxAsOf: "2026-11-10", fxSource: "MANUAL", freightEstimate: { mode: "per_unit", value: 6 }, insurancePct: 1, clearanceFlatCad: 150, projects: {} as Rec },
    },
    museBridge: { keep: "untouched" },
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
  const stored = async (orgId: string) => rec((await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }))?.settingsJson);
  /** 页面的做法：读 → 表单 → 改 → bodyFromForm → PUT */
  const pageSave = async (orgId: string, mut: (f: ReturnType<typeof formFromView>) => ReturnType<typeof formFromView>) => {
    const v = (await get(orgId)).body as unknown as View;
    const initial = formFromView(v);
    const r = bodyFromForm(mut(formFromView(v)), initial);
    if (!r.ok) return { r, res: null };
    if (r.empty) return { r, res: null };
    return { r, res: await put(orgId, r.body) };
  };

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
    for (const id of orgs) await db.organization.create({ data: { id, name: `Fixture Org ${id}`, code: id, ownerId: id === ORG_B ? OUTSIDER : ADMIN, settingsJson: JSON.parse(JSON.stringify(STORED)) } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_DIRECT, userId: ADMIN, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });
    const mkProject = async (orgId: string, owner: string) => {
      const id = `w2proj_${stamp}_${projectIds.length + 1}`;
      projectIds.push(id);
      await db.project.create({ data: { id, name: `Fixture Tender ${id}`, orgId, ownerId: owner, workDomain: "tender", intakeStatus: "dispatched" } });
      return id;
    };
    const P1 = await mkProject(ORG, ADMIN);
    const P2 = await mkProject(ORG, ADMIN);
    const PD = await mkProject(ORG_DIRECT, ADMIN);
    const PB = await mkProject(ORG_B, OUTSIDER);

    /* ---------- 1. 读 ---------- */
    let g = await get(ORG);
    ok(g.status === 200 && g.body.fromEmail === ENV_FROM && g.body.mailboxEmail === "owner@fixture.test", "管理员读：显示地址没存，按环境变量回退显示；授权邮箱是存的值", g.body);

    /* ---------- 2. 只改保险费率 ---------- */
    const s1 = await pageSave(ORG, (f) => ({ ...f, insurancePct: "1.5" }));
    ok(!!s1.res && s1.res.status === 200 && JSON.stringify(s1.r.ok && s1.r.body) === JSON.stringify({ landedCost: { insurancePct: 1.5 } }), "页面只改保险费率：请求里只有这一项，保存成功", s1);
    let st = await stored(ORG);
    const trq = rec(st.tenderRfq);
    ok(rec(trq.landedCost).insurancePct === 1.5 && !("fromEmail" in trq) && trq.mailboxEmail === "owner@fixture.test" && trq.fromName === "Fixture Procurement", "库里只有保险费率变了；显示地址没有被写死成环境变量的值", trq);
    ok(JSON.stringify(rec(trq.landedCost).fxRates) === JSON.stringify({ USD: 1.36 }) && rec(trq.landedCost).clearanceFlatCad === 150 && JSON.stringify(rec(st.museBridge)) === JSON.stringify({ keep: "untouched" }), "汇率、清关、组织设置里的其它键都没动");
    g = await get(ORG);
    ok(g.body.fromEmail === ENV_FROM, "读回来显示地址仍按环境变量回退");

    /* ---------- 3. 与直接调接口的效果相同 ---------- */
    const bodyFor = (f: ReturnType<typeof formFromView>, init: ReturnType<typeof formFromView>) => { const r = bodyFromForm(f, init); if (!r.ok || r.empty) throw new Error("unexpected"); return r.body; };
    const vD = (await get(ORG_DIRECT)).body as unknown as View;
    const initD = formFromView(vD);
    const editD = { ...formFromView(vD), mailboxEmail: "Rfq.Box@Fixture.test", clearanceFlatCad: "", fxRows: [{ currency: "USD", rate: "1.38" }, { currency: "EUR", rate: "1.49" }], fxAsOf: "2026-11-14", projects: [{ projectId: PD, dutyRatePct: "6.5", deliveryDeadline: "2026-12-20" }] };
    const bD = bodyFor(editD, initD);
    const viaPage = await pageSave(ORG, (f) => ({ ...f, mailboxEmail: "Rfq.Box@Fixture.test", clearanceFlatCad: "", fxRows: [{ currency: "USD", rate: "1.38" }, { currency: "EUR", rate: "1.49" }], fxAsOf: "2026-11-14", insurancePct: "1.5", projects: [{ projectId: P1, dutyRatePct: "6.5", deliveryDeadline: "2026-12-20" }] }));
    const direct = await put(ORG_DIRECT, bD);
    ok(viaPage.res?.status === 200 && direct.status === 200, "页面保存与直接调接口都成功");
    const a = rec(rec(await stored(ORG)).tenderRfq), b = rec(rec(await stored(ORG_DIRECT)).tenderRfq);
    const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as Rec).sort().map((k) => [k, sortKeys((v as Rec)[k])])) : v);
    const norm = (t: Rec, pid: string) => JSON.stringify(sortKeys({ ...t, landedCost: { ...rec(t.landedCost), insurancePct: 1.5, projects: { X: rec(rec(t.landedCost).projects)[pid] } } }));
    ok(norm(a, P1) === norm(b, PD), "两边库里的设置相同（项目 id 与保险费率换算一致后比较）", { a, b });
    ok(a.mailboxEmail === "rfq.box@fixture.test" && rec(a.landedCost).clearanceFlatCad === null && rec(rec(a.landedCost).fxRates).USD === 1.38 && rec(rec(a.landedCost).fxRates).EUR === 1.49 && Object.keys(rec(rec(a.landedCost).fxRates)).length === 2 && rec(a.landedCost).fxAsOf === "2026-11-14" && rec(a.landedCost).fxSource === "MANUAL", "授权邮箱转小写；清关清空；汇率整张替换；日期更新；来源没改仍是手工", a);
    g = await get(ORG);
    ok(rec(g.body.landedCost).clearanceFlatCad === null && JSON.stringify(rec(rec(rec(g.body.landedCost).projects)[P1])) === JSON.stringify({ dutyRatePct: 6.5, deliveryDeadline: "2026-12-20" }), "读回来：清关为空，项目关税率与交付截止在", g.body);

    /* ---------- 4. 项目：改、加、删；别的组织的项目被拒 ---------- */
    const s4 = await pageSave(ORG, (f) => ({ ...f, projects: [{ projectId: P2, dutyRatePct: "8", deliveryDeadline: "" }] }));
    st = await stored(ORG);
    const projs = rec(rec(rec(st.tenderRfq).landedCost).projects);
    ok(s4.res?.status === 200 && !(P1 in projs) && JSON.stringify(projs[P2]) === JSON.stringify({ dutyRatePct: 8, deliveryDeadline: null }), "删掉 P1、加上 P2（关税率 8%，没有交付截止）", projs);
    const s4b = await pageSave(ORG, (f) => ({ ...f, projects: [...f.projects, { projectId: PB, dutyRatePct: "5", deliveryDeadline: "" }] }));
    ok(s4b.res?.status === 400 && String(s4b.res.body.error).includes("不属于本组织") && !(PB in rec(rec(rec(rec(await stored(ORG)).tenderRfq).landedCost).projects)), "加别的组织的项目：接口拒绝（400），什么都没写", s4b.res);

    /* ---------- 5. 汇率没有日期与来源：页面先拦 ---------- */
    const s5 = await pageSave(ORG, (f) => ({ ...f, fxAsOf: "", fxRows: [{ currency: "USD", rate: "1.4" }] }));
    ok(!s5.r.ok && s5.res === null, "清空汇率日期但还有汇率：页面不发请求", s5.r);

    /* ---------- 6. 没改动 ---------- */
    const before6 = JSON.stringify(await stored(ORG));
    const s6 = await pageSave(ORG, (f) => f);
    ok(s6.r.ok && s6.r.empty && s6.res === null && JSON.stringify(await stored(ORG)) === before6, "什么都没改：不发请求，库里不变");

    /* ---------- 7. 谁能读、能存 ---------- */
    const before7 = JSON.stringify(await stored(ORG));
    ok((await get(ORG, MEMBER)).status === 403 && (await put(ORG, { landedCost: { insurancePct: 9 } }, MEMBER)).status === 403, "普通成员读、存：403");
    ok((await get(ORG, OUTSIDER)).status === 403 && (await put(ORG, { landedCost: { insurancePct: 9 } }, OUTSIDER)).status === 403, "别的组织的管理员读、存：403");
    ok(JSON.stringify(await stored(ORG)) === before7, "403 之后库里不变");

    /* ---------- 8. 审计 ---------- */
    const audits = await db.auditLog.count({ where: { orgId: ORG, action: "tender_rfq_settings:update" } });
    ok(audits >= 3, "每次保存都记了审计", audits);
  } finally {
    if (prevEnv === undefined) delete process.env.TENDER_RFQ_FROM_EMAIL;
    else process.env.TENDER_RFQ_FROM_EMAIL = prevEnv;
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { userId: { in: users } }] } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nW-2 tender rfq settings page DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
