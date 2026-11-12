/**
 * FLOW-H1c 阶段记录自动前进——真实 DB（隔离库）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender/__tests__/stage-auto-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。询价发出用注入的假发信函数，不发任何邮件。
 * 建任务的断言依赖 FIX-5（#447）：在没有它的代码上，建任务会因 sortOrder 失败。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H1c 自动前进 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H1c stage auto-advance DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { recordQuote } = await import("@/lib/inquiry/service");
  const { execTenderSendRfq } = await import("@/lib/tender-rfq/execute");
  const { hashRfqPayloadItems } = await import("@/lib/tender-rfq/round-pure");
  const { recordStageReached, AUTO_ADVANCE_AUDIT_ACTION } = await import("../stage-auto");
  const quoteRoute = await import("@/app/api/projects/[id]/inquiries/[inquiryId]/items/[itemId]/record-quote/route");

  console.log("FLOW-H1c stage auto-advance — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `saowner_${stamp}`, A = `saa_${stamp}`, ORG = `saorg_${stamp}`, ORG2 = `saorg2_${stamp}`;
  const MAILBOX = `rfq-${stamp}@fixture.test`;
  const DAY = 86_400_000;
  for (const id of [OWNER, A]) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `sa-${stamp}`, ownerId: OWNER, settingsJson: { tenderRfq: { mailboxEmail: MAILBOX } } } });
  await db.organization.create({ data: { id: ORG2, name: "Fixture Other Inc.", code: `sa2-${stamp}`, ownerId: OWNER } });
  for (const userId of [OWNER, A]) await db.organizationMember.create({ data: { orgId: ORG, userId, role: "org_admin", status: "active" } });
  await db.emailProvider.create({ data: { userId: OWNER, type: "gmail", accessToken: "fixture-not-a-token", accountEmail: MAILBOX, grantedScopes: "https://www.googleapis.com/auth/gmail.compose" } });
  const supplier = await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${stamp}`, createdById: OWNER } });
  const supplier2 = await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier B ${stamp}`, createdById: OWNER } });

  const projectIds: string[] = [];
  let seq = 0;
  type Extra = Record<string, unknown>;
  async function mkProject(extra: Extra = {}, orgId = ORG) {
    seq += 1;
    const id = `saproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active", tenderStatus: "supplier_inquiry", closeDate: new Date(Date.now() + 20 * DAY), supplierInquiredAt: new Date(Date.now() - DAY), ...extra } });
    return id;
  }
  async function mkItem(projectId: string, status: string, supplierId = supplier.id) {
    let inquiry = await db.projectInquiry.findFirst({ where: { projectId } });
    if (!inquiry) inquiry = await db.projectInquiry.create({ data: { projectId, createdById: OWNER, status: "in_progress" } });
    const item = await db.inquiryItem.create({ data: { inquiryId: inquiry.id, supplierId, status, createdById: OWNER } });
    return { inquiryId: inquiry.id, itemId: item.id };
  }
  const proj = (id: string) => db.project.findUniqueOrThrow({ where: { id }, select: { supplierQuotedAt: true, supplierInquiredAt: true, interpretedAt: true, tenderStatus: true, submittedAt: true } });
  const tasks = (projectId: string, prefix?: string) => db.task.findMany({ where: { projectId, ...(prefix ? { title: { startsWith: prefix } } : {}) }, select: { title: true, status: true, assigneeId: true, creatorId: true } });
  // 审计的前后数据按 JSON 字符串存
  const parse = (v: unknown): Record<string, unknown> => (typeof v === "string" ? JSON.parse(v) : ((v ?? {}) as Record<string, unknown>));
  const audits = async (projectId: string) => (await db.auditLog.findMany({ where: { projectId, action: AUTO_ADVANCE_AUDIT_ACTION }, select: { userId: true, beforeData: true, afterData: true } })).map((a) => ({ userId: a.userId, beforeData: parse(a.beforeData), afterData: parse(a.afterData) }));
  const cookieA = `qy_session=${await createSession({ sub: A, email: `${A}@fixture.test`, role: "user" })}`;
  async function quoteViaRoute(projectId: string, ref: { inquiryId: string; itemId: string }, unitPrice = "123.45") {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/inquiries/${ref.inquiryId}/items/${ref.itemId}/record-quote`, { method: "POST", headers: { "content-type": "application/json", cookie: cookieA, "x-org-id": ORG }, body: JSON.stringify({ unitPrice, currency: "CAD" }) });
    return quoteRoute.POST(req, { params: Promise.resolve({ id: projectId, inquiryId: ref.inquiryId, itemId: ref.itemId }) });
  }
  const setFlag = (on: boolean, allow?: string) => {
    if (on) process.env.TENDER_STAGE_AUTO_ADVANCE_ENABLED = "1"; else delete process.env.TENDER_STAGE_AUTO_ADVANCE_ENABLED;
    if (allow === undefined) delete process.env.TENDER_STAGE_AUTO_ADVANCE_ORG_ALLOWLIST; else process.env.TENDER_STAGE_AUTO_ADVANCE_ORG_ALLOWLIST = allow;
  };
  const triggers: string[] = [];

  try {
    /* ---------- 1. 开关关闭：与原来相同 ---------- */
    setFlag(false);
    const P0 = await mkProject();
    const r0 = await quoteViaRoute(P0, await mkItem(P0, "replied"));
    const p0 = await proj(P0);
    ok(r0.status === 200 && p0.supplierQuotedAt === null && (await tasks(P0)).length === 0 && (await audits(P0)).length === 0, "开关关闭：录入第一家报价成功，供应商报价时间仍为空，没有任务、没有自动前进的审计", { status: r0.status, p0 });
    const P0b = await mkProject({ supplierInquiredAt: null, tenderStatus: null });
    const off = await recordStageReached({ projectId: P0b, trigger: "analysis_ready", actorId: null });
    ok(!off.written && off.reason === "flag_off" && (await proj(P0b)).interpretedAt === null, "开关关闭：共用函数什么也不写");

    /* ---------- 2. 人工录入第一家报价 ---------- */
    setFlag(true);
    const P1 = await mkProject();
    for (const t of ["发送供应商询价单", "跟进供应商回复"]) await db.task.create({ data: { title: `[供应商询价] ${t}`, status: "todo", priority: "high", projectId: P1, creatorId: OWNER, assigneeId: OWNER } });
    const msgBefore = await db.projectMessage.count({ where: { projectId: P1 } });
    const notiBefore = await db.notification.count({ where: { projectId: P1 } });
    const ref1 = await mkItem(P1, "replied");
    const before1 = Date.now();
    const r1 = await quoteViaRoute(P1, ref1);
    const p1 = await proj(P1);
    ok(r1.status === 200 && !!p1.supplierQuotedAt && p1.supplierQuotedAt.getTime() >= before1 - 1000, "录入第一家报价：接口成功，项目的供应商报价时间被写入", { status: r1.status, p1 });
    ok((await tasks(P1, "[供应商询价]")).every((t) => t.status === "done"), "之前阶段（供应商询价）还没完成的 2 条被标为完成");
    const q1 = await tasks(P1, "[供应商报价]");
    ok(q1.length === 5 && q1.every((t) => t.assigneeId === A && t.creatorId === A && t.status === "todo"), "建出供应商报价的 5 条任务，负责人与创建人都是录入报价的 A（依赖 #447）", q1.length);
    ok(p1.tenderStatus === "supplier_inquiry", "招投标状态不变（仍是供应商询价）", p1.tenderStatus);
    await sleep(300);
    ok((await db.projectMessage.count({ where: { projectId: P1 } })) === msgBefore && (await db.notification.count({ where: { projectId: P1 } })) === notiBefore, "没有新的讨论区消息、没有新的成员通知");
    const a1 = await audits(P1);
    const after1 = a1[0]?.afterData ?? {};
    ok(a1.length === 1 && a1[0].userId === A && a1[0].beforeData.stage === "supplier_inquiry" && after1.stage === "supplier_quote" && after1.trigger === "quote_recorded" && after1.field === "supplierQuotedAt" && after1.advanced === true && after1.actorKnown === true, "一条自动前进的审计：触发、写的哪一段、前后阶段、触发的人", a1);
    ok(!JSON.stringify(a1).includes("123.45") && !/price|amount|CAD/i.test(JSON.stringify(a1)), "审计里没有报价金额与币种");
    triggers.push(String(after1.trigger));

    /* ---------- 3. 第二家报价：不再前进 ---------- */
    const stampBefore = p1.supplierQuotedAt!.getTime();
    await sleep(20);
    const r1b = await quoteViaRoute(P1, await mkItem(P1, "replied", supplier2.id), "99.00");
    ok(r1b.status === 200 && (await proj(P1)).supplierQuotedAt!.getTime() === stampBefore && (await audits(P1)).length === 1 && (await tasks(P1, "[供应商报价]")).length === 5, "第二家报价：时间不变，不再写审计，不再建任务");
    await quoteViaRoute(P1, ref1, "120.00");
    ok((await audits(P1)).length === 1, "同一家改报价（已是已报价）：也不再触发");
    const again = await recordStageReached({ projectId: P1, trigger: "quote_recorded", actorId: A });
    ok(!again.written && again.reason === "already_reached", "这一段已有时间：直接说已到过，不去写", again);

    /* ---------- 4. 回信自动解析（照它的调用方式：跳过 Muse 推送、不传触发的人） ---------- */
    const P2 = await mkProject();
    const ref2 = await mkItem(P2, "replied");
    await recordQuote({ projectId: P2, inquiryId: ref2.inquiryId, itemId: ref2.itemId }, { unitPrice: "88" }, { skipMuseHook: true });
    const a2 = await audits(P2);
    ok(!!(await proj(P2)).supplierQuotedAt && a2.length === 1 && a2[0].userId === OWNER && a2[0].afterData.actorKnown === false, "回信自动解析录入报价：同样写入；不知道是谁，审计记在项目负责人名下", a2);
    const q2 = await tasks(P2, "[供应商报价]");
    ok(q2.length === 5 && q2.every((t) => t.assigneeId === OWNER), "这一批任务的负责人是项目负责人（依赖 #447）", q2.length);
    triggers.push(String(a2[0]?.afterData?.trigger));

    /* ---------- 5. 询价发出（假发信，不发邮件） ---------- */
    const P3 = await mkProject({ supplierInquiredAt: null, tenderStatus: "pursuing", interpretedAt: new Date(Date.now() - 2 * DAY) });
    for (const t of ["精读招标文件", "确认投标资质要求"]) await db.task.create({ data: { title: `[项目解读] ${t}`, status: "todo", priority: "high", projectId: P3, creatorId: OWNER, assigneeId: OWNER } });
    const ref3 = await mkItem(P3, "pending");
    const items = [{ inquiryItemId: ref3.itemId, supplierName: supplier.name, to: "supplier@fixture.test", subject: "RFQ fixture", body: "fixture body" }];
    const sentMails: unknown[] = [];
    const fakeSend = (async (_uid: string, m: unknown) => { sentMails.push(m); return { messageId: `m_${stamp}`, threadId: `t_${stamp}` }; }) as unknown as NonNullable<Parameters<typeof execTenderSendRfq>[2]>["send"];
    const ex = await execTenderSendRfq({ projectId: P3, inquiryId: ref3.inquiryId, roundNumber: 1, fromName: "Fixture", fromEmail: MAILBOX, items, rfqDocHash: hashRfqPayloadItems(items) } as Parameters<typeof execTenderSendRfq>[0], { userId: A, role: "user", orgId: ORG }, { send: fakeSend });
    const p3 = await proj(P3);
    const a3 = await audits(P3);
    ok(ex.ok && sentMails.length === 1 && !!p3.supplierInquiredAt && p3.tenderStatus === "pursuing", "询价发出一家：阶段记录到达供应商询价；招投标状态不变", { ex, p3 });
    ok((await tasks(P3, "[项目解读]")).every((t) => t.status === "done") && a3.length === 1 && a3[0].userId === A && a3[0].afterData.trigger === "rfq_sent", "项目解读还没完成的任务被关掉；审计记在批准执行的 A 名下", a3);
    const q3 = await tasks(P3, "[供应商询价]");
    ok(q3.length === 2 && q3.every((t) => t.assigneeId === A), "建出供应商询价的 2 条，负责人是 A（依赖 #447）", q3.length);
    triggers.push(String(a3[0]?.afterData?.trigger));

    /* ---------- 6. 分析收尾（直接调共用函数；接线由纯逻辑测试核对） ---------- */
    const P4 = await mkProject({ supplierInquiredAt: null, tenderStatus: null });
    const r4 = await recordStageReached({ projectId: P4, trigger: "analysis_ready", actorId: null });
    const q4 = await tasks(P4, "[项目解读]");
    ok(r4.written && r4.advanced && r4.from === "distribution" && r4.to === "interpretation" && !!(await proj(P4)).interpretedAt, "分析收尾：已分发的项目到达项目解读", r4);
    ok(q4.length === 3 && q4.every((t) => t.assigneeId === OWNER), "建出项目解读的 3 条，负责人是项目负责人（依赖 #447）", q4.length);
    triggers.push("analysis_ready");
    ok(triggers.join() === "quote_recorded,quote_recorded,rfq_sent,analysis_ready", "三种触发都走过", triggers);

    /* ---------- 7. 不前进的情形 ---------- */
    const cases: Array<[string, Extra, string]> = [
      ["已放弃的项目", { status: "abandoned" }, "not_active"],
      ["已归档的项目", { status: "archived" }, "not_active"],
      ["未中标的项目", { tenderStatus: "lost" }, "has_result"],
      ["不投标的项目", { tenderStatus: "no_bid" }, "has_result"],
      ["不是招投标的项目", { workDomain: "sales" }, "not_tender"],
    ];
    for (const [label, extra] of cases) {
      const P = await mkProject(extra);
      await recordQuote(await (async () => { const r = await mkItem(P, "replied"); return { projectId: P, ...r }; })(), { unitPrice: "10" }, { actorId: A });
      ok((await proj(P)).supplierQuotedAt === null && (await tasks(P)).length === 0 && (await audits(P)).length === 0, `${label}录入第一家报价：不写时间、没有任务、没有审计（报价照常录入）`);
    }
    const reasons = await Promise.all(cases.map(async ([, extra]) => { const P = await mkProject(extra); return (await recordStageReached({ projectId: P, trigger: "quote_recorded", actorId: A })) as { reason?: string }; }));
    ok(reasons.map((r) => r.reason).join() === cases.map((c) => c[2]).join(), "共用函数给出的原因与情形对得上", reasons);

    const P8 = await mkProject({ tenderStatus: "bid_submitted", submittedAt: new Date(Date.now() - DAY) });
    await recordQuote({ projectId: P8, ...(await mkItem(P8, "replied")) }, { unitPrice: "10" }, { actorId: A });
    const a8 = await audits(P8);
    ok(!!(await proj(P8)).supplierQuotedAt && (await tasks(P8)).length === 0 && a8.length === 1 && a8[0].afterData.advanced === false && a8[0].afterData.stage === "submission", "已提交的项目录入报价：时间写入，但阶段记录仍是项目提交，不建不关任务", a8);

    const P11 = await mkProject({ interpretedAt: null });
    const r11 = await recordStageReached({ projectId: P11, trigger: "analysis_ready", actorId: A });
    ok(r11.written && !r11.advanced && r11.to === "supplier_inquiry" && !!(await proj(P11)).interpretedAt && (await tasks(P11)).length === 0, "已在供应商询价、项目解读时间还空着：分析收尾补上时间，阶段记录不变，不建任务", r11);

    /* ---------- 8. 白名单 ---------- */
    setFlag(true, ORG2);
    const P9 = await mkProject();
    await recordQuote({ projectId: P9, ...(await mkItem(P9, "replied")) }, { unitPrice: "10" }, { actorId: A });
    ok((await proj(P9)).supplierQuotedAt === null && (await audits(P9)).length === 0, "白名单里没有这个组织：不前进");
    setFlag(true);

    /* ---------- 9. 并发：同时两次只前进一次 ---------- */
    const P10 = await mkProject();
    const both = await Promise.all([recordStageReached({ projectId: P10, trigger: "quote_recorded", actorId: A }), recordStageReached({ projectId: P10, trigger: "quote_recorded", actorId: OWNER })]);
    ok(both.filter((r) => r.written).length === 1 && (await audits(P10)).length === 1 && (await tasks(P10, "[供应商报价]")).length === 5, "同时触发两次：只写一次、一条审计、一批任务", both);

    /* ---------- 10. 自动前进失败不影响录入报价 ---------- */
    const PF = await mkProject();
    const refF = await mkItem(PF, "replied");
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION h1c_fail_${stamp}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'h1c fixture: project update refused'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER h1c_fail_${stamp} BEFORE UPDATE ON "Project" FOR EACH ROW WHEN (NEW."id" = '${PF}' AND NEW."supplierQuotedAt" IS NOT NULL) EXECUTE FUNCTION h1c_fail_${stamp}()`);
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => { errors.push(a); };
    let rF: Response | null = null;
    try { rF = await quoteViaRoute(PF, refF); } finally {
      console.error = origError;
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS h1c_fail_${stamp} ON "Project"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS h1c_fail_${stamp}()`);
    }
    const itemF = await db.inquiryItem.findUniqueOrThrow({ where: { id: refF.itemId }, select: { status: true } });
    ok(rF?.status === 200 && itemF.status === "quoted" && (await proj(PF)).supplierQuotedAt === null && errors.some((e) => String((e as unknown[])[0]).includes("[StageAuto] quote_recorded failed")), "写阶段时间被数据库拒绝：录入报价照样成功，留下错误日志", { status: rF?.status, item: itemF.status, errors: errors.length });
  } finally {
    setFlag(false);
    await sleep(300);
    await db.notification.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMessage.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectConversation.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { projectId: { in: projectIds } }] } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.emailProvider.deleteMany({ where: { userId: OWNER } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, A] } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H1c stage auto-advance DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
