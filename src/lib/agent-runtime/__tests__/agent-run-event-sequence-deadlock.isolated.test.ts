/**
 * AgentRunEvent 并发 sequence 分配 —— 死锁回归矩阵（隔离 Postgres）
 *
 * 背景（P0 defect）：修复前普通 append 路径**不取** AgentRun 行锁，
 * 直到插入子行时才由 FK 隐式取 `FOR KEY SHARE`；而 terminal 路径显式先取 `FOR UPDATE`。
 * 同一批资源（AgentRun 行 / `AgentRunEvent(runId,sequence)` 唯一槽 /
 * `AutopilotTelemetryOutbox.idempotencyKey` 唯一槽）被以**不同锁强度、不同时序**触碰，
 * 交错即形成等待环 → PostgreSQL `40P01 deadlock detected`。
 *
 * 修复：所有同 run 事件生产者统一 canonical lock order
 *   ① AgentRun 行 FOR UPDATE → ② max(sequence) → ③ 建 AgentRunEvent → ④ 入 outbox
 *
 * 本矩阵断言的是**并发正确性**，不是「重试到最后能成功」：
 * 任何一条出现 40P01 即判失败。
 *
 * 运行：
 *   NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx src/lib/agent-runtime/__tests__/agent-run-event-sequence-deadlock.isolated.test.ts
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 AgentRunEvent sequence deadlock 矩阵（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
  skip("需 DATABASE_ENVIRONMENT=isolated");
}
assertSafeTestDatabase({ scriptName: "agent-run-event sequence deadlock matrix" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

/** 40P01 是本矩阵的核心失败信号：出现即锁协议被破坏。 */
function isDeadlock(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return s.includes("40P01") || s.toLowerCase().includes("deadlock detected");
}

function countDeadlocks(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((r) => r.status === "rejected" && isDeadlock(r.reason)).length;
}

