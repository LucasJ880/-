/**
 * T-2 询价追踪页——真实 DB（隔离库）+ 真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不调任何模型，不发任何邮件。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 T-2 询价追踪 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "T-2 rfq tracker DB test" });

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
  const trackerRoute = await import("@/app/api/org/tender-rfq/tracker/route");
  const chaseRoute = await import("@/app/api/projects/[id]/tender-rfq/chase/route");
  const batchRoute = await import("@/app/api/projects/[id]/inquiries/batch-followup/route");
  const { loadItems, chaseDaysForRound } = await import("../chase-service");
  const { resolveChaseAfterDays } = await import("../chase-pure");
  const { loadCompareMatrix } = await import("../compare-service");
  const { zonedMonthDay } = await import("../tracker-pure");
  const { scanProjectsForUser } = await import("@/lib/proactive/scanner");
  const { loadTracker } = await import("../tracker");
  const { formatChaseNote } = await import("../chase-pure");

  console.log("T-2 rfq tracker — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `t2owner_${stamp}`, OUTSIDER = `t2out_${stamp}`, VIEWER = `t2view_${stamp}`, MEMBER1 = `t2mem1_${stamp}`, MEMBER0 = `t2mem0_${stamp}`;
  const ORG = `t2org_${stamp}`, ORG_B = `t2orgb_${stamp}`;
  const users = [OWNER, OUTSIDER, VIEWER, MEMBER1, MEMBER0];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  const ymdAfter = (d: number) => new Date(new Date(now.getTime() + d * DAY).toISOString().slice(0, 10) + "T00:00:00Z");
  const projectIds: string[] = [];
  const supplierIds: string[] = [];
  let seq = 0;

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const getTracker = async (uid = OWNER, qs = "") => {
    const res = await trackerRoute.GET(new NextRequest(`http://localhost/api/org/tender-rfq/tracker${qs}`, { headers: { cookie: await cookie(uid) } }), { params: Promise.resolve({}) });
    const text = await res.text();
    return { status: res.status, body: rec(JSON.parse(text || "null")), text };
  };
  const postChase = async (projectId: string, body: unknown, uid = OWNER) => {
    const res = await chaseRoute.POST(new NextRequest(`http://localhost/api/projects/${projectId}/tender-rfq/chase`, { method: "POST", headers: { cookie: await cookie(uid), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  type Row = { itemId: string; supplierName: string; status: string; view: Rec; needsAction: string | null; quote: Rec | null; cards: Rec[]; canChaseNow: boolean; outlookKind: string };
  const rowsOf = (b: Rec): Row[] => ((b.groups as Rec[]) ?? []).flatMap((g) => ((g.rounds as Rec[]) ?? []).flatMap((r) => (r.rows as Row[]) ?? []));
  const rowBy = (b: Rec, name: string) => rowsOf(b).find((r) => r.supplierName === name);

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
    await db.organization.create({
      data: {
        id: ORG, name: "Fixture Bidder", code: `t2-${stamp}`, ownerId: OWNER,
        settingsJson: { tenderRfq: { landedCost: { fxRates: { USD: 1.36 }, fxAsOf: now.toISOString().slice(0, 10), fxSource: "MANUAL", freightEstimate: { mode: "per_unit", value: 6 }, insurancePct: 1, clearanceFlatCad: 150, projects: {} } } },
      },
    });
    await db.organization.create({ data: { id: ORG_B, name: "Other Org", code: `t2b-${stamp}`, ownerId: OUTSIDER } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_viewer", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER1, role: "org_member", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER0, role: "org_member", status: "active" } });

    const mkProject = async (o: { orgId?: string; owner?: string; workDomain?: string; intakeStatus?: string; name?: string } = {}) => {
      seq += 1;
      const id = `t2proj_${stamp}_${seq}`;
      projectIds.push(id);
      await db.project.create({ data: { id, name: o.name ?? `Fixture Tender ${seq}`, orgId: o.orgId ?? ORG, ownerId: o.owner ?? OWNER, workDomain: o.workDomain ?? "tender", intakeStatus: o.intakeStatus ?? "dispatched", closeDate: new Date(now.getTime() + 30 * DAY) } as never });
      return id;
    };
    const mkSupplier = async (name: string, orgId = ORG) => {
      const s = await db.supplier.create({ data: { orgId, name, contactEmail: `${name.replace(/\W/g, "").toLowerCase()}@supplier-fixture.test`, status: "active", createdById: orgId === ORG ? OWNER : OUTSIDER } as never });
      supplierIds.push(s.id);
      return s.id;
    };
    const mkRound = async (projectId: string, roundNumber: number, dueDate: Date | null, status = "in_progress", orgId = ORG, owner = OWNER) => {
      const inq = await db.projectInquiry.create({ data: { projectId, roundNumber, status, dueDate, createdById: owner } });
      await db.pendingAction.create({ data: { type: "tender.send_rfq", title: `第 ${roundNumber} 轮`, preview: "fixture", payload: { inquiryId: inq.id, projectId, roundNumber, items: [{ body: "- 数量：200 件\n" }] }, status: "executed", createdById: owner, orgId, projectId, expiresAt: new Date(now.getTime() + 3 * DAY), idempotencyKey: `t2-${stamp}-${inq.id}` } });
      return inq.id;
    };
    const mkItem = async (inquiryId: string, supplierId: string, o: Rec) =>
      (await db.inquiryItem.create({ data: { inquiryId, supplierId, createdById: OWNER, ...o } as never })).id;

    const P1 = await mkProject({ name: "Fixture Tender One" });
    const P2 = await mkProject({ name: "Fixture Tender Two" });
    // MEMBER1 只是 P1 的只读成员
    await db.projectMember.create({ data: { projectId: P1, userId: MEMBER1, role: "viewer", status: "active" } });
    // P1 的关税率（FOB 换算要用）
    {
      const cur = rec((await db.organization.findUnique({ where: { id: ORG } }))?.settingsJson);
      const lc = rec(rec(cur.tenderRfq).landedCost);
      await db.organization.update({ where: { id: ORG }, data: { settingsJson: { ...cur, tenderRfq: { ...rec(cur.tenderRfq), landedCost: { ...lc, projects: { [P1]: { dutyRatePct: 6.5 } } } } } as never } });
    }
    const PX = await mkProject({ workDomain: "trade", name: "Not A Tender" });
    const PU = await mkProject({ intakeStatus: "pending_dispatch", name: "Not Dispatched" });
    const PB = await mkProject({ orgId: ORG_B, owner: OUTSIDER, name: "Other Org Tender" });

    const S = { a: await mkSupplier("Alpha Wait"), b: await mkSupplier("Beta Card"), c: await mkSupplier("Gamma Manual"), d: await mkSupplier("Delta Quoted"), e: await mkSupplier("Epsilon CNY"), f: await mkSupplier("Foxtrot Reply"), g: await mkSupplier("Golf Late"), h: await mkSupplier("Hotel NoResp"), i: await mkSupplier("India Canceled"), x: await mkSupplier("Xray Hidden"), z: await mkSupplier("Zulu Other", ORG_B) };

    const r1 = await mkRound(P1, 1, ymdAfter(10));
    const autoNotes = (facts: string) => `[auto ${ago(1).toISOString()} msg=m${seq}] ${facts}`;
    const A = await mkItem(r1, S.a, { status: "sent", sentAt: ago(1), contactNotes: "threadId=thrA" });
    const B = await mkItem(r1, S.b, { status: "sent", sentAt: ago(4), contactNotes: "threadId=thrB" });
    const C = await mkItem(r1, S.c, { status: "sent", sentAt: ago(1), contactNotes: null });
    const D = await mkItem(r1, S.d, { status: "quoted", sentAt: ago(3), repliedAt: ago(1), unitPrice: 89.5, totalPrice: 17900, currency: "USD", deliveryDays: 21, validUntil: ymdAfter(40), contactNotes: "threadId=thrD", quoteNotes: autoNotes("单价=89.5；贸易条款=FOB") });
    const E = await mkItem(r1, S.e, { status: "quoted", sentAt: ago(3), repliedAt: ago(1), unitPrice: 500, currency: "CNY", deliveryDays: 20, validUntil: ymdAfter(40), contactNotes: "threadId=thrE", quoteNotes: autoNotes("单价=500；贸易条款=FOB") });
    const F = await mkItem(r1, S.f, { status: "replied", sentAt: ago(3), repliedAt: ago(1), contactNotes: "threadId=thrF", quoteNotes: autoNotes("缺：价格、币种") });
    const SK = await mkSupplier("Kilo Expired"), SL = await mkSupplier("Lima Executing"), SM = await mkSupplier("Mike Max");
    const K = await mkItem(r1, SK, { status: "sent", sentAt: ago(4), contactNotes: "threadId=thrK" });
    const L = await mkItem(r1, SL, { status: "sent", sentAt: ago(4), contactNotes: "threadId=thrL" });
    const M = await mkItem(r1, SM, { status: "sent", sentAt: ago(8), contactNotes: ["threadId=thrM", formatChaseNote({ index: 1, kind: "no_reply", messageId: "m1", at: ago(5) }), formatChaseNote({ index: 2, kind: "no_reply", messageId: "m2", at: ago(1) })].join("\n") });
    // K：过期的待批卡（不算活着）；L：已批准正在执行的卡（算活着）
    await db.pendingAction.create({ data: { type: "tender.send_chase", title: "催单", preview: "fixture", payload: { inquiryItemId: K }, status: "pending", createdById: OWNER, orgId: ORG, projectId: P1, expiresAt: ago(1), idempotencyKey: `tender.send_chase:${K}:1` } });
    await db.pendingAction.create({ data: { type: "tender.send_chase", title: "催单", preview: "fixture", payload: { inquiryItemId: L }, status: "approved", createdById: OWNER, orgId: ORG, projectId: P1, expiresAt: new Date(now.getTime() + DAY), idempotencyKey: `tender.send_chase:${L}:1` } });
    // B 有一张待批的第 1 次催单卡
    const cardB = await db.pendingAction.create({ data: { type: "tender.send_chase", title: "催单", preview: "fixture", payload: { inquiryItemId: B, inquiryId: r1, projectId: P1, kind: "no_reply", chaseIndex: 1, supplierName: "Beta Card", to: "beta@supplier-fixture.test", subject: "Re: 询价", body: "您好，想确认一下报价进展。", threadId: "thrB" }, status: "pending", createdById: OWNER, orgId: ORG, projectId: P1, expiresAt: new Date(now.getTime() + 2 * DAY), idempotencyKey: `tender.send_chase:${B}:1` } });

    const r2 = await mkRound(P2, 1, new Date(ago(3).toISOString().slice(0, 10) + "T00:00:00Z"));
    const G = await mkItem(r2, S.g, { status: "sent", sentAt: ago(6), contactNotes: "threadId=thrG" });
    const H = await mkItem(r2, S.h, { status: "no_response", sentAt: ago(9), contactNotes: "threadId=thrH" });
    const rc = await mkRound(P2, 2, ymdAfter(5), "canceled");
    const I = await mkItem(rc, S.i, { status: "sent", sentAt: ago(1), contactNotes: "threadId=thrI" });
    await mkItem(rc, await mkSupplier("November NoResp Canceled"), { status: "no_response", sentAt: ago(9), contactNotes: "threadId=thrN" });
    await mkItem(rc, await mkSupplier("Oscar Old Canceled"), { status: "sent", sentAt: ago(8), contactNotes: "threadId=thrO" });
    const OLDNR = await mkItem(r2, await mkSupplier("Papa NoResp Old"), { status: "no_response", sentAt: ago(30), contactNotes: "threadId=thrP" });
    await db.$executeRaw`UPDATE "InquiryItem" SET "updatedAt" = ${ago(20)} WHERE id = ${OLDNR}`;
    const rx = await mkRound(PX, 1, ymdAfter(5));
    await mkItem(rx, S.x, { status: "sent", sentAt: ago(1), contactNotes: "threadId=thrX" });
    await mkItem(rx, await mkSupplier("Romeo Old NonTender"), { status: "sent", sentAt: ago(9), contactNotes: "threadId=thrR" });
    const ru = await mkRound(PU, 1, ymdAfter(5));
    await mkItem(ru, S.x, { status: "sent", sentAt: ago(1), contactNotes: "threadId=thrU" });
    const rb = await mkRound(PB, 1, ymdAfter(5), "in_progress", ORG_B, OUTSIDER);
    await mkItem(rb, S.z, { status: "sent", sentAt: ago(1), contactNotes: "threadId=thrZ", createdById: OUTSIDER });

    /* ---------- 1. 看得到哪些 ---------- */
    const g1 = await getTracker();
    ok(g1.status === 200, "管理员读追踪页：200", g1.status);
    const projNames = ((g1.body.groups as Rec[]) ?? []).map((g) => rec(g.project).name);
    ok(projNames.includes("Fixture Tender One") && projNames.includes("Fixture Tender Two") && !projNames.includes("Not A Tender") && !projNames.includes("Not Dispatched") && !projNames.includes("Other Org Tender"), "只有本组织、已派发的招投标项目（不含非招投标、未派发、别的组织）", projNames);
    ok(!rowBy(g1.body, "India Canceled") && !rowBy(g1.body, "November NoResp Canceled"), "已取消轮次里的（包括标为未响应的）不出现");
    ok(!rowBy(g1.body, "Papa NoResp Old"), "20 天前标为未响应的不出现（只显示近 14 天）");
    ok(!!rowBy(g1.body, "Hotel NoResp") && rowBy(g1.body, "Hotel NoResp")!.status === "no_response", "近 14 天标为未响应的显示出来");
    // 价格的可见范围 = 项目里的询价明细（与 requireProjectReadAccess 同一规则）
    const gm1 = await getTracker(MEMBER1);
    const m1Projects = ((gm1.body.groups as Rec[]) ?? []).map((g) => rec(g.project).name);
    ok(gm1.status === 200 && m1Projects.join() === "Fixture Tender One", "只是 P1 成员的普通组织成员：只看到 P1", m1Projects);
    const gm0 = await getTracker(MEMBER0);
    ok(gm0.status === 200 && JSON.stringify(gm0.body.groups) === "[]" && !gm0.text.includes("USD") && rec(gm0.body.summary).waiting === 0, "不是任何项目成员的普通组织成员：什么都看不到（没有价格）", gm0.body);
    const gv = await getTracker(VIEWER);
    ok(gv.status === 200 && JSON.stringify(gv.body.groups) === "[]", "组织只读成员（不是项目成员）：什么都看不到", gv.body.groups);
    const gb = await getTracker(OUTSIDER);
    ok(gb.status === 200 && ((gb.body.groups as Rec[]) ?? []).map((g) => rec(g.project).name).join() === "Other Org Tender", "别的组织的管理员只看到自己组织的", gb.body.groups);
    const gbx = await getTracker(OUTSIDER, `?orgId=${ORG}`);
    ok(gbx.status === 403 || gbx.status === 400, "别的组织的人带上本组织 id：被拒（组织由服务端按成员关系解析）", gbx.status);

    /* ---------- 2. 每一行 ---------- */
    const tz = String(g1.body.timeZone);
    const ra = rowBy(g1.body, "Alpha Wait")!;
    ok(ra.status === "sent" && ra.outlookKind === "chase_on" && ra.view.outlookText === `下次自动催 ${zonedMonthDay(new Date(ago(1).getTime() + 3 * DAY), tz)}` && ra.canChaseNow && ra.needsAction === null, "等回复：下次自动催的日期 = 发出 + 3 天（默认间隔），可「现在就催」", ra);
    const rb1 = rowBy(g1.body, "Beta Card")!;
    ok(rb1.needsAction === "chase_card_pending" && String(rb1.view.outlookText).startsWith("催单卡待批；若一直不批，将于") && rb1.cards.length === 1 && rec(rb1.cards[0]).actionId === cardB.id && rec(rb1.cards[0]).chaseKind === "no_reply" && rec(rb1.cards[0]).chaseIndex === 1 && !rb1.canChaseNow, "有待批卡：需要我处理、带卡（审批信息、第几次）、没有「现在就催」", rb1);
    ok(Array.isArray(rec(rb1.cards[0]).emails) && JSON.stringify(rec(rb1.cards[0]).emails).includes("想确认一下报价进展") && !!rec(rec(rb1.cards[0]).approval).approvalId, "卡带正文与审批信息");
    const rc1 = rowBy(g1.body, "Gamma Manual")!;
    ok(rc1.outlookKind === "manual_only" && String(rc1.view.outlookText).startsWith("手工联系，系统不会自动催") && !rc1.canChaseNow, "手工联系：写明不会自动催，没有「现在就催」", rc1);
    const rk = rowBy(g1.body, "Kilo Expired")!;
    ok(rk.outlookKind === "chase_on" && rk.cards.length === 0 && rk.needsAction === null, "过期的待批卡不算：照常等扫描催，不挂卡", rk);
    const rl = rowBy(g1.body, "Lima Executing")!;
    ok(rl.outlookKind === "card_pending" && rl.cards.length === 1, "已批准正在执行的卡算活着：挂在行上（与扫描同一口径）", rl);
    const rm = rowBy(g1.body, "Mike Max")!;
    ok(rm.outlookKind === "max_reached_wait" && rm.canChaseNow === false && String(rm.view.chasedText) === "已催 2 次", "催满两次：等标未响应，没有「现在就催」", rm);
    const rf = rowBy(g1.body, "Foxtrot Reply")!;
    ok(rf.needsAction === "reply_no_quote" && String(rf.view.missingText).includes("单价"), "回信没报价：需要我处理，写缺什么", rf);
    const rg = rowBy(g1.body, "Golf Late")!;
    ok(rg.needsAction === "past_reply_by", "过了回复截止还没回：需要我处理", rg);

    /* ---------- 3. 价格只有一个出处 ---------- */
    const m = await loadCompareMatrix({ projectId: P1, orgId: ORG, inquiryId: r1, now });
    ok(m.ok, "比价矩阵能算");
    const mrow = (id: string) => (m.ok ? m.matrix.rows.find((x) => x.itemId === id) : undefined);
    const rd = rowBy(g1.body, "Delta Quoted")!;
    const dTotal = mrow(D)!.landedCad.total!;
    ok(String(rd.quote?.landedText) === `落地价 CAD ${Math.round(dTotal).toLocaleString("en-US")}` && String(rd.quote?.quoteText).startsWith("报价 USD 89.50 / 件 · 总价 USD 17,900"), "已报价：原币种报价；落地价与比价矩阵相同", { rd: rd.quote, dTotal });
    ok(Boolean(rd.quote?.cheapest) === mrow(D)!.flags.includes("cheapest"), "「最便宜」与矩阵一致");
    const re = rowBy(g1.body, "Epsilon CNY")!;
    ok(String(re.quote?.landedText) === `落地价未换算（${mrow(E)!.blockers[0]}）` && rec(re.quote).needsCompareLink === true, "缺 CNY 汇率：写矩阵给的原因、给去比价链接", re.quote);
    // 待批卡的正文预览里有收件地址（审批时要看到发给谁）；卡以外的部分不该有供应商邮箱
    const noCards = JSON.stringify({ ...g1.body, groups: ((g1.body.groups as Rec[]) ?? []).map((g) => ({ ...g, rounds: ((g.rounds as Rec[]) ?? []).map((r) => ({ ...r, rows: ((r.rows as Rec[]) ?? []).map((x) => ({ ...x, cards: [] })) })) })) });
    const leak = g1.text.match(/estimatedValue|ourBidPrice|winningBidPrice|margin|quoteNotes|\[auto /i)?.[0] ?? noCards.match(/supplier-fixture\.test/)?.[0] ?? null;
    ok(leak === null, "返回里没有估值、我方报价、中标价、毛利、报价备注原文；卡以外没有供应商邮箱", leak);

    /* ---------- 4. 计数与汇总卡 ---------- */
    const s = rec(g1.body.summary);
    const rows = rowsOf(g1.body);
    ok(s.needsAction === rows.filter((r) => r.needsAction).length && s.waiting === rows.filter((r) => r.status === "sent").length && s.quoted === 2 && s.noResponse === 1 && s.pendingCards === rows.filter((r) => r.needsAction === "chase_card_pending").length && s.pendingCards === 2, "顶部计数与行一致（待批卡：B 与正在执行的 L）", s);
    const gs = await getTracker(OWNER, "?summary=1");
    ok(JSON.stringify(gs.body.summary) === JSON.stringify(g1.body.summary) && JSON.stringify(gs.body.groups) === "[]", "汇总卡（summary=1）的数字与整页顶部相同，不带行", gs.body);

    /* ---------- 5. 间隔与扫描同一来源 ---------- */
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: { ...(rec((await db.organization.findUnique({ where: { id: ORG } }))?.settingsJson)), museBridge: { userPrefs: { [OWNER]: { chaseAfterDays: 5 } } } } } });
    const g5 = await getTracker();
    ok(rowBy(g5.body, "Alpha Wait")!.view.outlookText === `下次自动催 ${zonedMonthDay(new Date(ago(1).getTime() + 5 * DAY), tz)}`, "负责人把催单天数设为 5：下次自动催 = 发出 + 5 天");
    const orgNow = await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
    const noFollow = { flagEnabled: false, roundCard: null, approver: { active: false, role: null }, inquiryStatus: "", stopped: false };
    ok(chaseDaysForRound(orgNow?.settingsJson, OWNER, noFollow) === 5 && chaseDaysForRound(orgNow?.settingsJson, OWNER, noFollow) === resolveChaseAfterDays(5, orgNow?.settingsJson), "chaseDaysForRound 在没有跟进授权时就是负责人偏好 → 组织设置（与原来相同）");

    /* ---------- 6. loadItems 不传 projectIds 与原来相同 ---------- */
    const all = await loadItems({ orgId: ORG }, now);
    const some = await loadItems({ orgId: ORG, projectIds: [P1] }, now);
    const both = await loadItems({ orgId: ORG, projectIds: [P1, P2, PX, PU] }, now);
    const ids = (xs: Array<{ snapshot: { itemId: string } }>) => xs.map((x) => x.snapshot.itemId).sort().join();
    ok(ids(all) === ids(both) && some.every((x) => x.snapshot.projectId === P1) && some.length === 9, "loadItems：不传 projectIds 与传全部项目结果相同；只传 P1 只有 P1 的", { all: all.length, some: some.length });
    ok(!all.some((x) => x.snapshot.itemId === I), "loadItems 照旧排除已取消轮次");

    /* ---------- 7. 现在就催 ---------- */
    const before = await db.pendingAction.count({ where: { orgId: ORG, type: "tender.send_chase", status: "pending" } });
    const executedBefore = await db.pendingAction.count({ where: { orgId: ORG, type: "tender.send_chase", executedAt: { not: null } } });
    const c1 = await postChase(P1, { inquiryId: r1, itemIds: [A, B, C] });
    const drafted = (c1.body.drafted as Rec[]) ?? [];
    const skipped = (c1.body.skipped as Rec[]) ?? [];
    ok(c1.status === 200 && drafted.length === 1 && drafted[0].itemId === A && !!rec(drafted[0].approval).approvalId && drafted[0].chaseKind === "no_reply" && drafted[0].chaseIndex === 1, "等回复的那家（还没到期也行）：起草一张卡，带审批信息与第几次", c1.body);
    ok(skipped.some((x) => x.itemId === B && x.reasonZh === "已有一张待批的催单卡") && skipped.some((x) => x.itemId === C && x.reasonZh === "这家是手工联系的，没有邮件线程可回复"), "另两家：说明原因（已有待批卡 / 手工联系）", skipped);
    const afterPending = await db.pendingAction.count({ where: { orgId: ORG, type: "tender.send_chase", status: "pending" } });
    const executedAfter = await db.pendingAction.count({ where: { orgId: ORG, type: "tender.send_chase", executedAt: { not: null } } });
    ok(afterPending === before + 1 && executedAfter === executedBefore, "只多了一张待批卡，没有任何一张被执行（没发信）", { before, afterPending, executedBefore, executedAfter });
    const g7 = await getTracker();
    ok(rowBy(g7.body, "Alpha Wait")!.needsAction === "chase_card_pending" && rowBy(g7.body, "Alpha Wait")!.cards.length === 1, "起草之后追踪页里那一行变成「催单卡待批」并带卡");
    ok((await postChase(P1, { inquiryId: r1, itemIds: [A] }, OUTSIDER)).status >= 403, "别的组织的人「现在就催」：拒绝");
    ok((await postChase(P1, { inquiryId: r1, itemIds: [] })).status === 400 && (await postChase(P1, { inquiryId: r1, itemIds: Array.from({ length: 9 }, (_, i) => `x${i}`) })).status === 400, "一次 0 家或超过 8 家：400");
    const vres = await postChase(P1, { inquiryId: r1, itemIds: [A] }, VIEWER);
    ok(vres.status === 403, "组织只读成员（org_viewer）没有写权限：403", vres.status);
    const mres = await postChase(P1, { inquiryId: r1, itemIds: [A] }, MEMBER1);
    ok(mres.status === 403, "项目只读成员看得到追踪页，但「现在就催」要写权限：403", mres.status);

    /* ---------- 8. 首页建议 ---------- */
    await mkItem(r2, await mkSupplier("Juliet Pending"), { status: "pending", createdAt: ago(20) });
    const scan = await scanProjectsForUser(OWNER, "user");
    const sug = scan.suggestions.find((x) => x.kind === "supplier_no_response" && x.projectId === P2);
    ok(!!sug && sug.suggestedAction?.type === "open_rfq_tracker" && sug.suggestedAction.label === "去询价追踪" && sug.title.includes("超过 5 天"), "首页「供应商未回复」：按负责人的催单天数（5 天），按钮去询价追踪", sug);
    ok(!!sug && sug.description.includes("Golf Late") && !sug.description.includes("Juliet Pending") && !sug.description.includes("Hotel NoResp") && !sug.description.includes("Oscar Old Canceled") && sug.title.includes("有 1 家"), "只算已发出且超过 5 天的（pending 的、未响应的、已取消轮次的不算）", sug?.description);
    ok(!scan.suggestions.some((x) => x.kind === "supplier_no_response" && x.projectId === PX), "非招投标项目里 9 天没回的：不提醒（追踪页只列招投标）");
    const sug1 = scan.suggestions.find((x) => x.kind === "supplier_no_response" && x.projectId === P1);
    ok(!!sug1 && sug1.description.includes("Mike Max") && !/Alpha Wait|Beta Card|Gamma Manual/.test(sug1.description) && sug1.title.includes("有 1 家"), "P1 只算超过 5 天的那一家（8 天前发出的），最近发出的不算", sug1?.description);

    /* ---------- 8b. 上限：比价矩阵只算最近报价的那几轮；行数截断时需要我处理的优先 ---------- */
    const r3 = await mkRound(P2, 3, ymdAfter(10));
    await mkItem(r3, await mkSupplier("Quebec Recent Quote"), { status: "quoted", sentAt: ago(2), repliedAt: new Date(), unitPrice: 50, currency: "USD", deliveryDays: 10, validUntil: ymdAfter(40), contactNotes: "threadId=thrQ", quoteNotes: autoNotes("单价=50；贸易条款=DDP") });
    const ownerUser = await db.user.findUnique({ where: { id: OWNER } });
    const req = new NextRequest("http://localhost/api/org/tender-rfq/tracker", { headers: { cookie: await cookie(OWNER) } });
    const capped = await loadTracker({ request: req, user: ownerUser as never, orgId: ORG, limits: { matrixRounds: 1 } });
    const cd = rowBy(capped as unknown as Rec, "Delta Quoted")!;
    const cq = rowBy(capped as unknown as Rec, "Quebec Recent Quote")!;
    ok(String(cd.quote?.landedText) === "落地价请到比价面板查看" && rec(cd.quote).needsCompareLink === true && String(cq.quote?.landedText).startsWith("落地价 CAD"), "比价矩阵上限 1 轮：只算最近报价的那一轮，另一轮写「请到比价面板查看」", { cd: cd.quote, cq: cq.quote });
    const trunc = await loadTracker({ request: req, user: ownerUser as never, orgId: ORG, limits: { rows: 3 } });
    const tr = rowsOf(trunc as unknown as Rec);
    ok(trunc.truncated === true && tr.length === 3 && tr.every((r) => r.needsAction != null), "行数上限 3：标明截断，留下的都是需要我处理的", tr.map((r) => [r.supplierName, r.needsAction]));
    ok(JSON.stringify(trunc.summary) === JSON.stringify((await loadTracker({ request: req, user: ownerUser as never, orgId: ORG })).summary), "截断不影响顶部计数");

    /* ---------- 8c. CHAIN-2e 落地价只给对该行所在项目有财务查看权的人 ---------- */
    // OWNER：组织管理员（没有任何岗位 / 财务键），P1 / P2 的负责人。P3 的负责人是 MEMBER0，OWNER 不是成员，但组织管理员看得到
    const P3 = await mkProject({ owner: MEMBER0, name: "Fixture Tender Three" });
    const r4 = await mkRound(P3, 1, ymdAfter(10));
    await mkItem(r4, await mkSupplier("Uniform Hidden"), { status: "quoted", sentAt: ago(2), repliedAt: ago(1), unitPrice: 77.77, totalPrice: 15554, currency: "USD", deliveryDays: 18, validUntil: ymdAfter(40), contactNotes: "threadId=thrUH", quoteNotes: autoNotes("单价=77.77；贸易条款=DDP") });
    await mkItem(r4, await mkSupplier("Victor NoFx"), { status: "quoted", sentAt: ago(2), repliedAt: ago(1), unitPrice: 400, currency: "CNY", deliveryDays: 18, validUntil: ymdAfter(40), contactNotes: "threadId=thrVN", quoteNotes: autoNotes("单价=400；贸易条款=DDP") });
    const m3 = await loadCompareMatrix({ projectId: P3, orgId: ORG, inquiryId: r4, now });
    const u3 = m3.ok ? m3.matrix.rows.find((x) => x.supplierName === "Uniform Hidden") : undefined;
    const v3 = m3.ok ? m3.matrix.rows.find((x) => x.supplierName === "Victor NoFx") : undefined;
    ok(!!u3 && u3.landedCad.total != null && u3.landedCad.total !== 15554 && !!v3 && v3.flags.includes("not_normalized"), "CHAIN-2e 前提：P3 一家换算出落地价（与原价不同）、一家缺汇率换算不出", { u3, v3 });
    const u3Tokens = u3 ? [Math.round(u3.landedCad.total!).toLocaleString("en-US"), String(u3.landedCad.total), String(u3.landedCad.unit)] : [];
    const g8 = await getTracker(OWNER);
    const ru8 = rowBy(g8.body, "Uniform Hidden");
    const rv8 = rowBy(g8.body, "Victor NoFx");
    ok(String(ru8?.quote?.landedText) === "落地价只给有财务查看权的人看" && rec(ru8?.quote).needsCompareLink === false && Boolean(ru8?.quote?.cheapest) === !!u3?.flags.includes("cheapest") && String(ru8?.quote?.quoteText).startsWith("报价 USD 77.77 / 件"), "CHAIN-2e 组织管理员（没有财务键）看别人负责的项目：那一格写「落地价只给有财务查看权的人看」，原币种报价与「最便宜」照常", ru8?.quote);
    ok(String(rv8?.quote?.landedText).startsWith("落地价未换算（缺 CNY→CAD 汇率") && rec(rv8?.quote).needsCompareLink === true, "CHAIN-2e 换算不出的原因照常", rv8?.quote);
    ok(u3Tokens.length === 3 && u3Tokens.every((t) => !g8.text.includes(t)), "CHAIN-2e 响应里搜不到别人负责的项目那几家的落地价", u3Tokens.filter((t) => g8.text.includes(t)));
    ok(String(rowBy(g8.body, "Delta Quoted")?.quote?.landedText) === `落地价 CAD ${Math.round(dTotal).toLocaleString("en-US")}`, "CHAIN-2e 本人负责的项目（P1）照常显示落地价");
    const g9 = await getTracker(MEMBER0);
    ok(String(rowBy(g9.body, "Uniform Hidden")?.quote?.landedText) === `落地价 CAD ${u3Tokens[0]}`, "CHAIN-2e P3 的负责人（普通组织成员）自己看：照常显示落地价", rowBy(g9.body, "Uniform Hidden")?.quote);
    const g10 = await getTracker(MEMBER1);
    ok(String(rowBy(g10.body, "Delta Quoted")?.quote?.landedText) === "落地价只给有财务查看权的人看" && !g10.text.includes(Math.round(dTotal).toLocaleString("en-US")) && String(rowBy(g10.body, "Epsilon CNY")?.quote?.landedText).startsWith("落地价未换算"), "CHAIN-2e P1 的只读成员：落地价不显示（搜不到），换算不出的原因照常", rowBy(g10.body, "Delta Quoted")?.quote);
    ok(g8.body.landedHidden === true && !("hintReason" in g8.body), "CHAIN-2e 有行被隐藏：响应带 landedHidden（P3 有真人负责人 → 默认那句，不带 hintReason）", { landedHidden: g8.body.landedHidden, hintReason: g8.body.hintReason });
    ok(g9.body.landedHidden === undefined, "CHAIN-2e 没有行被隐藏（P3 负责人自己看）：不带 landedHidden", g9.body.landedHidden);
    ok(String(rec(rowBy(g10.body, "Epsilon CNY")?.quote).needsCompareLink) === "true" && rec(rowBy(g10.body, "Delta Quoted")?.quote).needsCompareLink === false, "CHAIN-2e 没有权限的格子没有「去比价」链接（换算不出的照旧有）");
    // 负责人是导入用的系统账号的项目：提示改为找组织管理员
    const sysExisting = await db.user.findFirst({ where: { email: "system@qingyan.internal" }, select: { id: true } });
    const SYS = sysExisting?.id ?? (await db.user.create({ data: { email: "system@qingyan.internal", name: "System (API)", role: "user", status: "active", passwordHash: "" } })).id;
    if (!sysExisting) users.push(SYS);
    const P4 = await mkProject({ owner: SYS, name: "Fixture Tender Four" });
    await db.projectMember.create({ data: { projectId: P4, userId: MEMBER1, role: "viewer", status: "active" } });
    const r5 = await mkRound(P4, 1, ymdAfter(10));
    await mkItem(r5, await mkSupplier("Whiskey System"), { status: "quoted", sentAt: ago(2), repliedAt: ago(1), unitPrice: 12.34, totalPrice: 2468, currency: "USD", deliveryDays: 18, validUntil: ymdAfter(40), contactNotes: "threadId=thrWS", quoteNotes: autoNotes("单价=12.34；贸易条款=DDP") });
    const g11 = await getTracker(MEMBER1);
    ok(g11.body.landedHidden === true && g11.body.hintReason === "mixed", "CHAIN-2e 只读成员看 P1（有负责人）+ P4（负责人是系统账号）：提示原因 mixed", { landedHidden: g11.body.landedHidden, hintReason: g11.body.hintReason });
    await db.projectMember.deleteMany({ where: { projectId: P1, userId: MEMBER1 } });
    const g12 = await getTracker(MEMBER1);
    ok(g12.body.landedHidden === true && g12.body.hintReason === "no_owner" && String(rowBy(g12.body, "Whiskey System")?.quote?.landedText) === "落地价只给有财务查看权的人看", "CHAIN-2e 只看 P4（负责人是系统账号）：提示原因 no_owner，那一格照常写同一句", { hintReason: g12.body.hintReason, cell: rowBy(g12.body, "Whiskey System")?.quote });
    await db.projectMember.create({ data: { projectId: P1, userId: MEMBER1, role: "viewer", status: "active" } });
    const gs8 = await getTracker(OWNER, "?summary=1");
    ok(JSON.stringify(gs8.body.groups) === "[]" && gs8.body.landedHidden === undefined, "CHAIN-2e 汇总卡照常（不取矩阵、不带 landedHidden）");

    /* ---------- 9. 旧接口 ---------- */
    const old = await batchRoute.POST();
    ok(old.status === 410, "batch-followup：410");
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nT-2 rfq tracker DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
