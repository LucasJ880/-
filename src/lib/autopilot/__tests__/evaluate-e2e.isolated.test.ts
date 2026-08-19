/**
 * Autopilot A2-P0 isolated Postgres E2E — Deterministic Evaluate.
 *
 * Guard-first：安全检查完成前不得 import @/lib/db。
 * 生产库 → HARD FAIL。未配置 URL / 未显式开启 E2E → skip (exit 0)。
 *
 * 运行（隔离库，禁止生产 URL）：
 *   NODE_ENV=test AUTOPILOT_A2P0_E2E=1 DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx src/lib/autopilot/__tests__/evaluate-e2e.isolated.test.ts
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import { scanObserveResponse } from "../observe-privacy";
import {
  getAutopilotTableQueryCount,
  resetAutopilotTableQueryCount,
} from "../observe-read-gate";

function skip(reason: string): never {
  console.log(`⏭  跳过 Autopilot A2-P0 isolated E2E（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  skip("未提供 DATABASE_URL");
}
if (process.env.NODE_ENV !== "test") {
  skip("需 NODE_ENV=test");
}
if (
  process.env.AUTOPILOT_A2P0_E2E !== "1" &&
  (process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated"
) {
  skip("需 AUTOPILOT_A2P0_E2E=1 或 DATABASE_ENVIRONMENT=isolated");
}

assertSafeTestDatabase({
  scriptName: "autopilot A2-P0 isolated postgres e2e",
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

async function main() {
  process.env.AUTOPILOT_ENABLED = "1";
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "1";

  const { db } = await import("@/lib/db");
  const { projectAutopilotNotice } = await import("../instrumentation");
  const { getAutopilotEvaluations } = await import("../service");
  const { AUTOPILOT_EVALUATOR_VERSION } = await import("../types");

  console.log("autopilot A2-P0 isolated Postgres E2E");

  const tag = `a2p0_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const actor = await db.user.create({
    data: { email: `a2p0_${tag}@example.test`, name: "A2P0 Actor" },
  });
  process.env.AUTOPILOT_OWNER_USER_IDS = actor.id;
  const owner = { id: actor.id, role: "user" };

  const org = await db.organization.create({
    data: {
      name: `A2P0 Org ${tag}`,
      code: `a2p0_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const orgId = org.id;
  await db.organizationMember.create({
    data: { orgId, userId: actor.id, role: "org_member", status: "active" },
  });
  const session = await db.agentSession.create({
    data: { orgId, channel: "e2e", status: "active" },
  });

  const foreignOrg = await db.organization.create({
    data: {
      name: `A2P0 Foreign ${tag}`,
      code: `a2p0_f_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const foreignSession = await db.agentSession.create({
    data: { orgId: foreignOrg.id, channel: "e2e", status: "active" },
  });

  async function seedRun(input: {
    status: string;
    errorCode?: string | null;
    org?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const startedAt = new Date();
    return db.agentRun.create({
      data: {
        orgId: input.org ?? orgId,
        sessionId: input.sessionId ?? session.id,
        runType: "conversation",
        status: input.status,
        errorCode: input.errorCode,
        metadata: input.metadata,
        startedAt,
        completedAt:
          input.status === "running" || input.status === "queued"
            ? null
            : startedAt,
        latencyMs: 80,
      },
    });
  }

  const darkEnv = {
    AUTOPILOT_ENABLED: "1",
    AUTOPILOT_OWNER_USER_IDS: actor.id,
  };
  resetAutopilotTableQueryCount();
  const dark = await getAutopilotEvaluations(owner, orgId, { env: darkEnv });
  ok(dark.evaluateState === "NOT_ACTIVE", "E2E dark evaluate NOT_ACTIVE");
  ok(getAutopilotTableQueryCount() === 0, "E2E dark evaluate queries 0 Autopilot tables");

  const completed = await seedRun({
    status: "completed",
    metadata: { agentId: "assistant", agentRole: "work", workDomain: "sales" },
  });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: completed.id,
  });

  const failed = await seedRun({
    status: "failed",
    errorCode: "tool_failed",
    metadata: { agentId: "assistant", workDomain: "sales" },
  });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: failed.id,
  });

  const cancelled = await seedRun({ status: "cancelled" });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: cancelled.id,
  });

  const overridden = await seedRun({ status: "completed" });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: overridden.id,
  });
  await projectAutopilotNotice({
    type: "event",
    orgId,
    runId: overridden.id,
    eventType: "human.override",
    sequence: 1,
    payload: { Authorization: "Bearer secret-token-value" },
  });

  const edited = await seedRun({ status: "completed" });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: edited.id,
  });
  await projectAutopilotNotice({
    type: "event",
    orgId,
    runId: edited.id,
    eventType: "human.edit",
    sequence: 1,
    payload: { original: "full prompt text for privacy" },
  });

  const foreign = await seedRun({
    status: "failed",
    errorCode: "tool_failed",
    org: foreignOrg.id,
    sessionId: foreignSession.id,
  });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId: foreignOrg.id,
    runId: foreign.id,
  });

  const envOn = {
    AUTOPILOT_ENABLED: "1",
    AUTOPILOT_OWNER_USER_IDS: actor.id,
    AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "1",
    AUTOPILOT_PROCESSOR_ENABLED: "1",
  };
  const listed = await getAutopilotEvaluations(owner, orgId, {
    env: envOn,
    range: "7d",
    limit: 50,
  });
  const scan = scanObserveResponse(listed);
  ok(scan.ok, "evaluations payload has no score keys / secret needles");
  ok(
    !("successRate" in listed) && !("taskSuccessRate" in listed),
    "evaluations payload has no success rate fields",
  );
  ok(listed.evaluateState === "ACTIVE", "evaluate active when capture/processor on");
  ok(listed.taskSuccessCount === 0, "taskSuccessCount stays 0");
  ok(listed.partialSuccessCount === 0, "partialSuccessCount stays 0");
  ok((listed.aiEvaluator ?? "DISABLED") === "DISABLED", "LLM evaluator still DISABLED");

  const byRun = new Map(listed.items.map((item) => [item.runId, item]));
  ok(byRun.get(completed.id)?.outcome === "UNKNOWN", "completed evaluates UNKNOWN");
  ok(byRun.get(completed.id)?.judged === false, "completed is not judged");
  ok(byRun.get(failed.id)?.outcome === "FAILURE", "failed evaluates FAILURE");
  ok(byRun.get(failed.id)?.failureType === "TOOL_FAILURE", "failed maps TOOL_FAILURE");
  ok(byRun.get(cancelled.id)?.outcome === "ABANDONED", "cancelled evaluates ABANDONED");
  ok(
    byRun.get(overridden.id)?.outcome === "HUMAN_OVERRIDE",
    "human.override evaluates HUMAN_OVERRIDE",
  );
  ok(
    byRun.get(overridden.id)?.failureType == null,
    "override does not invent HALLUCINATION/failureType",
  );
  ok(byRun.get(edited.id)?.outcome === "UNKNOWN", "human.edit stays UNKNOWN");
  ok(!byRun.has(foreign.id), "foreign org evaluation is not listed");

  const overlay = await db.autopilotRun.findUnique({
    where: { agentRunId: completed.id },
    select: { outcome: true, humanOverride: true },
  });
  ok(
    overlay?.outcome === "UNKNOWN",
    "Observe overlay outcome remains UNKNOWN for completed (not A2 persist)",
  );

  const evidence = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: overridden.id,
        evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      },
    },
    select: { evidence: true, outcome: true },
  });
  const evidenceJson = JSON.stringify(evidence?.evidence ?? {});
  ok(
    !evidenceJson.includes("Bearer secret-token-value"),
    "evaluation evidence does not store Authorization",
  );
  ok(evidence?.outcome === "HUMAN_OVERRIDE", "persisted override outcome");

  const editEvidence = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: edited.id,
        evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      },
    },
    select: { evidence: true },
  });
  ok(
    !JSON.stringify(editEvidence?.evidence ?? {}).includes(
      "full prompt text for privacy",
    ),
    "evaluation evidence does not store prompt/output bodies",
  );

  const isolated = await getAutopilotEvaluations(owner, foreignOrg.id, {
    env: envOn,
    range: "7d",
  });
  ok(
    isolated.items.every((item) => item.runId === foreign.id) &&
      isolated.items.length >= 1,
    "foreign org query only sees foreign evaluation",
  );
  ok(
    !isolated.items.some((item) => item.runId === completed.id),
    "foreign org query does not leak home org",
  );

  ok(byRun.get(completed.id)?.outcome === "UNKNOWN", "COMPLETED_UNKNOWN = PASS");
  ok(byRun.get(failed.id)?.outcome === "FAILURE", "RUNTIME_FAILURE = PASS");
  ok(byRun.get(cancelled.id)?.outcome === "ABANDONED", "ABANDONED = PASS");
  ok(
    byRun.get(overridden.id)?.outcome === "HUMAN_OVERRIDE",
    "HUMAN_OVERRIDE = PASS",
  );
  ok(byRun.get(edited.id)?.outcome === "UNKNOWN", "HUMAN_EDIT_UNKNOWN = PASS");
  ok(
    isolated.items.every((item) => item.runId === foreign.id),
    "ORG_ISOLATION = PASS",
  );
  ok(scan.ok, "PRIVACY = PASS");
  ok(dark.evaluateState === "NOT_ACTIVE", "DARK_MODE = PASS");

  const { persistDeterministicEvaluation } = await import("../evaluate-persist");
  const { enqueueAutopilotTelemetryOutbox, AUTOPILOT_OUTBOX_MAX_ATTEMPTS } =
    await import("../outbox");
  const { defaultAutopilotProcessorPorts, processAutopilotTelemetryOutbox } =
    await import("../processor");

  async function observeProjection(agentRunId: string) {
    const overlay = await db.autopilotRun.findUnique({
      where: { agentRunId },
      select: {
        id: true,
        outcome: true,
        completedAt: true,
        metadata: true,
      },
    });
    const events = overlay
      ? await db.autopilotRunEvent.count({ where: { runId: overlay.id } })
      : 0;
    const evaluations = await db.autopilotEvaluation.count({
      where: { agentRunId },
    });
    const canonicalEvents = await db.agentRunEvent.count({
      where: { runId: agentRunId },
    });
    const outbox = await db.autopilotTelemetryOutbox.findMany({
      where: { agentRunId },
      select: { status: true, noticeType: true, attemptCount: true },
    });
    return { overlay, events, evaluations, canonicalEvents, outbox };
  }

  async function processRunOutbox(input: {
    agentRunId: string;
    failEvaluation: boolean;
    now: Date;
  }) {
    const ports = await defaultAutopilotProcessorPorts();
    const baseClaim = ports.claim;
    ports.claim = async (claimInput) => {
      const rows = await baseClaim(claimInput);
      return rows.filter((row) => row.agentRunId === input.agentRunId);
    };
    ports.project = (notice) =>
      projectAutopilotNotice(notice, {
        persistDeterministicEvaluation: async (evalInput) => {
          if (input.failEvaluation) {
            throw new Error("forced A2 evaluation failure");
          }
          await persistDeterministicEvaluation(evalInput);
        },
      });
    return processAutopilotTelemetryOutbox({
      env: envOn,
      now: input.now,
      ports,
    });
  }

  const transient = await seedRun({ status: "completed" });
  const transientEvent = await db.agentRunEvent.create({
    data: {
      orgId,
      runId: transient.id,
      eventType: "tool.completed",
      sequence: 1,
      title: "tool",
      payload: { name: "gmail.send" },
    },
  });
  const enqTransient = await enqueueAutopilotTelemetryOutbox(db, {
    orgId,
    agentRunId: transient.id,
    noticeType: "event",
    agentEventId: transientEvent.id,
    sequence: 1,
    sourceEventType: "tool.completed",
  });
  ok(enqTransient === "inserted", "transient A2-failure case enqueued");

  const t0 = new Date(Date.now() + 5_000);
  const firstFail = await processRunOutbox({
    agentRunId: transient.id,
    failEvaluation: true,
    now: t0,
  });
  const afterFirstFail = await observeProjection(transient.id);
  ok(afterFirstFail.canonicalEvents === 1, "canonical AgentRunEvent exists after A2 fail");
  ok(!!afterFirstFail.overlay, "AutopilotRun exists after A2 fail");
  ok(
    afterFirstFail.events === 1,
    "A2_FAILURE_A1_EVENT_SURVIVES = PASS",
  );
  ok(afterFirstFail.evaluations === 0, "A2 evaluation missing after first fail");
  ok(
    firstFail.retried === 1 &&
      afterFirstFail.outbox.some((row) => row.status === "pending"),
    "processor result = retry/pending after transient A2 fail",
  );

  const recovered = await processRunOutbox({
    agentRunId: transient.id,
    failEvaluation: false,
    now: new Date(t0.getTime() + 2 * 60 * 60 * 1000),
  });
  const afterRetry = await observeProjection(transient.id);
  ok(afterRetry.events === 1, "A1_EVENT_REPLAY_IDEMPOTENT = PASS");
  ok(afterRetry.evaluations === 1, "A2_RETRY_RECOVERS_EVALUATION = PASS");
  ok(
    recovered.processed === 1 &&
      afterRetry.outbox.every((row) => row.status === "processed"),
    "outbox processed after A2 retry",
  );

  const permanent = await seedRun({ status: "completed" });
  const permanentEvent = await db.agentRunEvent.create({
    data: {
      orgId,
      runId: permanent.id,
      eventType: "tool.completed",
      sequence: 1,
      title: "tool",
      payload: { name: "gmail.send" },
    },
  });
  await enqueueAutopilotTelemetryOutbox(db, {
    orgId,
    agentRunId: permanent.id,
    noticeType: "event",
    agentEventId: permanentEvent.id,
    sequence: 1,
    sourceEventType: "tool.completed",
  });
  let lastPermanent = {
    skipped: false,
    claimed: 0,
    processed: 0,
    retried: 0,
    dead: 0,
    lost: 0,
    recoveredDead: 0,
  };
  for (let i = 0; i < AUTOPILOT_OUTBOX_MAX_ATTEMPTS; i++) {
    lastPermanent = await processRunOutbox({
      agentRunId: permanent.id,
      failEvaluation: true,
      now: new Date(t0.getTime() + i * 24 * 60 * 60 * 1000),
    });
  }
  const afterDead = await observeProjection(permanent.id);
  ok(
    lastPermanent.dead === 1 &&
      afterDead.outbox.some((row) => row.status === "dead"),
    "permanent A2 failure reaches outbox DEAD",
  );
  ok(!!afterDead.overlay, "A1 Observe overlay present after permanent A2 fail");
  ok(afterDead.events === 1, "A1 mapped event projection present after permanent A2 fail");
  ok(afterDead.evaluations === 0, "A2 evaluation may be missing after permanent fail");
  ok(
    afterDead.events === afterDead.canonicalEvents,
    "PERMANENT_A2_FAILURE_NO_A1_GAP = PASS",
  );
  ok(
    afterDead.overlay != null && afterDead.events === 1,
    "A2_FAILURE_CAUSES_A1_PROJECTION_GAP = NO",
  );

  const terminal = await seedRun({ status: "completed" });
  await enqueueAutopilotTelemetryOutbox(db, {
    orgId,
    agentRunId: terminal.id,
    noticeType: "run_terminal",
  });
  await processRunOutbox({
    agentRunId: terminal.id,
    failEvaluation: true,
    now: t0,
  });
  const terminalFailed = await observeProjection(terminal.id);
  ok(!!terminalFailed.overlay, "A2_FAILURE_A1_OVERLAY_SURVIVES = PASS");
  ok(
    terminalFailed.overlay?.completedAt != null,
    "A1 terminal overlay already reflects terminal runtime state",
  );
  ok(terminalFailed.evaluations === 0, "terminal A2 evaluation missing after first fail");
  const terminalMeta = terminalFailed.overlay?.metadata as
    | { status?: string }
    | null;
  ok(terminalMeta?.status === "completed", "A1 overlay status remains completed");

  await processRunOutbox({
    agentRunId: terminal.id,
    failEvaluation: false,
    now: new Date(t0.getTime() + 2 * 60 * 60 * 1000),
  });
  const terminalRecovered = await observeProjection(terminal.id);
  ok(terminalRecovered.evaluations === 1, "terminal retry recovers evaluation");
  ok(
    !!terminalRecovered.overlay &&
      terminalRecovered.overlay.id === terminalFailed.overlay?.id,
    "A2 failure must not remove or roll back A1 overlay",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
