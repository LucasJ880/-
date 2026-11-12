/**
 * FIX-6 阶段已到、招投标状态落后时补状态——真实 DB（隔离库）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender/__tests__/stage-status-catch-up-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；状态回调的请求被拦下，不发到任何地方。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-6 补状态 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-6 stage status catch-up DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db } = await import("@/lib/db");
  const { advanceProjectStage } = await import("../stage-transition");

  console.log("FIX-6 stage status catch-up — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `scowner_${stamp}`, B = `scb_${stamp}`, ORG = `scorg_${stamp}`, SYS = `bt_${stamp}`;
  const DAY = 86_400_000;
  const T_INQ = new Date(Date.now() - 3 * DAY), T_QUOTE = new Date(Date.now() - DAY);
  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Fixture Owner", role: "user" } });
  await db.user.create({ data: { id: B, email: `${B}@fixture.test`, name: "Fixture B", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `sc-${stamp}`, ownerId: OWNER } });
  for (const userId of [OWNER, B]) await db.organizationMember.create({ data: { orgId: ORG, userId, role: "org_admin", status: "active" } });
  const endpoint = await db.webhookEndpoint.create({ data: { system: SYS, url: `https://webhook-${stamp}.fixture.invalid/hook`, secret: "fixture-secret", events: "[\"*\"]" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(extra: Record<string, unknown> = {}, withSource = true) {
    seq += 1;
    const id = `scproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active", tenderStatus: "supplier_inquiry", interpretedAt: new Date(Date.now() - 5 * DAY), supplierInquiredAt: T_INQ, supplierQuotedAt: T_QUOTE, ...(withSource ? { sourceSystem: SYS } : {}), ...extra } });
    if (withSource) await db.externalReference.create({ data: { system: SYS, externalId: `ext_${stamp}_${seq}`, projectId: id } });
    return id;
  }
  // 由 B 点确认：项目负责人 OWNER 不是操作人，正常推进时会收到「已推进」的通知（见对照用例）
  const actor = { id: B, name: "Fixture B", email: `${B}@fixture.test` };
  const advance = (projectId: string, targetStage: "interpretation" | "supplier_inquiry" | "supplier_quote" | "submission", humanConfirmed = true) =>
    advanceProjectStage({ projectId, targetStage, reason: "fixture", source: "manual", actor, humanConfirmed });
  const proj = (id: string) => db.project.findUniqueOrThrow({ where: { id }, select: { tenderStatus: true, supplierQuotedAt: true, supplierInquiredAt: true, submittedAt: true, interpretedAt: true } });
  const parse = (v: unknown): Record<string, unknown> => (typeof v === "string" ? JSON.parse(v) : ((v ?? {}) as Record<string, unknown>));
  const audits = async (projectId: string) => (await db.auditLog.findMany({ where: { projectId, action: "status_change" }, select: { afterData: true, beforeData: true, userId: true } })).map((a) => ({ userId: a.userId, before: parse(a.beforeData), after: parse(a.afterData) }));

  // 拦下所有对外请求：只记下发到了哪里、发了什么
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const callsFor = (projectId: string) => calls.filter((c) => c.body.project_id === projectId);

  try {
    /* ---------- 1. 补状态 ---------- */
    const P1 = await mkProject();
    const keep = await db.task.create({ data: { title: "[供应商报价] 汇总供应商报价", status: "todo", priority: "high", projectId: P1, creatorId: OWNER, assigneeId: OWNER } });
    const msgBefore = await db.projectMessage.count({ where: { projectId: P1 } });
    const notiBefore = await db.notification.count({ where: { projectId: P1 } });
    const r1 = await advance(P1, "supplier_quote");
    await sleep(400); // 回调不等结果
    const p1 = await proj(P1);
    ok(r1.success && r1.decision === "require_human_review" && /已同步/.test(r1.reason), "阶段已到、状态落后、人确认：返回成功，说明已同步状态", r1);
    ok(p1.tenderStatus === "supplier_quote", "招投标状态变成「供应商报价」", p1.tenderStatus);
    ok(p1.supplierQuotedAt!.getTime() === T_QUOTE.getTime() && p1.supplierInquiredAt!.getTime() === T_INQ.getTime() && p1.submittedAt === null, "阶段时间都没动");
    const a1 = await audits(P1);
    ok(a1.length === 1 && a1[0].after.statusCatchUp === true && a1[0].after.humanConfirmed === true && a1[0].before.tenderStatus === "supplier_inquiry" && a1[0].after.tenderStatus === "supplier_quote" && a1[0].userId === B, "一条审计：标明补状态、人已确认、前后状态、操作人", a1);
    ok((await db.projectMessage.count({ where: { projectId: P1 } })) > msgBefore, "讨论区有一条状态变化");
    const c1 = callsFor(P1);
    ok(c1.length === 1 && c1[0].url === endpoint.url && c1[0].body.event === "project.status_changed" && c1[0].body.old_status === "supplier_inquiry" && c1[0].body.new_status === "supplier_quote" && c1[0].body.external_ref_system === SYS, "发出一次状态回调到配置的接收地址：供应商询价 → 供应商报价", c1);
    const tasks1 = await db.task.findMany({ where: { projectId: P1 }, select: { id: true, status: true } });
    ok(tasks1.length === 1 && tasks1[0].id === keep.id && tasks1[0].status === "todo", "没有新任务，已有任务不变");
    ok((await db.notification.count({ where: { projectId: P1 } })) === notiBefore, "没有新的成员通知");

    /* ---------- 2. 再点一次：不再补 ---------- */
    const r1b = await advance(P1, "supplier_quote");
    await sleep(300);
    ok(r1b.success && r1b.decision === "no_op" && (await audits(P1)).length === 1 && callsFor(P1).length === 1, "再点一次：「无需重复推进」，不再写审计、不再发回调", r1b);

    /* ---------- 3. 不补的情形 ---------- */
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ["没有人确认", {}, false],
      ["项目已放弃", { status: "abandoned" }, true],
      ["已归档", { status: "archived" }, true],
      ["状态是未中标", { tenderStatus: "lost" }, true],
      ["状态已是供应商报价", { tenderStatus: "supplier_quote" }, true],
      ["状态是投标准备（更靠后）", { tenderStatus: "bid_preparation" }, true],
      ["状态认不出", { tenderStatus: "custom_by_hand" }, true],
    ];
    for (const [label, extra, confirmed] of cases) {
      const P = await mkProject(extra);
      const before = (await proj(P)).tenderStatus;
      const r = await advance(P, "supplier_quote", confirmed);
      await sleep(150);
      ok(r.success && r.decision === "no_op" && (await proj(P)).tenderStatus === before && (await audits(P)).length === 0 && callsFor(P).length === 0, `${label}：「无需重复推进」，状态不变，没有审计、没有回调`, { r, before });
    }

    /* ---------- 4. 状态为空、项目解读已到 ---------- */
    const P4 = await mkProject({ tenderStatus: null, supplierInquiredAt: null, supplierQuotedAt: null }, false);
    const r4 = await advance(P4, "interpretation");
    await sleep(200);
    ok(r4.success && (await proj(P4)).tenderStatus === "pursuing" && (await audits(P4)).length === 1 && callsFor(P4).length === 0, "状态为空、项目解读已到：补成「跟进中」；没有来源系统就不发回调", r4);

    /* ---------- 5. 正常推进不受影响 ---------- */
    const P5 = await mkProject({ supplierQuotedAt: null });
    const r5 = await advance(P5, "supplier_quote");
    await sleep(400);
    const p5 = await proj(P5);
    ok(r5.success && r5.decision === "require_human_review" && !/已同步/.test(r5.reason) && !!p5.supplierQuotedAt && p5.tenderStatus === "supplier_quote" && callsFor(P5).length === 1, "阶段还没到：照原来正常推进（写时间、改状态、发一次回调）", r5);
    ok((await db.notification.count({ where: { projectId: P5, userId: OWNER } })) >= 1, "对照：正常推进时项目负责人收到了「已推进」的通知（所以补状态那条「没有通知」不是空的）");

    /* ---------- 6. 同时点两次 ---------- */
    const P6 = await mkProject();
    const both = await Promise.all([advance(P6, "supplier_quote"), advance(P6, "supplier_quote")]);
    await sleep(400);
    ok(both.filter((r) => /已同步/.test(r.reason)).length === 1 && (await audits(P6)).length === 1 && callsFor(P6).length === 1 && (await proj(P6)).tenderStatus === "supplier_quote", "同时点两次：只补一次（一条审计、一次回调）", both);

    /* ---------- 7. 读之后状态被别人改了：不补 ---------- */
    const P7 = await mkProject();
    const delegate = db.project as unknown as { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> };
    const realFind = delegate.findUnique.bind(delegate);
    await db.project.update({ where: { id: P7 }, data: { tenderStatus: "lost" } });
    delegate.findUnique = async (a: unknown) => { const r = await realFind(a); return r && (a as { where?: { id?: string } }).where?.id === P7 ? { ...r, tenderStatus: "supplier_inquiry" } : r; };
    let r7: Awaited<ReturnType<typeof advance>>;
    try { r7 = await advance(P7, "supplier_quote"); } finally { delegate.findUnique = realFind; }
    await sleep(200);
    ok(r7.decision === "no_op" && (await proj(P7)).tenderStatus === "lost" && (await audits(P7)).length === 0 && callsFor(P7).length === 0, "读到的是供应商询价、写的时候已被记成未中标：不补，不发回调", r7);
  } finally {
    globalThis.fetch = realFetch;
    await sleep(300);
    await db.notification.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMessage.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectConversation.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { projectId: { in: projectIds } }] } });
    await db.externalReference.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.webhookEndpoint.deleteMany({ where: { system: SYS } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, B] } } });
    await db.$disconnect();
  }

  console.log(`\nFIX-6 stage status catch-up DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