async function main() {
  // 捕获开启：outbox 与事件必须同事务原子落库
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";

  const { db } = await import("@/lib/db");
  const { appendAgentRunEvent, completeAgentRun, failAgentRun } = await import(
    "@/lib/agent-runtime/run"
  );

  console.log("AgentRunEvent sequence deadlock 矩阵（隔离 Postgres）");

  const tag = `seqdl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const orgA = `org_a_${tag}`;
  const orgB = `org_b_${tag}`;

  const sessionA = await db.agentSession.create({
    data: { orgId: orgA, channel: "e2e", status: "active" },
  });

  async function seedRun(orgId: string, sessionId: string) {
    return db.agentRun.create({
      data: {
        orgId,
        sessionId,
        runType: "conversation",
        status: "running",
        startedAt: new Date(),
      },
    });
  }

  /** 同一 run 的事件序列必须唯一且连续（canonical 语义：从 1 开始逐一递增）。 */
  async function sequenceShape(runId: string) {
    const rows = await db.agentRunEvent.findMany({
      where: { runId },
      orderBy: { sequence: "asc" },
      select: { sequence: true, eventType: true },
    });
    const seqs = rows.map((r) => r.sequence);
    const unique = new Set(seqs).size === seqs.length;
    const contiguous = seqs.every((s, i) => s === i + 1);
    return { rows, seqs, unique, contiguous, count: rows.length };
  }

  /* ═══════════ SEQ-DEADLOCK-01：同一 run N 路并发普通 append ═══════════ */
  console.log("━━ SEQ-DEADLOCK-01 同 run 并发 append ━━");
  {
    const run = await seedRun(orgA, sessionA.id);
    const N = 12;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        appendAgentRunEvent({
          orgId: orgA,
          runId: run.id,
          eventType: "tool.started",
          title: `concurrent-${i}`,
          payload: { i },
        }),
      ),
    );
    const deadlocks = countDeadlocks(results);
    // appendAgentRunEvent 内部吞异常返回 null，故也要看落库结果
    const fulfilledNonNull = results.filter(
      (r) => r.status === "fulfilled" && r.value !== null,
    ).length;
    const shape = await sequenceShape(run.id);

    ok(deadlocks === 0, "SEQ-DEADLOCK-01 零 40P01", { deadlocks });
    ok(shape.count === N, `SEQ-DEADLOCK-01 全部 ${N} 条事件落库`, shape.count);
    ok(fulfilledNonNull === N, "SEQ-DEADLOCK-01 无 append 被静默丢弃", fulfilledNonNull);
    ok(shape.unique, "SEQ-DEADLOCK-01 sequence 唯一", shape.seqs);
    ok(shape.contiguous, "SEQ-DEADLOCK-01 sequence 连续（1..N）", shape.seqs);
  }

  /* ═══════════ SEQ-DEADLOCK-02：append 与 completeAgentRun 并发 ═══════════ */
  console.log("━━ SEQ-DEADLOCK-02 append × complete ━━");
  {
    const run = await seedRun(orgA, sessionA.id);
    const results = await Promise.allSettled([
      ...Array.from({ length: 6 }, (_, i) =>
        appendAgentRunEvent({
          orgId: orgA,
          runId: run.id,
          eventType: "tool.started",
          title: `race-${i}`,
        }),
      ),
      completeAgentRun(orgA, run.id),
      completeAgentRun(orgA, run.id), // 重复 terminal：必须幂等
    ]);
    const deadlocks = countDeadlocks(results);
    const shape = await sequenceShape(run.id);
    const terminals = shape.rows.filter((r) => r.eventType === "run.completed").length;
    const runRow = await db.agentRun.findUnique({ where: { id: run.id } });

    ok(deadlocks === 0, "SEQ-DEADLOCK-02 零 40P01", { deadlocks });
    ok(terminals === 1, "SEQ-DEADLOCK-02 terminal 事件恰一条（幂等）", terminals);
    ok(shape.unique, "SEQ-DEADLOCK-02 sequence 唯一", shape.seqs);
    ok(shape.contiguous, "SEQ-DEADLOCK-02 sequence 连续", shape.seqs);
    ok(runRow?.status === "completed", "SEQ-DEADLOCK-02 run 终态 completed", runRow?.status);
  }

  /* ═══════════ SEQ-DEADLOCK-03：append 与 failAgentRun 并发 ═══════════ */
  console.log("━━ SEQ-DEADLOCK-03 append × fail ━━");
  {
    const run = await seedRun(orgA, sessionA.id);
    const results = await Promise.allSettled([
      ...Array.from({ length: 6 }, (_, i) =>
        appendAgentRunEvent({
          orgId: orgA,
          runId: run.id,
          eventType: "tool.finished",
          title: `race-fail-${i}`,
        }),
      ),
      failAgentRun(orgA, run.id, { code: "TOOL_ERROR", message: "boom" }),
      failAgentRun(orgA, run.id, { code: "TOOL_ERROR", message: "boom again" }),
    ]);
    const deadlocks = countDeadlocks(results);
    const shape = await sequenceShape(run.id);
    const terminals = shape.rows.filter((r) => r.eventType === "run.failed").length;
    const runRow = await db.agentRun.findUnique({ where: { id: run.id } });

    ok(deadlocks === 0, "SEQ-DEADLOCK-03 零 40P01", { deadlocks });
    ok(terminals === 1, "SEQ-DEADLOCK-03 failed terminal 恰一条", terminals);
    ok(shape.unique && shape.contiguous, "SEQ-DEADLOCK-03 sequence 唯一且连续", shape.seqs);
    ok(runRow?.status === "failed", "SEQ-DEADLOCK-03 run 终态 failed", runRow?.status);
  }

  /* ═══════════ SEQ-DEADLOCK-04：append + terminal + outbox 原子性 ═══════════ */
  console.log("━━ SEQ-DEADLOCK-04 event/outbox 原子性 ━━");
  {
    const run = await seedRun(orgA, sessionA.id);
    const results = await Promise.allSettled([
      ...Array.from({ length: 8 }, (_, i) =>
        appendAgentRunEvent({
          orgId: orgA,
          runId: run.id,
          eventType: "tool.started",
          title: `atomic-${i}`,
        }),
      ),
      completeAgentRun(orgA, run.id),
    ]);
    const deadlocks = countDeadlocks(results);
    const shape = await sequenceShape(run.id);

    // 每条 canonical 事件必须恰有一条 event 型 outbox 信封
    const eventEnvelopes = await db.autopilotTelemetryOutbox.findMany({
      where: { agentRunId: run.id, noticeType: "event" },
      select: { agentEventId: true, sequence: true },
    });
    const envIds = eventEnvelopes.map((e) => e.agentEventId).filter(Boolean) as string[];
    const missing = shape.count - envIds.length;
    const duplicate = envIds.length - new Set(envIds).size;
    const terminalEnv = await db.autopilotTelemetryOutbox.count({
      where: { agentRunId: run.id, noticeType: "run_terminal" },
    });

    ok(deadlocks === 0, "SEQ-DEADLOCK-04 零 40P01", { deadlocks });
    ok(missing === 0, "SEQ-DEADLOCK-04 零缺失 durable envelope", { missing });
    ok(duplicate === 0, "SEQ-DEADLOCK-04 零重复 durable envelope", { duplicate });
    ok(terminalEnv === 1, "SEQ-DEADLOCK-04 run_terminal 信封恰一条", terminalEnv);
    ok(shape.unique && shape.contiguous, "SEQ-DEADLOCK-04 sequence 唯一且连续", shape.seqs);
  }

  /* ═══════════ SEQ-DEADLOCK-05：不同 run 并发 —— 锁粒度必须 per-run ═══════════ */
  console.log("━━ SEQ-DEADLOCK-05 跨 run 并发（锁粒度）━━");
  {
    const RUNS = 6;
    const PER_RUN = 4;
    const runs = await Promise.all(
      Array.from({ length: RUNS }, () => seedRun(orgA, sessionA.id)),
    );

    // 基线：单 run 串行 PER_RUN 次 append 的耗时
    const baseRun = await seedRun(orgA, sessionA.id);
    const tBase0 = performance.now();
    for (let i = 0; i < PER_RUN; i++) {
      await appendAgentRunEvent({
        orgId: orgA,
        runId: baseRun.id,
        eventType: "tool.started",
        title: `base-${i}`,
      });
    }
    const baseMs = performance.now() - tBase0;

    // 跨 run 并发：若锁是表级/全局的，总耗时会退化为 ~RUNS × baseMs
    const t0 = performance.now();
    const results = await Promise.allSettled(
      runs.flatMap((r, ri) =>
        Array.from({ length: PER_RUN }, (_, i) =>
          appendAgentRunEvent({
            orgId: orgA,
            runId: r.id,
            eventType: "tool.started",
            title: `cross-${ri}-${i}`,
          }),
        ),
      ),
    );
    const elapsed = performance.now() - t0;
    const deadlocks = countDeadlocks(results);

    let allShapesOk = true;
    for (const r of runs) {
      const s = await sequenceShape(r.id);
      if (s.count !== PER_RUN || !s.unique || !s.contiguous) allShapesOk = false;
    }

    ok(deadlocks === 0, "SEQ-DEADLOCK-05 零 40P01", { deadlocks });
    ok(allShapesOk, `SEQ-DEADLOCK-05 每个 run 各自 ${PER_RUN} 条、唯一且连续`);
    // per-run 锁：并发跨 run 应显著快于完全串行（留足裕度避免环境抖动误报）
    const serialUpperBound = baseMs * RUNS;
    ok(
      elapsed < serialUpperBound,
      "SEQ-DEADLOCK-05 跨 run 不被全局串行化（锁粒度 = per run）",
      { elapsedMs: Math.round(elapsed), serialUpperBoundMs: Math.round(serialUpperBound) },
    );
  }

  /* ═══════════ SEQ-DEADLOCK-06：org mismatch fail-closed ═══════════ */
  console.log("━━ SEQ-DEADLOCK-06 跨 org fail-closed ━━");
  {
    const run = await seedRun(orgA, sessionA.id);
    const before = await db.agentRunEvent.count({ where: { runId: run.id } });
    const beforeOutbox = await db.autopilotTelemetryOutbox.count({
      where: { agentRunId: run.id },
    });

    // 用 orgB 冒充追加 orgA 的 run
    const res = await appendAgentRunEvent({
      orgId: orgB,
      runId: run.id,
      eventType: "tool.started",
      title: "cross-org",
    });

    const after = await db.agentRunEvent.count({ where: { runId: run.id } });
    const afterOutbox = await db.autopilotTelemetryOutbox.count({
      where: { agentRunId: run.id },
    });

    ok(res === null, "SEQ-DEADLOCK-06 跨 org append 返回 null（fail closed）", res);
    ok(after === before, "SEQ-DEADLOCK-06 零事件写入", { before, after });
    ok(afterOutbox === beforeOutbox, "SEQ-DEADLOCK-06 零 outbox 写入", {
      beforeOutbox,
      afterOutbox,
    });
  }

  /* ── 清理 ── */
  await db.autopilotTelemetryOutbox.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await db.agentRunEvent.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await db.agentRun.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await db.agentSession.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
