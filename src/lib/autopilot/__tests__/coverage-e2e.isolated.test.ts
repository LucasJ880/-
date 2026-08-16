/**
 * Autopilot A1-P1 isolated Postgres E2E — runtime event coverage.
 *
 * Guard-first：安全检查完成前不得 import @/lib/db。
 * 生产库 → HARD FAIL。未配置 URL / 未显式开启 E2E → skip (exit 0)。
 *
 * 运行（隔离库，禁止生产 URL）：
 *   NODE_ENV=test AUTOPILOT_A1P1_E2E=1 DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx src/lib/autopilot/__tests__/coverage-e2e.isolated.test.ts
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import {
  classifyAgentRunEvent,
  mapAgentRunEventToAutopilot,
} from "../map-events";
import {
  MODEL_LIFECYCLE,
  RETRIEVAL_LIFECYCLE,
  TOOL_LIFECYCLE,
  countLifecycleOrphans,
  durableCaptureGap,
  projectionGap,
  runtimeCoverageGap,
} from "../coverage";

function skip(reason: string): never {
  console.log(`⏭  跳过 Autopilot A1-P1 isolated E2E（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  skip("未提供 DATABASE_URL");
}
if (process.env.NODE_ENV !== "test") {
  skip("需 NODE_ENV=test");
}
if (
  process.env.AUTOPILOT_A1P1_E2E !== "1" &&
  (process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated"
) {
  skip("需 AUTOPILOT_A1P1_E2E=1 或 DATABASE_ENVIRONMENT=isolated");
}

assertSafeTestDatabase({
  scriptName: "autopilot A1-P1 isolated postgres e2e",
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

const HAPPY_EXPECTED = [
  "USER_INPUT",
  "INTENT_RESOLVED",
  "CONTEXT_LOAD_STARTED",
  "CONTEXT_LOADED",
  "RETRIEVAL_STARTED",
  "RETRIEVAL_COMPLETED",
  "MODEL_STARTED",
  "MODEL_COMPLETED",
  "TOOL_CALL_STARTED",
  "TOOL_CALL_COMPLETED",
  "AGENT_OUTPUT",
  "TASK_COMPLETED",
] as const;

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
  const { processAutopilotTelemetryOutbox } = await import(
    "@/lib/autopilot/processor"
  );

  console.log("autopilot A1-P1 isolated Postgres E2E");

  const tag = `a1p1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const orgId = `org_${tag}`;
  const session = await db.agentSession.create({
    data: { orgId, channel: "e2e", status: "active" },
  });

  async function seedRun() {
    return db.agentRun.create({
      data: {
        orgId,
        sessionId: session.id,
        runType: "conversation",
        status: "running",
        startedAt: new Date(),
      },
    });
  }

  async function parkOtherOutbox(keepRunId?: string) {
    await db.autopilotTelemetryOutbox.updateMany({
      where: keepRunId ? { agentRunId: { not: keepRunId } } : {},
      data: {
        status: "processed",
        processedAt: new Date(),
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      },
    });
  }

  const latencies: number[] = [];
  async function emit(
    runId: string,
    eventType: Parameters<typeof appendAgentRunEvent>[0]["eventType"],
    payload?: Record<string, unknown>,
  ) {
    const t0 = performance.now();
    const row = await appendAgentRunEvent({
      orgId,
      runId,
      eventType,
      title: eventType,
      payload,
    });
    latencies.push(performance.now() - t0);
    return row;
  }

  // ── 1. happy lifecycle ──
  const happy = await seedRun();
  await emit(happy.id, "run.started", { userMessageId: "msg_happy" });
  await emit(happy.id, "planning.completed", { intent: "knowledge" });
  await emit(happy.id, "context.loading");
  await emit(happy.id, "context.loaded", { sourceCount: 2, types: ["recent_messages"] });
  await emit(happy.id, "retrieval.started", {
    retrievalId: "ret_1",
    retrievalType: "org_knowledge",
    queryHash: "abc",
  });
  await emit(happy.id, "retrieval.completed", {
    retrievalId: "ret_1",
    resultCount: 3,
    sourceRefs: ["doc_1"],
  });
  await emit(happy.id, "model.started", { modelCallId: "mdl_1", model: "test" });
  await emit(happy.id, "model.completed", { modelCallId: "mdl_1" });
  await emit(happy.id, "tool.started", {
    toolCallId: "tool_1",
    name: "org_search_knowledge",
  });
  await emit(happy.id, "tool.completed", {
    toolCallId: "tool_1",
    name: "org_search_knowledge",
    ok: true,
  });
  await emit(happy.id, "model.started", { modelCallId: "mdl_2" });
  await emit(happy.id, "model.completed", { modelCallId: "mdl_2" });
  await emit(happy.id, "agent.output", {
    hash: "h1",
    bytes: 8,
    outputType: "text",
  });
  await completeAgentRun(orgId, happy.id);

  const happyEvents = await db.agentRunEvent.findMany({
    where: { runId: happy.id },
    orderBy: { sequence: "asc" },
  });
  const happyOutbox = await db.autopilotTelemetryOutbox.findMany({
    where: { agentRunId: happy.id, noticeType: "event" },
  });
  ok(happyEvents.length === 14, "happy: canonical event count = 14", happyEvents.length);
  ok(
    happyOutbox.length === happyEvents.length,
    "happy: outbox event envelopes = canonical",
    { events: happyEvents.length, outbox: happyOutbox.length },
  );

  await parkOtherOutbox(happy.id);
  const tProc0 = performance.now();
  const drained = await processAutopilotTelemetryOutbox({
    limit: 50,
    env: { AUTOPILOT_PROCESSOR_ENABLED: "1" },
  });
  const processorBatchMs = performance.now() - tProc0;
  ok(drained.processed >= happyEvents.length, "happy: processor drained events");

  const overlay = await db.autopilotRun.findUnique({
    where: { agentRunId: happy.id },
    include: { events: true },
  });
  const mapped = happyEvents.filter(
    (e) => classifyAgentRunEvent(e.eventType) === "mapped",
  );
  ok(
    (overlay?.events.length ?? 0) === mapped.length,
    "happy: projected = mapped",
    { projected: overlay?.events.length, mapped: mapped.length },
  );

  const actualCanonical = mapped
    .map((e) => mapAgentRunEventToAutopilot(e.eventType, e.payload)?.eventType)
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const cov = runtimeCoverageGap(HAPPY_EXPECTED, actualCanonical);
  ok(cov.gap === 0, "happy: RUNTIME_COVERAGE_GAP = 0", cov.missing);
  ok(
    durableCaptureGap({
      captureEnabled: true,
      canonicalEventCount: happyEvents.length,
      outboxEventCount: happyOutbox.length,
    }) === 0,
    "happy: DURABLE_CAPTURE_GAP = 0",
  );
  ok(
    projectionGap({
      mappedEventCount: mapped.length,
      projectedEventCount: overlay?.events.length ?? 0,
    }) === 0,
    "happy: PROJECTION_GAP = 0",
  );
  ok(
    countLifecycleOrphans(happyEvents, TOOL_LIFECYCLE).orphanCount === 0,
    "happy: TOOL_ORPHANS = 0",
  );
  ok(
    countLifecycleOrphans(happyEvents, MODEL_LIFECYCLE).orphanCount === 0,
    "happy: MODEL_ORPHANS = 0",
  );
  ok(
    countLifecycleOrphans(happyEvents, RETRIEVAL_LIFECYCLE).orphanCount === 0,
    "happy: RETRIEVAL_ORPHANS = 0",
  );

  const unknown = happyEvents.filter(
    (e) => classifyAgentRunEvent(e.eventType) === "unknown",
  );
  ok(unknown.length === 0, "happy: UNMAPPED_CANONICAL_EVENTS = 0");

  console.log(
    `  eventsPerRun=${happyEvents.length} outboxRowsPerRun(event)=${happyOutbox.length} outboxRowsPerRun(all)=${await db.autopilotTelemetryOutbox.count({ where: { agentRunId: happy.id } })}`,
  );
  console.log(
    `  P50_EVENT_APPEND=${percentile(latencies, 50).toFixed(2)}ms P95_EVENT_APPEND=${percentile(latencies, 95).toFixed(2)}ms PROCESSOR_BATCH=${processorBatchMs.toFixed(2)}ms env=isolated-local`,
  );

  // ── 2. failure lifecycle ──
  const failed = await seedRun();
  await emit(failed.id, "run.started", { userMessageId: "msg_fail" });
  await emit(failed.id, "context.loading");
  await emit(failed.id, "context.loaded", { sourceCount: 1 });
  await emit(failed.id, "tool.started", { toolCallId: "tool_fail", name: "x" });
  await emit(failed.id, "tool.failed", {
    toolCallId: "tool_fail",
    name: "x",
    errorCode: "tool_failed",
  });
  await failAgentRun(orgId, failed.id, {
    code: "tool_failed",
    message: "e2e tool fail",
  });
  const failEvents = await db.agentRunEvent.findMany({
    where: { runId: failed.id },
  });
  ok(
    failEvents.some((e) => e.eventType === "run.failed"),
    "failure: TASK_FAILED present",
  );
  ok(
    countLifecycleOrphans(failEvents, TOOL_LIFECYCLE).orphanCount === 0,
    "failure: tool started has terminal (not orphan)",
  );

  // ── 3. processor down then drain ──
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "0";
  const behind = await seedRun();
  await emit(behind.id, "run.started", { userMessageId: "msg_behind" });
  await emit(behind.id, "agent.output", { hash: "h2", bytes: 4 });
  await completeAgentRun(orgId, behind.id);
  const behindEvents = await db.agentRunEvent.findMany({
    where: { runId: behind.id },
  });
  const behindOutbox = await db.autopilotTelemetryOutbox.count({
    where: { agentRunId: behind.id, noticeType: "event" },
  });
  const behindProjectedBefore = await db.autopilotRunEvent.count({
    where: { run: { agentRunId: behind.id } },
  });
  ok(
    durableCaptureGap({
      captureEnabled: true,
      canonicalEventCount: behindEvents.length,
      outboxEventCount: behindOutbox,
    }) === 0,
    "processor-down: DURABLE_CAPTURE_GAP = 0",
  );
  const skipped = await processAutopilotTelemetryOutbox({
    limit: 25,
    env: { AUTOPILOT_PROCESSOR_ENABLED: "0" },
  });
  ok(skipped.skipped === true, "processor-down: processor skips");
  ok(
    projectionGap({
      mappedEventCount: behindEvents.filter(
        (e) => classifyAgentRunEvent(e.eventType) === "mapped",
      ).length,
      projectedEventCount: behindProjectedBefore,
    }) > 0,
    "processor-down: PROJECTION_GAP > 0",
  );

  process.env.AUTOPILOT_PROCESSOR_ENABLED = "1";
  await parkOtherOutbox(behind.id);
  await processAutopilotTelemetryOutbox({
    limit: 25,
    env: { AUTOPILOT_PROCESSOR_ENABLED: "1" },
  });
  const behindProjectedAfter = await db.autopilotRunEvent.count({
    where: { run: { agentRunId: behind.id } },
  });
  ok(
    projectionGap({
      mappedEventCount: behindEvents.filter(
        (e) => classifyAgentRunEvent(e.eventType) === "mapped",
      ).length,
      projectedEventCount: behindProjectedAfter,
    }) === 0,
    "processor-recovery: PROJECTION_GAP = 0",
  );

  // ── 4. capture OFF ──
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "0";
  const off = await seedRun();
  const beforeOff = await db.autopilotTelemetryOutbox.count({
    where: { agentRunId: off.id },
  });
  await emit(off.id, "run.started", { userMessageId: "msg_off" });
  await emit(off.id, "context.loaded");
  await completeAgentRun(orgId, off.id);
  const offEvents = await db.agentRunEvent.count({ where: { runId: off.id } });
  const afterOff = await db.autopilotTelemetryOutbox.count({
    where: { agentRunId: off.id },
  });
  const offProjected = await db.autopilotRunEvent.count({
    where: { run: { agentRunId: off.id } },
  });
  ok(offEvents >= 3, "capture-off: canonical events still written");
  ok(afterOff === beforeOff, "capture-off: outbox ZERO");
  ok(offProjected === 0, "capture-off: projection ZERO");

  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";

  // ── 5. terminal races still one logical terminal ──
  const race = await seedRun();
  const [, completed] = await Promise.all([
    failAgentRun(orgId, race.id, { code: "unknown", message: "race" }),
    completeAgentRun(orgId, race.id),
  ]);
  const raceEvents = await db.agentRunEvent.findMany({
    where: { runId: race.id },
  });
  const terminals = raceEvents.filter((e) =>
    ["run.completed", "run.failed", "run.cancelled"].includes(e.eventType),
  );
  ok(
    terminals.length === 1,
    "race: one canonical terminal event",
    terminals.map((e) => e.eventType),
  );
  ok(
    completed.status === "completed" || completed.status === "failed",
    "race: one terminal status",
    completed.status,
  );

  const cancelRace = await seedRun();
  await Promise.all([
    cancelAgentRun(orgId, cancelRace.id),
    completeAgentRun(orgId, cancelRace.id),
  ]);
  const cancelRow = await db.agentRun.findUnique({ where: { id: cancelRace.id } });
  ok(
    cancelRow?.status === "cancelled" || cancelRow?.status === "completed",
    "cancel-vs-complete: single terminal status",
    cancelRow?.status,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
