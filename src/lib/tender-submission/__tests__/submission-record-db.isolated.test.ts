/**
 * FLOW-H4a 投标提交记录——真实 DB（隔离库），调用真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-submission/__tests__/submission-record-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H4a 提交记录 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H4a submission record DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { advanceProjectStage } = await import("@/lib/tender/stage-transition");
  const { onStageAdvancedTasks } = await import("@/lib/tender/stage-tasks");
  const { SUBMISSION_AUDIT_ACTION } = await import("../contract");
  const route = await import("@/app/api/projects/[id]/submission-record/route");

  console.log("FLOW-H4a submission record — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `srowner_${stamp}`, VIEWER = `srviewer_${stamp}`, OUTSIDER = `srout_${stamp}`;
  const OWNER2 = `srowner2_${stamp}`, PADMIN = `srpadmin_${stamp}`, SUPER = `srsuper_${stamp}`;
  const ORG = `srorg_${stamp}`, ORG_B = `srorgb_${stamp}`;
  const users = [OWNER, VIEWER, OUTSIDER, OWNER2, PADMIN, SUPER];
  const roleOf = (id: string) => (id === SUPER ? "super_admin" : "user");
  const email = (id: string) => `${id}@fixture.test`;
  const HOUR = 3_600_000, DAY = 24 * HOUR;
  process.env.TENDER_SUBMISSION_RECORD_ENABLED = "1";
  delete process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST;

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: roleOf(id) } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `sr-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `srb-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_member", status: "active" } });
  // 普通组织成员：一个是某个项目的负责人，一个是某个项目的项目管理员
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER2, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: PADMIN, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(o: { orgId?: string; ownerId?: string; workDomain?: string; data?: Rec } = {}) {
    seq += 1;
    const id = `srproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: o.orgId ?? ORG, ownerId: o.ownerId ?? OWNER, workDomain: o.workDomain ?? "tender", intakeStatus: "dispatched", status: "active", closeDate: new Date(Date.now() - 2 * DAY), ...(o.data ?? {}) } as never });
    if ((o.orgId ?? ORG) === ORG) await db.projectMember.create({ data: { projectId: id, userId: VIEWER, role: "viewer", status: "active" } });
    return id;
  }
  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: roleOf(userId) })}`;
  const get = async (projectId: string, userId: string = OWNER) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/submission-record`, { headers: { cookie: await cookieOf(userId) } }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const post = async (projectId: string, body: unknown, userId: string = OWNER) => {
    const res = await route.POST(new NextRequest(`http://localhost/api/projects/${projectId}/submission-record`, { method: "POST", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const proj = (id: string) => db.project.findUniqueOrThrow({ where: { id }, select: { submittedAt: true, tenderStatus: true, supplierQuotedAt: true, interpretedAt: true, status: true } });
  const records = (id: string) => db.auditLog.findMany({ where: { projectId: id, action: SUBMISSION_AUDIT_ACTION }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const messages = async (id: string, eventType: string) => (await db.projectMessage.findMany({ where: { projectId: id, type: "SYSTEM" }, select: { metadata: true } })).filter((m) => rec(m.metadata).eventType === eventType).length;
  const stageNotices = (id: string) => db.notification.count({ where: { userId: VIEWER, projectId: id, title: { contains: "项目提交" } } });
  const stageTasks = (id: string, prefix: string) => db.task.findMany({ where: { projectId: id, title: { startsWith: prefix } }, select: { title: true, status: true } });
  /** 阶段任务与成员通知是推进之后异步做的：等它们落库 */
  const settle = () => sleep(700);
  const snapshot = async (id: string) => JSON.stringify({ p: await proj(id), audits: await db.auditLog.count({ where: { projectId: id } }), msgs: await db.projectMessage.count({ where: { projectId: id } }), tasks: await db.task.count({ where: { projectId: id } }), notes: await db.notification.count({ where: { projectId: id } }) });

  const yesterday = new Date(Date.now() - 20 * HOUR);
  yesterday.setMilliseconds(0);
  const good = { submittedAt: yesterday.toISOString(), channel: "portal", receiptRef: "ABC-123", note: "门户提交，已下载确认页" };

  try {
    /* ---------- 0. 阶段推进函数不传新参数时与原来相同 ---------- */
    const PA = await mkProject();
    const t0 = Date.now();
    const a = await advanceProjectStage({ projectId: PA, targetStage: "submission", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: email(OWNER) }, humanConfirmed: true });
    await settle();
    const pa = await proj(PA);
    ok(a.success && a.decision === "require_human_review" && !!pa.submittedAt && Math.abs(pa.submittedAt.getTime() - t0) < 5000 && pa.tenderStatus === "bid_submitted", "阶段推进不传新参数：提交时间是点击那一刻，招投标状态是已提交（与原来相同）", { a, pa });
    const again = await advanceProjectStage({ projectId: PA, targetStage: "submission", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: email(OWNER) }, humanConfirmed: true });
    ok(again.success && again.decision === "no_op" && (await proj(PA)).submittedAt!.getTime() === pa.submittedAt!.getTime(), "再推进一次：无需操作，时间不变");
    const statusAudit = await db.auditLog.findMany({ where: { projectId: PA, action: "status_change" } });
    ok(statusAudit.length === 1 && rec(JSON.parse(statusAudit[0].afterData ?? "{}")).stage === "submission" && (await messages(PA, "stage_advanced")) === 1 && (await messages(PA, "project_submitted")) === 1, "阶段推进照旧留一条状态变更的审计、一条阶段推进的消息、一条「提交了项目」", { audits: statusAudit.length });
    // 「不为新阶段建任务」：直接调那一步。带上 skipCreate 时只关上一阶段的任务，根本不去建
    const PT = await mkProject();
    await db.task.create({ data: { title: "[供应商报价] 整理供应商报价", status: "todo", priority: "medium", projectId: PT, creatorId: OWNER, assigneeId: OWNER } as never });
    let skipErr: unknown = null;
    await onStageAdvancedTasks(PT, "supplier_quote", "submission", OWNER, { skipCreate: true }).catch((e) => { skipErr = e; });
    ok(skipErr === null && (await stageTasks(PT, "[项目提交]")).length === 0 && (await stageTasks(PT, "[供应商报价]")).every((t) => t.status === "done"), "带 skipCreate：不出错、不建「项目提交」的任务，上一阶段的自动任务被关掉", String(skipErr).slice(0, 200));
    // 不带时它会去建。目前 main 上这一步因为一个既有的错建不出来（任务表没有它要写的那一列，错误被调用方吞掉）——这里只记下现状，不当作断言
    let createErr: unknown = null;
    await onStageAdvancedTasks(PT, "supplier_quote", "submission", OWNER).catch((e) => { createErr = e; });
    console.log(`  · （现状，不是断言）不带 skipCreate 时建任务：${createErr ? "失败——" + String(createErr).replace(/\s+/g, " ").match(/Unknown argument `\w+`/)?.[0] : `建了 ${(await stageTasks(PT, "[项目提交]")).length} 条`}`);
    await db.task.deleteMany({ where: { projectId: PT, title: { startsWith: "[项目提交]" } } });
    // 调用方带着「读到的状态」去推进：库里的已经不是那个值（别人刚记了投标结果 / 放弃了项目）→ 不写
    const PE = await mkProject({ data: { tenderStatus: "won" } });
    const stale = await advanceProjectStage({ projectId: PE, targetStage: "submission", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: email(OWNER) }, humanConfirmed: true, occurredAt: new Date(Date.now() - HOUR), expected: { status: "active", tenderStatus: null } });
    const pe = await proj(PE);
    ok(stale.success && stale.decision === "no_op" && pe.submittedAt === null && pe.tenderStatus === "won" && (await messages(PE, "stage_advanced")) === 0, "带着过时的状态去推进（库里已是已中标）：无需操作，什么都没写，「已中标」没有被冲成「已提交」", { stale, pe });
    await db.project.update({ where: { id: PE }, data: { status: "abandoned", tenderStatus: null } });
    const stale2 = await advanceProjectStage({ projectId: PE, targetStage: "submission", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: email(OWNER) }, humanConfirmed: true, expected: { status: "active", tenderStatus: null } });
    ok(stale2.decision === "no_op" && (await proj(PE)).submittedAt === null, "带着过时的状态去推进（库里已放弃）：同样不写");
    const fresh2 = await advanceProjectStage({ projectId: PE, targetStage: "submission", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: email(OWNER) }, humanConfirmed: true, expected: { status: "abandoned", tenderStatus: null } });
    ok(fresh2.decision === "require_human_review" && !!(await proj(PE)).submittedAt, "状态与读到的一致：照常写入");

    /* ---------- 1. 权限、隔离、开关 ---------- */
    const P = await mkProject();
    await db.task.create({ data: { title: "[项目分发] 确认项目负责人", status: "todo", priority: "medium", projectId: P, creatorId: OWNER, assigneeId: OWNER } as never });
    const before = await snapshot(P);
    let g = await get(P, VIEWER);
    ok(g.status === 200 && rec(g.body.view).canRecord === false && rec(g.body.view).submittedAt === null && rec(g.body.view).record === null && rec(g.body.view).nextKind === "first" && rec(g.body.view).count === 0, "只读成员读取：成功，没有记录，知道自己不能记录", g.body);
    ok((await post(P, good, VIEWER)).status === 403, "只读成员记录：403");
    ok((await get(P, OUTSIDER)).status >= 400 && (await post(P, good, OUTSIDER)).status >= 400, "别的组织的人：读写都被拒");
    const notTender = await mkProject({ workDomain: "sales" });
    ok((await get(notTender)).status === 404 && (await post(notTender, good)).status === 404, "不是招投标项目：404");
    process.env.TENDER_SUBMISSION_RECORD_ENABLED = "0";
    ok((await get(P)).status === 404 && (await post(P, good)).status === 404, "开关关闭：404");
    process.env.TENDER_SUBMISSION_RECORD_ENABLED = "1";
    process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST = ORG_B;
    ok((await get(P)).status === 404 && (await post(P, good)).status === 404, "组织不在名单里：404");
    delete process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST;

    /* ---------- 2. 输入不对：什么都不写 ---------- */
    const future = await post(P, { ...good, submittedAt: new Date(Date.now() + DAY).toISOString() });
    ok(future.status === 400 && String(future.body.error).includes("不能晚于现在"), "提交时间在明天：400，说明原因", future.body);
    const money = await post(P, { ...good, note: "报了 $128,000" });
    ok(money.status === 400 && String(money.body.error).includes("不要写金额"), "备注里写了金额：400，说明这里不记金额", money.body);
    ok((await post(P, { ...good, channel: "fax" })).status === 400 && (await post(P, { ...good, submittedAt: "昨天" })).status === 400 && (await post(P, null)).status === 400, "方式不认识、时间不是时刻、内容不是对象：400");
    const day = yesterday.toISOString().slice(0, 10);
    ok((await post(P, { ...good, submittedAt: day })).status === 400 && (await post(P, { ...good, submittedAt: `${day}T10:00` })).status === 400 && (await post(P, { ...good, submittedAt: "2020" })).status === 400, "时间只有日期、不带时区、只有年份：400（不按服务器的时区去猜）");
    ok((await snapshot(P)) === before, "以上所有被拒的请求之后：项目、审计、讨论区、任务、通知都没有变化");

    /* ---------- 3. 第一次记录 ---------- */
    const first = await post(P, { ...good, orgId: ORG_B, projectId: "someone-else" });
    await settle();
    let p = await proj(P);
    ok(first.status === 200 && first.body.kind === "first" && p.submittedAt?.getTime() === yesterday.getTime() && p.tenderStatus === "bid_submitted", "第一次记录：提交时间是人填的昨天那一刻（不是现在），招投标状态是已提交", { first: first.body, p });
    ok((await stageTasks(P, "[项目提交]")).length === 0, "没有为「项目提交」阶段新建任务（「已提交」之后不该出现「提交投标」的任务）", await stageTasks(P, "[项目提交]"));
    ok((await stageTasks(P, "[项目分发]")).every((t) => t.status === "done"), "上一阶段的自动任务被关掉", await stageTasks(P, "[项目分发]"));
    let recs = await records(P);
    const r0 = rec(JSON.parse(recs[0]?.afterData ?? "{}"));
    ok(recs.length === 1 && recs[0].orgId === ORG && recs[0].userId === OWNER && recs[0].targetId === P && r0.kind === "first" && r0.submittedAt === yesterday.toISOString() && r0.channel === "portal" && r0.receiptRef === "ABC-123" && r0.note === "门户提交，已下载确认页" && Object.keys(r0).sort().join() === "channel,kind,note,receiptRef,submittedAt,v", "留下一条记录：组织取自项目（请求里带的别的组织被无视），内容是这六项、没有金额字段", { recs: recs.length, r0, org: recs[0]?.orgId });
    ok((await db.auditLog.count({ where: { projectId: P, orgId: ORG_B } })) === 0, "没有任何一条审计记在别的组织名下");
    ok((await messages(P, "project_submitted")) === 1 && (await messages(P, "stage_advanced")) === 1 && (await stageNotices(P)) === 1, "讨论区有一条「提交了项目」、一条阶段推进；成员收到一次通知（沿用阶段推进既有的行为）");
    g = await get(P, VIEWER);
    const v1 = rec(g.body.view), rv1 = rec(v1.record);
    ok(g.status === 200 && v1.submittedAt === yesterday.toISOString() && v1.nextKind === "correction" && v1.count === 1 && rv1.receiptRef === "ABC-123" && rv1.channel === "portal" && rv1.recordedByName === `Fixture ${OWNER}` && typeof rv1.recordedAt === "string" && v1.canRecord === false, "只读成员读取：看到最新的记录、谁记的、何时记的；下一次是更正", g.body);
    ok(Object.keys(v1).sort().join() === "blockedZh,canRecord,count,nextKind,record,submittedAt,syncsToSource" && v1.syncsToSource === false && !/price|amount|margin|金额|毛利/i.test(JSON.stringify(g.body)), "读取的响应只有这七项，没有任何金额相关的字段");
    ok(rec(first.body.view).canRecord === true && rec(rec(first.body.view).record).receiptRef === "ABC-123", "记录成功的响应里带着最新的内容，且标明这个人能记录");

    /* ---------- 4. 更正 ---------- */
    const noticesBefore = await stageNotices(P), advancedBefore = await messages(P, "stage_advanced"), submittedBefore = await messages(P, "project_submitted"), tasksBefore = await db.task.count({ where: { projectId: P } });
    const earlier = new Date(yesterday.getTime() - HOUR);
    const corr = await post(P, { submittedAt: earlier.toISOString(), channel: "email", receiptRef: "ABC-124" });
    await settle();
    p = await proj(P);
    recs = await records(P);
    ok(corr.status === 200 && corr.body.kind === "correction" && p.submittedAt?.getTime() === earlier.getTime() && p.tenderStatus === "bid_submitted", "更正：提交时间改成新填的值，招投标状态不变", { corr: corr.body, p });
    ok((await stageNotices(P)) === noticesBefore && (await messages(P, "stage_advanced")) === advancedBefore && (await messages(P, "project_submitted")) === submittedBefore && (await db.task.count({ where: { projectId: P } })) === tasksBefore, "更正不发阶段通知、不产生新的阶段推进或「提交了项目」的消息、不建任务");
    const r1 = rec(JSON.parse(recs[1]?.afterData ?? "{}")), b1 = rec(JSON.parse(recs[1]?.beforeData ?? "{}"));
    ok(recs.length === 2 && r1.kind === "correction" && r1.receiptRef === "ABC-124" && r1.note === null && b1.submittedAt === yesterday.toISOString() && rec(JSON.parse(recs[0].afterData ?? "{}")).receiptRef === "ABC-123", "追加了第二条记录（带着更正之前的提交时间）；第一条原样还在", { r1, b1 });
    const v2 = rec((await get(P)).body.view);
    ok(v2.count === 2 && rec(v2.record).receiptRef === "ABC-124" && rec(v2.record).channel === "email" && v2.submittedAt === earlier.toISOString() && v2.canRecord === true, "读取：最新的是第二条，共 2 次", v2);
    const same = await post(P, { submittedAt: earlier.toISOString(), channel: "email", receiptRef: "ABC-125" });
    ok(same.status === 200 && (await records(P)).length === 3 && (await proj(P)).submittedAt?.getTime() === earlier.getTime(), "只改回执编号、时间不变：照样追加一条，提交时间不动");

    /* ---------- 5. 补记：已有投标结果、没有提交时间 ---------- */
    const PW = await mkProject({ data: { tenderStatus: "won", interpretedAt: new Date(Date.now() - 9 * DAY) } });
    ok(rec((await get(PW)).body.view).nextKind === "backfill", "已中标、没有提交时间的项目（阶段记录只到项目解读）：下一次记录是「补记」");
    const back = await post(PW, good);
    await settle();
    const pw = await proj(PW);
    ok(back.status === 200 && back.body.kind === "backfill" && pw.submittedAt?.getTime() === yesterday.getTime() && pw.tenderStatus === "won", "补记：提交时间被补上，招投标状态仍是已中标", { back: back.body, pw });
    const rw = rec(JSON.parse((await records(PW))[0]?.afterData ?? "{}"));
    ok((await records(PW)).length === 1 && rw.kind === "backfill" && rw.receiptRef === "ABC-123", "补记留下的那条记录标的是「补记」", rw);
    ok((await messages(PW, "stage_advanced")) === 0 && (await stageNotices(PW)) === 0 && (await stageTasks(PW, "[项目提交]")).length === 0 && (await messages(PW, "project_submitted")) === 1, "补记不算阶段推进：没有阶段推进的消息与通知、没有新任务；讨论区记了一条「提交了项目」");
    ok(rec((await get(PW)).body.view).nextKind === "correction", "补记之后再记就是更正");
    for (const status of ["lost", "bid_submitted", "archived", "completed"]) {
      const px = await mkProject({ data: { tenderStatus: status } });
      const r = await post(px, good);
      const after = await proj(px);
      ok(r.status === 200 && r.body.kind === "backfill" && after.tenderStatus === status && after.submittedAt?.getTime() === yesterday.getTime() && (await messages(px, "stage_advanced")) === 0, `招投标状态是 ${status}、没有提交时间：只补日期，状态不被改写成别的`, { kind: r.body.kind, after });
    }
    // 没有投：没有提交可记
    for (const [status, zh] of [["no_bid", "不投标"], ["passed", "已放弃投标"], ["cancelled", "已取消"]] as const) {
      const px = await mkProject({ data: { tenderStatus: status } });
      const bx = await snapshot(px);
      const r = await post(px, good);
      const vx = rec((await get(px)).body.view);
      ok(r.status === 409 && String(r.body.error).includes(`「${zh}」`) && (await snapshot(px)) === bx && vx.nextKind === null && String(vx.blockedZh).includes(zh), `投标结果是${zh}、没有提交时间：409，说明没有提交可记，什么都没写（不会把一个没投的标算成已提交）`, { status: r.status, body: r.body, vx });
    }
    const PN = await mkProject({ data: { tenderStatus: "cancelled", submittedAt: new Date(Date.now() - 3 * DAY) } });
    const rn = await post(PN, good);
    ok(rn.status === 200 && rn.body.kind === "correction" && (await proj(PN)).tenderStatus === "cancelled", "交了之后招标取消（已有提交时间）：仍可更正，状态不变", rn.body);
    // 招投标状态是备标中（还没有结果）
    const PP = await mkProject({ data: { tenderStatus: "bid_preparation" } });
    const rp = await post(PP, good);
    await settle();
    ok(rp.status === 200 && rp.body.kind === "first" && (await proj(PP)).tenderStatus === "bid_submitted", "招投标状态是备标中（还没有结果）：按第一次记录，进入已提交", { kind: rp.body.kind, p: await proj(PP) });

    /* ---------- 6. 同时点了两次 ---------- */
    const PC = await mkProject();
    const both = await Promise.all([post(PC, good), post(PC, good)]);
    await settle();
    const pc = await proj(PC);
    ok(both.every((b) => b.status === 200) && pc.submittedAt?.getTime() === yesterday.getTime() && pc.tenderStatus === "bid_submitted", "两个相同的第一次记录同时到达：都成功，提交时间正确", both.map((b) => b.body.kind));
    ok((await messages(PC, "stage_advanced")) === 1 && (await messages(PC, "project_submitted")) === 1 && (await stageNotices(PC)) === 1, "阶段只推进了一次：一条阶段推进的消息、一条「提交了项目」、成员一次通知", { advanced: await messages(PC, "stage_advanced"), submitted: await messages(PC, "project_submitted"), notices: await stageNotices(PC) });
    const rc = (await records(PC)).map((r) => rec(JSON.parse(r.afterData ?? "{}")));
    ok(rc.length === 2 && rc.map((r) => r.kind).sort().join() === "correction,first" && rc.every((r) => r.receiptRef === "ABC-123" && r.submittedAt === yesterday.toISOString()), "留下两条记录，提交时间与回执相同（后到的那个按更正记）", rc);
    // 两次更正同时到达：依次执行，各留一条，最后的提交时间是其中之一
    const tA = new Date(yesterday.getTime() - 2 * HOUR), tB = new Date(yesterday.getTime() - 3 * HOUR);
    const two = await Promise.all([post(PC, { ...good, submittedAt: tA.toISOString(), receiptRef: "A" }), post(PC, { ...good, submittedAt: tB.toISOString(), receiptRef: "B" })]);
    const pc2 = await proj(PC);
    const lastRec = rec(JSON.parse((await records(PC)).slice(-1)[0].afterData ?? "{}"));
    ok(two.every((b) => b.status === 200) && (await records(PC)).length === 4 && pc2.submittedAt?.toISOString() === lastRec.submittedAt, "两次更正同时到达：都成功、各留一条；项目上的提交时间就是最后那条记录里的（两者没有错位）", { final: pc2.submittedAt, lastRec });

    /* ---------- 7. 已放弃 / 已归档 ---------- */
    const PX = await mkProject({ data: { status: "abandoned" } });
    const bx = await snapshot(PX);
    const refused = await post(PX, good);
    ok(refused.status === 409 && String(refused.body.error).includes("已放弃") && (await snapshot(PX)) === bx, "已放弃的项目：409，什么都没有写", refused.body);
    const vx = rec((await get(PX)).body.view);
    ok(vx.nextKind === null && String(vx.blockedZh).includes("已放弃"), "读取时说明不能记录的原因", vx);
    const PZ = await mkProject({ data: { status: "archived" } });
    const bz = await snapshot(PZ);
    const refusedZ = await post(PZ, good);
    ok(refusedZ.status === 409 && String(refusedZ.body.error).includes("已归档") && (await snapshot(PZ)) === bz, "已归档的项目：409，什么都没有写", refusedZ.body);
    // 已提交之后才归档的项目：同样不能更正
    const PZ2 = await mkProject({ data: { status: "archived", submittedAt: new Date(Date.now() - 5 * DAY), tenderStatus: "bid_submitted" } });
    ok((await post(PZ2, good)).status === 409, "已归档、已有提交时间的项目：也不能更正");

    /* ---------- 7b. 谁能记录：与写接口逐条一致 ---------- */
    const PO = await mkProject({ ownerId: OWNER2 });
    await db.projectMember.create({ data: { projectId: PO, userId: PADMIN, role: "project_admin", status: "active" } });
    const can = async (uid: string) => rec((await get(PO, uid)).body.view).canRecord;
    ok((await can(OWNER2)) === true && (await can(PADMIN)) === true && (await can(OWNER)) === true && (await can(VIEWER)) === false, "负责人（普通组织成员）、项目管理员（普通组织成员）、组织管理员：能记录；只读成员：不能", { owner2: await can(OWNER2), padmin: await can(PADMIN), orgAdmin: await can(OWNER), viewer: await can(VIEWER) });
    ok((await post(PO, good, PADMIN)).status === 200 && (await post(PO, { ...good, receiptRef: "CAD-2026-00123" }, OWNER2)).status === 200 && rec(rec((await get(PO)).body.view).record).receiptRef === "CAD-2026-00123", "项目管理员能记录；负责人能更正；回执编号里带货币代码的编号能保存");
    // 还没分发的项目：普通人读不到；超级管理员读写都行，页面上的「能不能记录」与之相符
    const PU = await mkProject({ data: { intakeStatus: "pending_dispatch" } });
    const superView = await get(PU, SUPER);
    ok((await get(PU, OWNER)).status >= 400 && superView.status === 200 && rec(superView.body.view).canRecord === true && (await post(PU, good, SUPER)).status === 200 && (await post(PU, good, OWNER)).status >= 400, "还没分发的项目：超级管理员读到「能记录」并且真的能记；其余人读写都被拒（按钮与实际权限一致）", { superView: superView.body });
    // 来自外部来源系统的项目：读取时标明第一次记录会把状态同步回去（这里只读，不触发）
    const PS = await mkProject({ data: { sourceSystem: "bidtogo" } });
    ok(rec((await get(PS)).body.view).syncsToSource === true && rec((await get(PO)).body.view).syncsToSource === false, "项目有来源系统：读取时标明会同步；没有的不标");

    /* ---------- 7c. 显示的记录与项目上的提交时间对得上 ---------- */
    // 模拟两个人同时第一次记录、填的不一样：项目上最后生效的是 B 的时间，而 A 的那条记录后写进来
    const PR = await mkProject();
    const tLate = new Date(yesterday.getTime() - 5 * HOUR);
    ok((await post(PR, { ...good, submittedAt: tLate.toISOString(), receiptRef: "B-1" })).status === 200, "（前提）B 记录成功");
    await sleep(15);
    await db.auditLog.create({ data: { userId: OWNER, orgId: ORG, projectId: PR, action: SUBMISSION_AUDIT_ACTION, targetType: "project", targetId: PR, afterData: JSON.stringify({ v: 1, kind: "first", submittedAt: yesterday.toISOString(), channel: "email", receiptRef: "A-1", note: null }) } });
    const vr = rec((await get(PR)).body.view);
    ok(vr.submittedAt === tLate.toISOString() && rec(vr.record).receiptRef === "B-1" && rec(vr.record).submittedAt === tLate.toISOString() && vr.count === 2, "后写进来的那条记的是另一个时间：页面显示的仍是与项目提交时间对得上的那一条（不把 A 的回执配上 B 的时间）；条数照实是 2", vr);
    await db.project.update({ where: { id: PR }, data: { submittedAt: new Date(yesterday.getTime() - 9 * HOUR) } });
    const vr2 = rec((await get(PR)).body.view);
    ok(vr2.record === null && vr2.count === 2 && typeof vr2.submittedAt === "string", "没有任何一条记录对得上项目上的提交时间（时间是在别处写的）：照实显示没有回执记录", vr2);
    /* ---------- 8. 别的组织自己的项目正常 ---------- */
    const PB = await mkProject({ orgId: ORG_B, ownerId: OUTSIDER });
    ok((await post(PB, good, OWNER)).status >= 400 && (await post(PB, good, OUTSIDER)).status === 200 && (await records(PB))[0]?.orgId === ORG_B, "别的组织的项目：这边的人写不了；那边自己的人能写，记录记在那边名下");
  } finally {
    delete process.env.TENDER_SUBMISSION_RECORD_ENABLED;
    delete process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST;
    await sleep(500);
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMessage.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectConversation.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H4a submission record DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
