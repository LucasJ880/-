/**
 * FLOW-H4c 提交记录接进可投标判定——真实 DB（隔离库）+ 真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-bid-workspace/__tests__/readiness-submission-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不调任何模型，不发任何请求。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H4c 提交记录接进可投标判定 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H4c readiness submission DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { advanceProjectStage } = await import("@/lib/tender/stage-transition");
  const { SUBMISSION_AUDIT_ACTION, SUBMISSION_AUDIT_TARGET } = await import("@/lib/tender-submission/contract");
  const { WINDOW_EXPIRED_ZH, WINDOW_EXPIRED_NO_RECEIPT_ZH, WINDOW_EXPIRED_NO_RECEIPT_PLAIN_ZH, REVIEW_ONLY_ZH } = await import("@/lib/tender-bid-readiness/readiness");
  const wsRoute = await import("@/app/api/projects/[id]/bid-workspace/route");
  const costRoute = await import("@/app/api/projects/[id]/bid-workspace/cost-sheet/route");
  const recordRoute = await import("@/app/api/projects/[id]/submission-record/route");
  const { OTTAWA_18026_LINES } = await import("@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026");
  const { OTTAWA_SYNTHETIC_SCENARIO } = await import("@/lib/tender-bid-cost/__tests__/fixtures/ottawa-synthetic-scenario");

  console.log("FLOW-H4c readiness × submission record — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `h4cowner_${stamp}`, OUTSIDER = `h4cout_${stamp}`;
  const ORG = `h4corg_${stamp}`, ORG_B = `h4corgb_${stamp}`;
  const users = [OWNER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000, HOUR = 3_600_000;
  process.env.TENDER_BID_WORKSPACE_ENABLED = "1";
  delete process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST;
  process.env.TENDER_SUBMISSION_RECORD_ENABLED = "1";
  delete process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST;

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `h4c-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `h4cb-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(o: { closeInDays?: number; data?: Rec } = {}) {
    seq += 1;
    const id = `h4cproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active", closeDate: new Date(Date.now() + (o.closeInDays ?? -2) * DAY), ...(o.data ?? {}) } as never });
    return id;
  }
  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const call = async (h: unknown, method: string, url: string, projectId: string, body?: unknown) => {
    const res = await (h as (r: unknown, c: unknown) => Promise<Response>)(
      new NextRequest(url, { method, headers: { cookie: await cookie(OWNER), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const text = await res.text();
    let parsed: Rec = {};
    try { parsed = rec(JSON.parse(text)); } catch { /* 不是 JSON */ }
    return { status: res.status, body: parsed, text };
  };
  const workspace = (pid: string) => call(wsRoute.GET, "GET", `http://localhost/api/projects/${pid}/bid-workspace`, pid);
  const saveSchedule = (pid: string) => call(wsRoute.PUT, "PUT", `http://localhost/api/projects/${pid}/bid-workspace`, pid, { priceSchedule: { lines: OTTAWA_18026_LINES } });
  const costBody = {
    label: "合成数据",
    lines: OTTAWA_SYNTHETIC_SCENARIO.lines.map(({ line, ...rest }) => ({ lineNo: line.lineNo, ...rest })),
    importGst: OTTAWA_SYNTHETIC_SCENARIO.importGst, freight: OTTAWA_SYNTHETIC_SCENARIO.freight, reserves: OTTAWA_SYNTHETIC_SCENARIO.reserves, pricing: OTTAWA_SYNTHETIC_SCENARIO.pricing,
  };
  const costSheet = (pid: string) => call(costRoute.POST, "POST", `http://localhost/api/projects/${pid}/bid-workspace/cost-sheet`, pid, costBody);
  const record = (pid: string, body: Rec) => call(recordRoute.POST, "POST", `http://localhost/api/projects/${pid}/submission-record`, pid, body);
  /** 判定里截标窗口那一项：阻断项的文字（没有 = null）与有没有「已提交」的提示 */
  const windowOf = (readiness: unknown) => {
    const r = rec(readiness);
    return { expired: (arr(r.blockers).find((b) => b.code === "WINDOW_EXPIRED")?.messageZh as string | undefined) ?? null, submitted: arr(r.warnings).some((w) => w.code === "ALREADY_SUBMITTED"), state: r.state as string | undefined, stateZh: r.stateZh as string | undefined };
  };
  const wsWindow = async (pid: string) => {
    const r = await workspace(pid);
    return { status: r.status, ...windowOf(rec(r.body.view).readiness), text: r.text };
  };
  const at = (msAgo: number) => { const d = new Date(Date.now() - msAgo); d.setMilliseconds(0); return d.toISOString(); };

  try {
    /* ---------- 1. 没有提交时间：文字与原来相同 ---------- */
    const P1 = await mkProject();
    ok((await saveSchedule(P1)).status === 200, "前提：存下价格表（成本核算表要用）");
    let w = await wsWindow(P1);
    ok(w.status === 200 && w.expired === WINDOW_EXPIRED_ZH && !w.submitted, "截标已过、没有提交：「已过截标，且没有带回执的提交记录」", w);

    /* ---------- 2. 记了回执：工作区与成本核算表都不再报 ---------- */
    const NOTE = "门户提交，确认页已下载 h4c-note";
    const r1 = await record(P1, { submittedAt: at(20 * HOUR), channel: "portal", receiptRef: "ABC-123", note: NOTE });
    ok(r1.status === 200, "经提交记录接口记下提交时间与回执编号", r1.body);
    w = await wsWindow(P1);
    ok(w.expired === null && w.submitted && w.state === "REVIEW_ONLY" && w.stateZh === REVIEW_ONLY_ZH, "记了回执：工作区的判定没有「已过截标」，有「已有带回执的提交记录」的提示，判定是「已交标（仅供复盘）」", w);
    const sheet = await costSheet(P1);
    const sw = windowOf(sheet.body.readiness);
    ok(sheet.status === 200 && sw.expired === null && sw.submitted && sw.state === "REVIEW_ONLY", "成本核算表的判定也一样（不会因为没有别的阻断项就说「可提交 Owner 决定」）", { status: sheet.status, sw });
    ok(!w.text.includes("ABC-123") && !w.text.includes(NOTE) && !sheet.text.includes("ABC-123") && !sheet.text.includes(NOTE), "工作区与成本核算表的响应里都不出现回执编号与备注");

    // 提交记录的开关后来关了：已经记下的回执仍然算数
    process.env.TENDER_SUBMISSION_RECORD_ENABLED = "0";
    w = await wsWindow(P1);
    ok(w.expired === null && w.submitted, "提交记录的开关关了：已经记下的回执仍然算数", w);
    process.env.TENDER_SUBMISSION_RECORD_ENABLED = "1";

    /* ---------- 3. 更正之后按更正的那条算 ---------- */
    const r2 = await record(P1, { submittedAt: at(21 * HOUR), channel: "portal", receiptRef: null, note: null });
    ok(r2.status === 200, "更正提交时间（这次没填回执编号）", r2.body);
    w = await wsWindow(P1);
    ok(w.expired === WINDOW_EXPIRED_NO_RECEIPT_ZH && !w.submitted, "更正之后按更正的那条算：仍有「已过截标」，写明去补回执编号", w);
    ok((await costSheet(P1)).body.readiness !== undefined && windowOf((await costSheet(P1)).body.readiness).expired === WINDOW_EXPIRED_NO_RECEIPT_ZH, "成本核算表也按更正的那条算");

    /* ---------- 4. 记了但没有回执编号 ---------- */
    const P2 = await mkProject();
    ok((await record(P2, { submittedAt: at(10 * HOUR), channel: "email", receiptRef: null, note: null })).status === 200, "记录时回执编号留空");
    w = await wsWindow(P2);
    ok(w.expired === WINDOW_EXPIRED_NO_RECEIPT_ZH && w.expired.includes("「提交记录」里补上回执编号") && w.state === "NOT_READY", "记了但没有回执编号：仍有「已过截标」（不可投标），写明去「提交记录」里补", w);
    // 「提交记录」对这个组织没开：不指向一个看不到的地方
    process.env.TENDER_SUBMISSION_RECORD_ENABLED = "0";
    w = await wsWindow(P2);
    ok(w.expired === WINDOW_EXPIRED_NO_RECEIPT_PLAIN_ZH, "「提交记录」对这个组织没开：只说有提交时间、没有回执编号，不指向「提交记录」", w);
    process.env.TENDER_SUBMISSION_RECORD_ENABLED = "1";
    // 一条更晚写下、带回执、但时间与项目当前提交时间对不上的记录：不算
    await sleep(20);
    await db.auditLog.create({ data: { userId: OWNER, orgId: ORG, projectId: P2, action: SUBMISSION_AUDIT_ACTION, targetType: SUBMISSION_AUDIT_TARGET, targetId: P2, afterData: JSON.stringify({ v: 1, kind: "correction", submittedAt: at(30 * HOUR), channel: "portal", receiptRef: "LATER-1", note: null }) } });
    w = await wsWindow(P2);
    ok(w.expired === WINDOW_EXPIRED_NO_RECEIPT_ZH && !w.submitted, "更晚写下的、带回执、但时间对不上的记录：不算（按与项目当前提交时间对得上的那条）", w);

    /* ---------- 5. 提交时间是在对话里推进阶段写下的（没有记录） ---------- */
    const P3 = await mkProject();
    const adv = await advanceProjectStage({ projectId: P3, targetStage: "submission", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: email(OWNER) }, humanConfirmed: true });
    await sleep(500);
    ok(adv.success === true && !!(await db.project.findUniqueOrThrow({ where: { id: P3 }, select: { submittedAt: true } })).submittedAt, "前提：阶段推进写下了提交时间");
    w = await wsWindow(P3);
    ok(w.expired === WINDOW_EXPIRED_NO_RECEIPT_ZH, "只有提交时间、没有记录：写明去补回执编号", w);

    /* ---------- 6. 别的项目、别的组织的记录不算 ---------- */
    const P4 = await mkProject();
    ok((await record(P4, { submittedAt: at(5 * HOUR), channel: "portal", receiptRef: "OTHER-9", note: null })).status === 200, "同组织另一个项目记了带回执的提交");
    const P5 = await mkProject();
    const p5At = new Date(at(5 * HOUR));
    await db.project.update({ where: { id: P5 }, data: { submittedAt: p5At, tenderStatus: "bid_submitted" } });
    // 一条记在别的组织名下、指向本项目、时间对得上、带回执的审计行（不该有的数据）
    await db.auditLog.create({ data: { userId: OUTSIDER, orgId: ORG_B, projectId: P5, action: SUBMISSION_AUDIT_ACTION, targetType: SUBMISSION_AUDIT_TARGET, targetId: P5, afterData: JSON.stringify({ v: 1, kind: "first", submittedAt: p5At.toISOString(), channel: "portal", receiptRef: "FORGED-1", note: null }) } });
    // 一条记在本组织、指向别的项目、时间对得上、带回执的审计行
    await db.auditLog.create({ data: { userId: OWNER, orgId: ORG, projectId: P4, action: SUBMISSION_AUDIT_ACTION, targetType: SUBMISSION_AUDIT_TARGET, targetId: P4, afterData: JSON.stringify({ v: 1, kind: "first", submittedAt: p5At.toISOString(), channel: "portal", receiptRef: "WRONG-PROJ", note: null }) } });
    w = await wsWindow(P5);
    ok(w.expired === WINDOW_EXPIRED_NO_RECEIPT_ZH && !w.submitted, "别的组织名下的、别的项目的记录（时间对得上、带回执）：都不算", w);
    w = await wsWindow(P4);
    ok(w.expired === null && w.submitted, "那个项目自己：记了回执，不报", w);
    // 同一项目上之后又有 25 条别的动作的审计行（同一个对象）：真正的记录不被挤出去
    for (let i = 0; i < 25; i++) await db.auditLog.create({ data: { userId: OWNER, orgId: ORG, projectId: P4, action: "tender.fixture.other", targetType: SUBMISSION_AUDIT_TARGET, targetId: P4, afterData: JSON.stringify({ v: 1, kind: "first", submittedAt: at(9 * HOUR), channel: "portal", receiptRef: null, note: null }) } });
    w = await wsWindow(P4);
    ok(w.expired === null && w.submitted, "之后又有 25 条别的动作的审计行：只看提交记录那一种，真正的记录还在", w);

    /* ---------- 7. 截标还没到 ---------- */
    const P6 = await mkProject({ closeInDays: 3 });
    ok((await record(P6, { submittedAt: at(2 * HOUR), channel: "portal", receiptRef: null, note: null })).status === 200, "截标还没到时提前交了（没填回执编号）");
    w = await wsWindow(P6);
    ok(w.expired === null && !w.submitted, "截标还没到：没有「已过截标」，也没有「已提交」的提示", w);
  } finally {
    delete process.env.TENDER_BID_WORKSPACE_ENABLED;
    delete process.env.TENDER_SUBMISSION_RECORD_ENABLED;
    await sleep(800);
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.notification.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMessage.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H4c readiness × submission record DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
