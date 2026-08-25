/**
 * B3 — 报价台账 producer：真实 DB 集成矩阵（隔离库；生产路径 transitionQuote）。
 * 运行（隔离库）：DATABASE_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 * 无隔离库自动跳过。B0 守卫先行验证目标（调用方负责用 db:target:check / 本地库）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 B3 台账 producer 矩阵（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "B3 quote ledger producer matrix" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  // producer flags：本测试进程内开启（fail-closed 语义先验证 OFF 路径）
  const { db } = await import("@/lib/db");
  const { transitionQuote } = await import("../service");
  const { appendProjectEvent } = await import("@/lib/project-ledger/event-service");
  const { quoteStatusEventKey } = await import("@/lib/project-ledger/event-keys");

  const stamp = "b3" + Date.now().toString(36);
  const ORG = `org_${stamp}`, USER = `u_${stamp}`, PROJ = `p_${stamp}`;
  await db.user.create({ data: { id: USER, email: `${USER}@f.test`, name: "B3", role: "admin" } });
  await db.organization.create({ data: { id: ORG, name: "B3 Org", code: `b3-${stamp}`, ownerId: USER } });
  await db.project.create({ data: { id: PROJ, orgId: ORG, name: "B3 Project", ownerId: USER } });
  const mkQuote = () => db.projectQuote.create({ data: { projectId: PROJ, orgId: ORG, createdById: USER, status: "draft" }, select: { id: true, updatedAt: true } });
  const events = () => db.projectEvent.findMany({ where: { projectId: PROJ }, orderBy: { seq: "asc" }, select: { seq: true, eventType: true, eventKey: true, orgId: true, stage: true, refs: true, actorType: true, actorId: true } });

  // ── 1) flag OFF：迁移成功但零台账写入（flag-gated 契约） ────────
  {
    delete process.env.T2_LEDGER_SCHEMA_READY;
    delete process.env.T2_LEDGER_PRODUCERS_ENABLED;
    const q = await mkQuote();
    await transitionQuote({ quoteId: q.id, projectId: PROJ, userId: USER, orgId: ORG, to: "cancelled" });
    const row = await db.projectQuote.findUniqueOrThrow({ where: { id: q.id }, select: { status: true } });
    ok(row.status === "cancelled" && (await events()).length === 0, "producer 关闭：状态迁移正常，零 ProjectEvent（生产 dark 期零行为变化）");
  }

  process.env.T2_LEDGER_SCHEMA_READY = "1";
  process.env.T2_LEDGER_PRODUCERS_ENABLED = "1";

  // ── 2) flag ON：transitionQuote 产出权威事件（同事务） ──────────
  {
    const q = await mkQuote();
    await transitionQuote({ quoteId: q.id, projectId: PROJ, userId: USER, orgId: ORG, to: "cancelled" });
    const evs = await events();
    ok(evs.length === 1, "迁移产出恰 1 条台账事件", evs);
    const e = evs[0];
    ok(e.eventType === "quote.cancelled", "事件类型 = quote.cancelled（dotted 约定）");
    ok(e.orgId === ORG && e.stage === "quote", "org/project/stage 作用域正确");
    ok(JSON.stringify(e.refs).includes(q.id), "refs 关联 quoteId（业务引用）");
    ok(e.actorType === "user" && e.actorId === USER, "actor 归属正确");
    ok(new RegExp(`^quote:${q.id}:cancelled:[0-9a-f]{24}$`).test(e.eventKey), "确定性 eventKey（无墙钟成分）");
    ok(e.seq >= 1, "seq 已分配（权威顺序）");
  }

  // ── 3) 幂等：同 key 重复 append → 复用既有行，不产生第二条事实 ────
  {
    const q = await mkQuote();
    const key = quoteStatusEventKey(q.id, "review", q.updatedAt.toISOString());
    const one = await db.$transaction(async (tx) => appendProjectEvent({ tx, orgId: ORG, projectId: PROJ, eventType: "quote.submitted_for_review", eventKey: key, occurredAt: new Date(), actor: { actorType: "user", actorId: USER }, stage: "quote", title: "t", payload: { i: 1 }, refs: { quoteId: q.id } }));
    const two = await db.$transaction(async (tx) => appendProjectEvent({ tx, orgId: ORG, projectId: PROJ, eventType: "quote.submitted_for_review", eventKey: key, occurredAt: new Date(), actor: { actorType: "user", actorId: USER }, stage: "quote", title: "t", payload: { i: 2 }, refs: { quoteId: q.id } }));
    const rows = await db.projectEvent.count({ where: { projectId: PROJ, eventKey: key } });
    ok(rows === 1 && one.event.id === two.event.id && one.event.seq === two.event.seq, "重复 append（同业务身份）→ 幂等复用既有事件（1 行）");
    // 再进入（不同 prevUpdatedAt）→ 新事实
    const key2 = quoteStatusEventKey(q.id, "review", new Date(q.updatedAt.getTime() + 1000).toISOString());
    await db.$transaction(async (tx) => appendProjectEvent({ tx, orgId: ORG, projectId: PROJ, eventType: "quote.submitted_for_review", eventKey: key2, occurredAt: new Date(), actor: { actorType: "user", actorId: USER }, stage: "quote", title: "t2", refs: { quoteId: q.id } }));
    ok((await db.projectEvent.count({ where: { projectId: PROJ, eventKey: { in: [key, key2] } } })) === 2, "再次进入同状态（新前置版本）→ 新事件（业务事实不吞）");
  }

  // ── 4) 原子性：台账 append 后事务抛错 → 事件与业务写一起回滚 ─────
  {
    const q = await mkQuote();
    const key = quoteStatusEventKey(q.id, "approved", q.updatedAt.toISOString());
    let threw = false;
    try {
      await db.$transaction(async (tx) => {
        await tx.projectQuote.update({ where: { id: q.id }, data: { status: "review" } });
        await appendProjectEvent({ tx, orgId: ORG, projectId: PROJ, eventType: "quote.approved", eventKey: key, occurredAt: new Date(), actor: { actorType: "user", actorId: USER }, stage: "quote", title: "t", refs: { quoteId: q.id } });
        throw new Error("simulated failure after append");
      });
    } catch { threw = true; }
    const row = await db.projectQuote.findUniqueOrThrow({ where: { id: q.id }, select: { status: true } });
    const cnt = await db.projectEvent.count({ where: { projectId: PROJ, eventKey: key } });
    ok(threw && row.status === "draft" && cnt === 0, "同事务失败 → 业务状态与台账事件一起回滚（无半提交权威状态）");
  }

  // ── 清理 ────────────────────────────────────────────────────────
  delete process.env.T2_LEDGER_SCHEMA_READY;
  delete process.env.T2_LEDGER_PRODUCERS_ENABLED;
  await db.projectEvent.deleteMany({ where: { projectId: PROJ } }).catch(() => undefined);
  await db.projectQuote.deleteMany({ where: { projectId: PROJ } });
  await db.auditLog.deleteMany({ where: { userId: USER } });
  await db.project.deleteMany({ where: { id: PROJ } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.user.deleteMany({ where: { id: USER } });

  console.log("");
  console.log(`B3 台账 producer 矩阵 结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("B3 isolated crashed:", e); process.exit(1); });
