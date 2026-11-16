/**
 * P2-3a「跟这个标」——真实接口 + 隔离库：建出的项目、只建一次（含并发）、不能跟的情况、与手工新建相同
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/procurement-records/__tests__/tender-follow-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不发任何外部请求、不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-3a 跟标 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-3a tender follow DB test" });
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
  const followRoute = await import("@/app/api/procurement/instruments/[id]/follow/route");
  const projectsRoute = await import("@/app/api/projects/route");
  const candidatesRoute = await import("@/app/api/procurement/candidates/route");
  const { followButtonState } = await import("../tender-follow-pure");

  console.log("P2-3a tender follow — isolated DB");
  const stamp = Date.now().toString(36);
  const ADMIN = `fladmin_${stamp}`, MEMBER = `flmember_${stamp}`, MEMBER2 = `flmember2_${stamp}`, VIEWER = `flviewer_${stamp}`, OUTSIDER = `flout_${stamp}`;
  const ORG = `florg_${stamp}`, ORG_B = `florgb_${stamp}`, ORG_ARCH = `florga_${stamp}`;
  const users = [ADMIN, MEMBER, MEMBER2, VIEWER, OUTSIDER];
  const orgs = [ORG, ORG_B, ORG_ARCH];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  const now = new Date();
  const createdProjects: string[] = [];
  let DEL_ID = "", DEL_PROJECT = "";

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const follow = async (id: string, uid = MEMBER) => {
    const res = await followRoute.POST(new NextRequest(`http://localhost/api/procurement/instruments/${id}/follow`, { method: "POST", headers: { cookie: await cookie(uid) } }), { params: Promise.resolve({ id }) });
    const body = (await res.json().catch(() => null)) as Rec | null;
    if (body && typeof body.projectId === "string") createdProjects.push(body.projectId);
    return { status: res.status, body: body ?? {} };
  };
  let seq = 0;
  const mkInst = async (orgId: string, o: Rec = {}) => {
    seq += 1;
    const num = `WS${stamp}${seq}`;
    const inst = await db.procurementInstrument.create({
      data: {
        orgId, jurisdiction: "CA-FED", instrumentClass: "SOLICITATION", officialNumber: num, normalizedNumber: num.toLowerCase(),
        procuringEntityKey: "pspc", dedupeKey: `CA-FED|pspc|SOLICITATION|${num.toLowerCase()}`, title: `Fixture privacy curtains ${seq}`,
        contractingInstitution: "Fixture PSPC", buyingInstitution: "Fixture Health Agency", publishedAt: new Date(now.getTime() - 3 * DAY),
        closingAt: new Date(now.getTime() + 20 * DAY), triageStatus: "CANDIDATE", origin: "SCAN", ...o,
      } as never,
    });
    return inst.id;
  };
  const mkEvidence = (orgId: string, instrumentId: string, sourceType: string, sourceUrl: string, ageDays: number) =>
    db.procurementSourceEvidence.create({
      data: { orgId, instrumentId, sourceType, sourceKey: `${sourceType}:${instrumentId}:${ageDays}`, sourceUrl, isOfficial: true, contentHash: `h${ageDays}${instrumentId}`, fetchedAt: new Date(now.getTime() - ageDays * DAY), lastSeenAt: now, parseStatus: "PARSED" },
    });

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id.split("_")[0]}`, role: "user" } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Shutters", code: `fl-${stamp}`, ownerId: ADMIN } });
    await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `flb-${stamp}`, ownerId: OUTSIDER } });
    await db.organization.create({ data: { id: ORG_ARCH, name: "Archived Fixture Org", code: `fla-${stamp}`, ownerId: ADMIN, status: "archived" } as never });
    for (const [orgId, userId, role] of [[ORG, ADMIN, "org_admin"], [ORG, MEMBER, "org_member"], [ORG, MEMBER2, "org_member"], [ORG, VIEWER, "org_viewer"], [ORG_B, OUTSIDER, "org_admin"], [ORG_ARCH, MEMBER, "org_member"]] as const) {
      await db.organizationMember.create({ data: { orgId, userId, role, status: "active" } });
    }

    const OPEN = await mkInst(ORG);
    await mkEvidence(ORG, OPEN, "CANDIDATE_OTHER", "https://example.test/other", 0);
    await mkEvidence(ORG, OPEN, "CANADABUYS_TENDER_NOTICES", "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/new", 1);
    await mkEvidence(ORG, OPEN, "CANADABUYS_TENDER_NOTICES", "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/old", 5);
    const RACE = await mkInst(ORG);
    const CLOSED = await mkInst(ORG, { closingAt: new Date(now.getTime() - DAY) });
    const AWARD = await mkInst(ORG, { instrumentClass: "AWARD_INSTRUMENT", closingAt: null });
    const NOCLOSE = await mkInst(ORG, { closingAt: null, title: null });
    const ARCH_INST = await mkInst(ORG_ARCH);
    const B_INST = await mkInst(ORG_B);

    /* ---------- 1. 跟一条新标 ---------- */
    const r1 = await follow(OPEN);
    ok(r1.status === 201 && r1.body.created === true && typeof r1.body.projectId === "string", "跟一条未截标的 CanadaBuys 新标：201，新建", r1);
    const P = String(r1.body.projectId);
    const proj = await db.project.findUnique({ where: { id: P }, include: { members: true, environments: true } });
    const inst = await db.procurementInstrument.findUnique({ where: { id: OPEN } });
    ok(!!proj && proj.workDomain === "tender" && proj.orgId === ORG && proj.ownerId === MEMBER && proj.intakeStatus === "dispatched", "招投标项目，属于本组织，负责人是点的人，大家可见", proj);
    ok(proj?.name === inst?.title && proj?.solicitationNumber === inst?.officialNumber && proj?.closeDate?.getTime() === inst?.closingAt?.getTime() && proj?.publicDate?.getTime() === inst?.publishedAt?.getTime(), "名称、招标编号、截标日、发布日期与公告一致");
    ok(proj?.clientOrganization === "Fixture Health Agency" && proj?.sourcePlatform === "CanadaBuys", "采购方、来源平台");
    const meta = JSON.parse(proj?.sourceMetadataJson ?? "{}") as Rec;
    ok(meta.noticeUrl === "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/new" && meta.procurementInstrumentId === OPEN, "公告链接取最新一条 CanadaBuys 来源", meta);
    const link = await db.procurementTenderLink.findMany({ where: { instrumentId: OPEN } });
    ok(link.length === 1 && link[0].projectId === P && link[0].relation === "CURRENT" && link[0].orgId === ORG && link[0].createdById === MEMBER, "公告关联到新项目（本项目）", link);
    ok(inst?.triageStatus === "WATCHING" && inst?.triagedById === MEMBER && !!inst?.triagedAt && Math.abs(inst.triagedAt.getTime() - Date.now()) < 120_000, "公告改为关注（记下谁、什么时候）");
    const cal = await db.calendarEvent.count({ where: { projectId: P, userId: MEMBER } });
    ok(cal >= 1, "截标日已写进负责人的日程（里程碑同步）", { cal });
    ok((await db.projectDocument.count({ where: { projectId: P } })) === 0, "项目不带文件");
    const audits = await db.auditLog.findMany({ where: { orgId: ORG, projectId: P }, select: { action: true } });
    ok(audits.some((a) => a.action === "create") && audits.some((a) => a.action === "procurement_instrument.follow_tender"), "记审计：建项目 + 跟标", audits);

    /* ---------- 2. 与手工新建相同 ---------- */
    const manualRes = await projectsRoute.POST(new NextRequest("http://localhost/api/projects", { method: "POST", headers: { cookie: await cookie(MEMBER), "content-type": "application/json" }, body: JSON.stringify({ orgId: ORG, name: "Fixture manual tender", workDomain: "tender" }) }), { params: Promise.resolve({}) } as never);
    const manual = (await manualRes.json()) as Rec;
    createdProjects.push(String(manual.id));
    const mp = await db.project.findUnique({ where: { id: String(manual.id) }, include: { members: true, environments: true } });
    const shape = (p: typeof proj) => ({
      members: (p?.members ?? []).map((m) => `${m.userId}:${m.role}:${m.status}`).sort(),
      envs: (p?.environments ?? []).map((e) => `${e.code}:${e.name}:${e.status}`).sort(),
      color: p?.color, intake: p?.intakeStatus, domain: p?.workDomain, owner: p?.ownerId,
    });
    ok(manualRes.status === 201 && JSON.stringify(shape(proj)) === JSON.stringify(shape(mp)), "成员、环境、颜色、可见性与手工新建的招投标项目逐项相同", { follow: shape(proj), manual: shape(mp) });
    const sysMsgs = async (pid: string) => db.projectMessage.count({ where: { projectId: pid } });
    const [mf, mm] = [await sysMsgs(P), await sysMsgs(String(manual.id))];
    ok(mf >= 1 && mf === mm, "讨论区有「项目创建」系统消息，条数与手工新建相同", { mf, mm });

    /* ---------- 3. 只建一次 ---------- */
    const r2 = await follow(OPEN, MEMBER2);
    ok(r2.status === 200 && r2.body.created === false && r2.body.projectId === P, "再点（另一个成员）：200，返回同一个项目", r2);
    ok((await db.project.count({ where: { orgId: ORG, solicitationNumber: inst?.officialNumber } })) === 1, "项目数不变");
    const [a, b] = await Promise.all([follow(RACE, MEMBER), follow(RACE, MEMBER2)]);
    const raceProjects = await db.project.findMany({ where: { orgId: ORG, sourceMetadataJson: { contains: RACE } }, select: { id: true } });
    ok(raceProjects.length === 1 && a.body.projectId === b.body.projectId && [a.body.created, b.body.created].filter(Boolean).length === 1, "两人同时点：只建一个，两个请求返回同一个项目", { a, b, raceProjects });
    ok((await db.procurementTenderLink.count({ where: { instrumentId: RACE } })) === 1, "并发下关联也只有一条");
    // 已经手工关联「本项目」的公告：返回那个项目
    const PRELINK = await mkInst(ORG);
    await db.procurementTenderLink.create({ data: { orgId: ORG, projectId: String(manual.id), instrumentId: PRELINK, relation: "CURRENT", createdById: ADMIN } });
    const r3 = await follow(PRELINK);
    ok(r3.status === 200 && r3.body.created === false && r3.body.projectId === manual.id, "已手工关联为「本项目」：返回那个项目，不新建", r3);
    // 只有「历史」关联：照样新建
    const HIST = await mkInst(ORG);
    await db.procurementTenderLink.create({ data: { orgId: ORG, projectId: String(manual.id), instrumentId: HIST, relation: "RELATED_HISTORY", createdById: ADMIN } });
    const r4 = await follow(HIST);
    ok(r4.status === 201 && r4.body.created === true && r4.body.projectId !== manual.id, "只有历史关联：照样新建", r4);

    // 跟标建出的项目，关联被手工改成「前序」：再跟仍返回原项目（审查 H2）
    const tenderLinkRoute = await import("@/app/api/procurement/instruments/[id]/tender-link/route");
    const relink = await tenderLinkRoute.POST(new NextRequest(`http://localhost/api/procurement/instruments/${OPEN}/tender-link`, { method: "POST", headers: { cookie: await cookie(MEMBER), "content-type": "application/json" }, body: JSON.stringify({ projectId: P, relation: "PREDECESSOR" }) }), { params: Promise.resolve({ id: OPEN }) });
    const r6 = await follow(OPEN, MEMBER2);
    ok(relink.status === 200 && r6.status === 200 && r6.body.created === false && r6.body.projectId === P, "关联被改成「前序」后再跟：仍返回原项目，不建第二个", { relink: relink.status, r6 });
    // 手工把别的项目关联为「本项目」：跟标建过的项目优先
    await db.procurementTenderLink.create({ data: { orgId: ORG, projectId: String(manual.id), instrumentId: OPEN, relation: "CURRENT", createdById: ADMIN } });
    const r7 = await follow(OPEN);
    ok(r7.status === 200 && r7.body.created === false && r7.body.projectId === manual.id, "改关联后又手工关联了别的「本项目」：返回那个项目（与卡片一致），不新建", r7);
    // 项目被删：关联不算数，可以重新跟；候选列表也不再指向被删的项目（审查 M1）
    const DEL = await mkInst(ORG);
    const d1 = await follow(DEL);
    const dp = String(d1.body.projectId);
    await db.projectMessage.deleteMany({ where: { projectId: dp } });
    await db.calendarEvent.deleteMany({ where: { projectId: dp } });
    await db.environment.deleteMany({ where: { projectId: dp } });
    await db.projectMember.deleteMany({ where: { projectId: dp } });
    await db.project.delete({ where: { id: dp } });
    DEL_ID = DEL; DEL_PROJECT = dp;
    const d2 = await follow(DEL);
    ok(d1.status === 201 && d2.status === 201 && d2.body.created === true && d2.body.projectId !== dp, "项目被删后再跟：新建一个", { d1, d2 });
    // 已跟过的公告截标后再点：返回原项目
    await db.procurementInstrument.update({ where: { id: RACE }, data: { closingAt: new Date(now.getTime() - DAY) } });
    const r8 = await follow(RACE, MEMBER2);
    ok(r8.status === 200 && r8.body.created === false && r8.body.projectId === a.body.projectId, "已跟过的公告截标后再点：返回原项目", r8);
    // 合同即使被手工关联为「本项目」：也不能跟
    await db.procurementTenderLink.create({ data: { orgId: ORG, projectId: String(manual.id), instrumentId: AWARD, relation: "CURRENT", createdById: ADMIN } });
    const r9 = await follow(AWARD);
    ok(r9.status === 400 && r9.body.code === "NOT_SOLICITATION", "合同有「本项目」关联也是 400", r9);
    await db.procurementTenderLink.deleteMany({ where: { instrumentId: AWARD } });
    // 台账开着：建项写一条 project.created（与手工新建相同）
    const prevSchema = process.env.T2_LEDGER_SCHEMA_READY, prevProd = process.env.T2_LEDGER_PRODUCERS_ENABLED;
    process.env.T2_LEDGER_SCHEMA_READY = "1";
    process.env.T2_LEDGER_PRODUCERS_ENABLED = "1";
    const LED = await mkInst(ORG);
    const l1 = await follow(LED);
    if (prevSchema === undefined) delete process.env.T2_LEDGER_SCHEMA_READY; else process.env.T2_LEDGER_SCHEMA_READY = prevSchema;
    if (prevProd === undefined) delete process.env.T2_LEDGER_PRODUCERS_ENABLED; else process.env.T2_LEDGER_PRODUCERS_ENABLED = prevProd;
    const evs = await db.projectEvent.findMany({ where: { projectId: String(l1.body.projectId) }, select: { eventType: true, actorId: true } as never });
    ok(l1.status === 201 && evs.length === 1 && (evs[0] as Rec).eventType === "project.created", "台账开着：写且只写一条 project.created", evs);

    /* ---------- 4. 不能跟 ---------- */
    const before = await db.project.count({ where: { orgId: { in: orgs } } });
    const c1 = await follow(CLOSED);
    ok(c1.status === 409 && c1.body.code === "CLOSED", "已截标：409", c1);
    const c2 = await follow(AWARD);
    ok(c2.status === 400 && c2.body.code === "NOT_SOLICITATION", "不是招标公告：400", c2);
    const c3 = await follow(OPEN, VIEWER);
    ok(c3.status === 403, "只读成员：403", c3);
    const c4 = await follow(B_INST, MEMBER);
    ok(c4.status === 404, "别的组织的公告：404（不泄露存在）", c4);
    const c5 = await follow(OPEN, OUTSIDER);
    ok(c5.status === 404, "别的组织的人跟本组织的公告：404", c5);
    const c6 = await follow(ARCH_INST, MEMBER);
    ok(c6.status === 403 && c6.body.code === "ORG_ARCHIVED", "组织已归档：403", c6);
    const c7 = await follow(`nope_${stamp}`);
    ok(c7.status === 404, "公告不存在：404");
    process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "0";
    const c8 = await follow(CLOSED);
    process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "1";
    ok(c8.status === 503, "采购监控未启用：503", c8);
    ok((await db.project.count({ where: { orgId: { in: orgs } } })) === before, "以上都没建项目");
    const untouched = await db.procurementInstrument.findMany({ where: { id: { in: [CLOSED, AWARD, ARCH_INST, B_INST] } }, select: { triageStatus: true } });
    ok(untouched.every((x) => x.triageStatus === "CANDIDATE") && (await db.procurementTenderLink.count({ where: { instrumentId: { in: [CLOSED, AWARD, ARCH_INST, B_INST] } } })) === 0, "也没改分诊与关联");

    /* ---------- 5. 截标未知、没有标题 ---------- */
    const r5 = await follow(NOCLOSE);
    const p5 = await db.project.findUnique({ where: { id: String(r5.body.projectId) } });
    const i5 = await db.procurementInstrument.findUnique({ where: { id: NOCLOSE } });
    ok(r5.status === 201 && p5?.closeDate === null && p5?.name === i5?.officialNumber && p5?.sourcePlatform === "采购监控", "截标未知、没有标题：可以跟，名称用编号、截标日为空、没有证据写「采购监控」", p5);

    /* ---------- 6. 候选列表 → 按钮状态 ---------- */
    const lr = await candidatesRoute.GET(new NextRequest(`http://localhost/api/procurement/candidates?orgId=${ORG}&triage=ALL`, { headers: { cookie: await cookie(MEMBER) } }), { params: Promise.resolve({}) } as never);
    const lj = (await lr.json()) as Rec;
    const items = (lj.items ?? lj.candidates ?? []) as Rec[];
    const stateOf = (id: string) => { const c = items.find((x) => x.id === id); return c ? followButtonState({ instrumentClass: String(c.instrumentClass), closingAt: (c.closingAt as string | null) ?? null, tenderLinks: c.tenderLinks as never }, new Date()) : null; };
    const sOpen = stateOf(OPEN);
    ok(sOpen?.kind === "followed" && sOpen.projectId === r7.body.projectId, "候选列表的「已跟进」与再点跟标返回的是同一个项目", { sOpen, r7: r7.body });
    ok(stateOf(HIST)?.kind === "followed" && stateOf(CLOSED)?.kind === "none" && stateOf(AWARD)?.kind === "none", "历史关联后跟进的显示已跟进；已截标、合同不显示");
    const delItem = items.find((x) => x.id === DEL_ID);
    ok(!!delItem && !((delItem.tenderLinks as Rec[]) ?? []).some((l) => l.projectId === DEL_PROJECT), "候选列表不展示指向已删项目的关联", delItem?.tenderLinks);
    const sRace = stateOf(RACE);
    ok(sRace?.kind === "followed" && sRace.projectId === a.body.projectId, "跟过（后来截标）的公告：卡片仍是已跟进，指向跟标建出的项目");
    const wr = await (await import("@/app/api/procurement/watch/route")).GET(new NextRequest(`http://localhost/api/procurement/watch?orgId=${ORG}`, { headers: { cookie: await cookie(VIEWER) } }), { params: Promise.resolve({}) } as never);
    const wj = (await wr.json()) as Rec;
    const wm = (await (await import("@/app/api/procurement/watch/route")).GET(new NextRequest(`http://localhost/api/procurement/watch?orgId=${ORG}`, { headers: { cookie: await cookie(MEMBER) } }), { params: Promise.resolve({}) } as never).then((r) => r.json())) as Rec;
    ok(wj.canFollow === false && wm.canFollow === true, "监控接口：只读成员 canFollow 为假，组织成员为真", { viewer: wj.canFollow, member: wm.canFollow });
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { userId: { in: users } }] } });
    await db.procurementTenderLink.deleteMany({ where: { orgId: { in: orgs } } });
    const evPids = (await db.project.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((p) => p.id);
    await db.calendarEvent.deleteMany({ where: { projectId: { in: evPids } } });
    await (db as unknown as { projectEventActor?: { deleteMany: (a: unknown) => Promise<unknown> } }).projectEventActor?.deleteMany({ where: { event: { projectId: { in: evPids } } } }).catch(() => undefined);
    await db.projectEvent.deleteMany({ where: { projectId: { in: evPids } } }).catch(() => undefined);
    await db.procurementSourceEvidence.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementInstrument.deleteMany({ where: { orgId: { in: orgs } } });
    const pids = (await db.project.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((p) => p.id);
    await db.projectMessage.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await db.projectConversation?.deleteMany?.({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await db.environment.deleteMany({ where: { projectId: { in: pids } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: pids } } });
    await db.project.deleteMany({ where: { id: { in: pids } } });
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
