/**
 * Autopilot A1-P0 isolated Postgres E2E.
 *
 * Guard-first：安全检查完成前不得 import @/lib/db。
 * 生产库 → HARD FAIL。未配置 URL / 未显式开启 E2E → skip (exit 0)。
 *
 * 运行（隔离库，禁止生产 URL）：
 *   NODE_ENV=test AUTOPILOT_A1P0_E2E=1 DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx src/lib/autopilot/__tests__/durability-e2e.isolated.test.ts
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 Autopilot A1-P0 isolated E2E（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  skip("未提供 DATABASE_URL");
}
if (process.env.NODE_ENV !== "test") {
  skip("需 NODE_ENV=test");
}
if (
  process.env.AUTOPILOT_A1P0_E2E !== "1" &&
  (process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated"
) {
  skip("需 AUTOPILOT_A1P0_E2E=1 或 DATABASE_ENVIRONMENT=isolated");
}

assertSafeTestDatabase({
  scriptName: "autopilot A1-P0 isolated postgres e2e",
});

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

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

async function main() {
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "1";

  const { db } = await import("@/lib/db");
  const {
    appendAgentRunEvent,
    completeAgentRun,
    failAgentRun,
    cancelAgentRun,
  } = await import("@/lib/agent-runtime/run");
  const {
    AUTOPILOT_OUTBOX_MAX_ATTEMPTS,
    claimAutopilotOutboxBatch,
    enqueueAutopilotTelemetryOutbox,
    recoverExpiredMaxAttemptOutbox,
  } = await import("@/lib/autopilot/outbox");
  const { processAutopilotTelemetryOutbox } = await import(
    "@/lib/autopilot/processor"
  );

  console.log("autopilot A1-P0 isolated Postgres E2E");

  const tag = `a1p0_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const orgA = `org_a_${tag}`;
  const orgB = `org_b_${tag}`;

  const session = await db.agentSession.create({
    data: { orgId: orgA, channel: "e2e", status: "active" },
  });
  const sessionB = await db.agentSession.create({
    data: { orgId: orgB, channel: "e2e", status: "active" },
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

  const insertLatencies: number[] = [];
  const runAtomic = await seedRun(orgA, session.id);

  // 1. canonical event + outbox envelope commit atomically
  const tInsert0 = performance.now();
  const ev1 = await appendAgentRunEvent({
    orgId: orgA,
    runId: runAtomic.id,
    eventType: "tool.started",
    title: "tool",
    payload: { name: "e2e" },
  });
  insertLatencies.push(performance.now() - tInsert0);
  ok(!!ev1, "1: canonical event persisted");
  const out1 = await db.autopilotTelemetryOutbox.findFirst({
    where: { agentEventId: ev1?.id ?? "__none__" },
  });
  ok(!!out1 && out1.orgId === orgA, "1: matching outbox envelope exists");
  ok(out1?.sequence === ev1?.sequence, "1: envelope sequence matches canonical");

  // 2. forced outbox insert failure rolls back canonical event
  await db.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION autopilot_a1p0_fail_outbox() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'forced outbox failure';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await db.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS autopilot_a1p0_fail_outbox ON "AutopilotTelemetryOutbox"`,
  );
  await db.$executeRawUnsafe(`
    CREATE TRIGGER autopilot_a1p0_fail_outbox
    BEFORE INSERT ON "AutopilotTelemetryOutbox"
    FOR EACH ROW EXECUTE FUNCTION autopilot_a1p0_fail_outbox()
  `);
  const beforeCount = await db.agentRunEvent.count({
    where: { runId: runAtomic.id },
  });
  try {
    const rolled = await appendAgentRunEvent({
      orgId: orgA,
      runId: runAtomic.id,
      eventType: "tool.completed",
      title: "should rollback",
    });
    const afterCount = await db.agentRunEvent.count({
      where: { runId: runAtomic.id },
    });
    ok(rolled === null, "2: append returns null when outbox insert fails");
    ok(afterCount === beforeCount, "2: canonical event rolled back with outbox");
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS autopilot_a1p0_fail_outbox ON "AutopilotTelemetryOutbox"`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS autopilot_a1p0_fail_outbox()`,
    );
  }

  // 3. concurrent sequence collision retries correctly
  const runRace = await seedRun(orgA, session.id);
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      appendAgentRunEvent({
        orgId: orgA,
        runId: runRace.id,
        eventType: "tool.started",
        title: `c${i}`,
      }),
    ),
  );
  const persistedConcurrent = concurrent.filter(Boolean);
  ok(persistedConcurrent.length === 8, "3: all concurrent appends persisted");
  const seqs = new Set(persistedConcurrent.map((e) => e!.sequence));
  ok(seqs.size === 8, "3: distinct sequences after collision retry");

  // 4. terminal event race does not prevent run terminal state
  const runTerm = await seedRun(orgA, session.id);
  const [normal, completed] = await Promise.all([
    appendAgentRunEvent({
      orgId: orgA,
      runId: runTerm.id,
      eventType: "tool.started",
      title: "race-normal",
    }),
    completeAgentRun(orgA, runTerm.id),
  ]);
  ok(!!normal, "4: racing normal event persisted");
  ok(completed.status === "completed", "4: run status = completed");
  const termEvents = await db.agentRunEvent.findMany({
    where: { runId: runTerm.id },
    orderBy: { sequence: "asc" },
  });
  ok(
    termEvents.some((e) => e.eventType === "tool.started") &&
      termEvents.some((e) => e.eventType === "run.completed"),
    "4: both events persist",
  );
  ok(
    new Set(termEvents.map((e) => e.sequence)).size === termEvents.length,
    "4: distinct sequences",
  );
  const termOutbox = await db.autopilotTelemetryOutbox.findMany({
    where: { agentRunId: runTerm.id },
  });
  const eventIds = new Set(termEvents.map((e) => e.id));
  ok(
    termEvents.every((e) =>
      termOutbox.some((o) => o.agentEventId === e.id),
    ),
    "4: each canonical event has outbox envelope",
  );
  ok(
    termOutbox.some((o) => o.noticeType === "run_terminal"),
    "4: run_terminal envelope exists",
  );
  ok(
    termEvents.every((e) => eventIds.has(e.id)),
    "4: envelopes committed with events",
  );

  const runFail = await seedRun(orgA, session.id);
  const [, failed] = await Promise.all([
    appendAgentRunEvent({
      orgId: orgA,
      runId: runFail.id,
      eventType: "tool.started",
      title: "fail-race",
    }),
    failAgentRun(orgA, runFail.id, {
      code: "unknown",
      message: "e2e fail",
    }),
  ]);
  ok(failed.status === "failed", "4b: fail terminal status");
  const failEvents = await db.agentRunEvent.findMany({
    where: { runId: runFail.id },
  });
  ok(
    failEvents.some((e) => e.eventType === "run.failed") &&
      failEvents.some((e) => e.eventType === "tool.started"),
    "4b: fail path keeps both events",
  );

  const runCancel = await seedRun(orgA, session.id);
  const [, cancelled] = await Promise.all([
    appendAgentRunEvent({
      orgId: orgA,
      runId: runCancel.id,
      eventType: "tool.started",
      title: "cancel-race",
    }),
    cancelAgentRun(orgA, runCancel.id),
  ]);
  ok(cancelled.status === "cancelled", "4c: cancel terminal status");
  const cancelEvents = await db.agentRunEvent.findMany({
    where: { runId: runCancel.id },
  });
  ok(
    cancelEvents.some((e) => e.eventType === "run.cancelled") &&
      cancelEvents.some((e) => e.eventType === "tool.started"),
    "4c: cancel path keeps both events",
  );

  // 5. duplicate idempotency key
  const dup = await enqueueAutopilotTelemetryOutbox(db, {
    orgId: orgA,
    agentRunId: runAtomic.id,
    noticeType: "event",
    agentEventId: ev1!.id,
    sequence: ev1!.sequence,
    sourceEventType: "tool.started",
  });
  ok(dup === "duplicate", "5: duplicate idempotencyKey → duplicate");

  async function parkOutboxExcept(ids: string[] = []) {
    await db.autopilotTelemetryOutbox.updateMany({
      where: ids.length ? { id: { notIn: ids } } : {},
      data: {
        status: "processed",
        processedAt: new Date(),
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      },
    });
  }

  // 6. two workers racing to claim → one winner
  await parkOutboxExcept();
  const claimRun = await seedRun(orgA, session.id);
  await db.autopilotTelemetryOutbox.create({
    data: {
      orgId: orgA,
      agentRunId: claimRun.id,
      noticeType: "run_created",
      idempotencyKey: `e2e-claim-${tag}`,
      status: "pending",
      nextAttemptAt: new Date(Date.now() - 1000),
    },
  });
  const now = new Date();
  const [c1, c2] = await Promise.all([
    claimAutopilotOutboxBatch({ limit: 25, now, leaseMs: 60_000 }),
    claimAutopilotOutboxBatch({ limit: 25, now, leaseMs: 60_000 }),
  ]);
  const winners = [...c1, ...c2].filter((r) => r.agentRunId === claimRun.id);
  ok(winners.length === 1, "6: two workers → one lease winner", {
    winners: winners.length,
  });

  // 7. expired lease reclaim
  const reclaimRow = await db.autopilotTelemetryOutbox.findFirst({
    where: { agentRunId: claimRun.id },
  });
  ok(!!reclaimRow, "7: claimed row exists");
  await db.autopilotTelemetryOutbox.update({
    where: { id: reclaimRow!.id },
    data: {
      status: "processing",
      attemptCount: 1,
      leaseExpiresAt: new Date(Date.now() - 5_000),
    },
  });
  const reclaimed = await claimAutopilotOutboxBatch({
    limit: 25,
    now: new Date(),
  });
  ok(
    reclaimed.some((r) => r.id === reclaimRow!.id),
    "7: expired lease reclaim works",
  );

  // 8. max-attempt expired processing reaches DEAD
  await db.autopilotTelemetryOutbox.update({
    where: { id: reclaimRow!.id },
    data: {
      status: "processing",
      attemptCount: AUTOPILOT_OUTBOX_MAX_ATTEMPTS,
      leaseExpiresAt: new Date(Date.now() - 5_000),
    },
  });
  const noReclaim = await claimAutopilotOutboxBatch({
    limit: 25,
    now: new Date(),
  });
  ok(
    !noReclaim.some((r) => r.id === reclaimRow!.id),
    "8: attemptCount=8 expired 不可 reclaim",
  );
  const recovered = await recoverExpiredMaxAttemptOutbox({ now: new Date() });
  ok(recovered >= 1, "8: recovery moved expired-max to DEAD");
  const deadRow = await db.autopilotTelemetryOutbox.findUnique({
    where: { id: reclaimRow!.id },
  });
  ok(deadRow?.status === "dead", "8: row status = dead");
  ok(
    deadRow?.attemptCount === AUTOPILOT_OUTBOX_MAX_ATTEMPTS,
    "8: attemptCount 不再增加",
  );

  // 9. processor projection idempotent
  await parkOutboxExcept();
  const projRun = await seedRun(orgA, session.id);
  const projEv = await appendAgentRunEvent({
    orgId: orgA,
    runId: projRun.id,
    eventType: "tool.started",
    title: "project-me",
    payload: { name: "gmail.send" },
  });
  const tProc0 = performance.now();
  const proc1 = await processAutopilotTelemetryOutbox({
    limit: 25,
    env: { AUTOPILOT_PROCESSOR_ENABLED: "1" },
  });
  const procBatchMs = performance.now() - tProc0;
  ok(proc1.processed >= 1, "9: processor processed ≥1");
  await db.autopilotTelemetryOutbox.updateMany({
    where: { agentEventId: projEv!.id },
    data: {
      status: "pending",
      processedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() - 1000),
      attemptCount: 0,
    },
  });
  await processAutopilotTelemetryOutbox({
    limit: 25,
    env: { AUTOPILOT_PROCESSOR_ENABLED: "1" },
  });
  const overlay = await db.autopilotRun.findUnique({
    where: { agentRunId: projRun.id },
    include: { events: true },
  });
  const sameSeq = overlay?.events.filter((e) => e.sequence === projEv!.sequence);
  ok((sameSeq?.length ?? 0) === 1, "9: duplicate process → one projection event");

  // 10. cross-org row cannot project
  await parkOutboxExcept();
  const runB = await seedRun(orgB, sessionB.id);
  const cross = await db.autopilotTelemetryOutbox.create({
    data: {
      orgId: orgA,
      agentRunId: runB.id,
      noticeType: "run_created",
      idempotencyKey: `e2e-cross-${tag}`,
      status: "pending",
      nextAttemptAt: new Date(Date.now() - 1000),
    },
  });
  await processAutopilotTelemetryOutbox({
    limit: 25,
    env: { AUTOPILOT_PROCESSOR_ENABLED: "1" },
  });
  const crossAfter = await db.autopilotTelemetryOutbox.findUnique({
    where: { id: cross.id },
  });
  ok(crossAfter?.status === "dead", "10: cross-org → DEAD");
  ok(crossAfter?.lastErrorCode === "CROSS_ORG", "10: CROSS_ORG code");
  const leaked = await db.autopilotRun.findUnique({
    where: { agentRunId: runB.id },
  });
  ok(!leaked, "10: no AutopilotRun projection for cross-org");

  // 11. capture OFF → no Outbox access
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "0";
  const beforeOff = await db.autopilotTelemetryOutbox.count({
    where: { orgId: orgA },
  });
  const runOff = await seedRun(orgA, session.id);
  await appendAgentRunEvent({
    orgId: orgA,
    runId: runOff.id,
    eventType: "tool.started",
    title: "capture-off",
  });
  const afterOff = await db.autopilotTelemetryOutbox.count({
    where: { orgId: orgA },
  });
  ok(afterOff === beforeOff, "11: capture OFF 不写 outbox");
  const offEvents = await db.agentRunEvent.count({
    where: { runId: runOff.id },
  });
  ok(offEvents === 1, "11: canonical event 仍可写入");

  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await appendAgentRunEvent({
      orgId: orgA,
      runId: runAtomic.id,
      eventType: "tool.completed",
      title: `bench-${i}`,
    });
    insertLatencies.push(performance.now() - t0);
  }

  console.log(
    JSON.stringify(
      {
        env: "isolated-postgres",
        batchSize: 25,
        outboxInsertMs: {
          p50: Math.round(percentile(insertLatencies, 50) * 1000) / 1000,
          p95: Math.round(percentile(insertLatencies, 95) * 1000) / 1000,
          samples: insertLatencies.length,
        },
        processorBatchMs: Math.round(procBatchMs * 1000) / 1000,
        notes: "test environment only — not Production performance",
      },
      null,
      2,
    ),
  );

  await db.agentRun.deleteMany({
    where: {
      sessionId: { in: [session.id, sessionB.id] },
    },
  });
  await db.agentSession.deleteMany({
    where: { id: { in: [session.id, sessionB.id] } },
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main().catch((error) => {
  console.error("[A1-P0 E2E] FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
