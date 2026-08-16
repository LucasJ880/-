/**
 * Autopilot A1-P2 isolated Postgres E2E — Human Signals.
 *
 * Guard-first：安全检查完成前不得 import @/lib/db。
 * 生产库 → HARD FAIL。未配置 URL / 未显式开启 E2E → skip (exit 0)。
 *
 * 运行（隔离库，禁止生产 URL）：
 *   NODE_ENV=test AUTOPILOT_A1P2_E2E=1 DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx src/lib/autopilot/__tests__/human-signals-e2e.isolated.test.ts
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import {
  classifyAgentRunEvent,
  mapAgentRunEventToAutopilot,
} from "../map-events";
import {
  HUMAN_EDIT_SOURCES,
  HUMAN_OVERRIDE_SOURCES,
  HUMAN_SIGNAL_PROJECTED_TYPES,
  RE_ASK_SOURCES,
  humanSignalProjectionGap,
} from "../human-signals";
import {
  MODEL_LIFECYCLE,
  RETRIEVAL_LIFECYCLE,
  TOOL_LIFECYCLE,
  countLifecycleOrphans,
  durableCaptureGap,
  projectionGap,
} from "../coverage";

function skip(reason: string): never {
  console.log(`⏭  跳过 Autopilot A1-P2 isolated E2E（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  skip("未提供 DATABASE_URL");
}
if (process.env.NODE_ENV !== "test") {
  skip("需 NODE_ENV=test");
}
if (
  process.env.AUTOPILOT_A1P2_E2E !== "1" &&
  (process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated"
) {
  skip("需 AUTOPILOT_A1P2_E2E=1 或 DATABASE_ENVIRONMENT=isolated");
}

assertSafeTestDatabase({
  scriptName: "autopilot A1-P2 isolated postgres e2e",
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

const TERMINAL_EVENTS = ["run.completed", "run.failed", "run.cancelled"] as const;
const SECRET_NEEDLES = [
  "Bearer secret-token-value",
  "Dear customer, here is the quote.",
  "Dear customer, here is the revised quote.",
  "qy_session=abc",
  "hunter2-password",
];

function isHumanSource(eventType: string): boolean {
  return (
    (HUMAN_EDIT_SOURCES as readonly string[]).includes(eventType) ||
    (HUMAN_OVERRIDE_SOURCES as readonly string[]).includes(eventType) ||
    (RE_ASK_SOURCES as readonly string[]).includes(eventType)
  );
}

async function main() {
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "1";

  const { db } = await import("@/lib/db");
  const { appendAgentRunEvent, completeAgentRun } = await import(
    "@/lib/agent-runtime/run"
  );
  const { processAutopilotTelemetryOutbox } = await import(
    "@/lib/autopilot/processor"
  );
  const {
    observeHumanEdit,
    observeHumanOverride,
    observeReAsk,
    forceNextHumanSignalAppendFailureForTests,
  } = await import("@/lib/autopilot/observe-human");
  const { reconcileHumanSignals } = await import(
    "@/lib/autopilot/reconcile-human"
  );
  const { reconcileAssistantRunFromPendingActions } = await import(
    "@/lib/assistant/reconcile-run"
  );
  const { createHumanFeedbackEvent } = await import(
    "@/lib/employee-ai/feedback-service"
  );

  console.log("autopilot A1-P2 isolated Postgres E2E");

  const tag = `a1p2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const actor = await db.user.create({
    data: {
      email: `a1p2_${tag}@example.test`,
      name: "A1P2 Actor",
    },
  });
  const org = await db.organization.create({
    data: {
      name: `A1P2 Org ${tag}`,
      code: `a1p2_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const orgId = org.id;
  await db.organizationMember.create({
    data: {
      orgId,
      userId: actor.id,
      role: "org_member",
      status: "active",
    },
  });
  const foreignActor = await db.user.create({
    data: {
      email: `a1p2_foreign_${tag}@example.test`,
      name: "A1P2 Foreign",
    },
  });
  const session = await db.agentSession.create({
    data: { orgId, channel: "e2e", status: "active" },
  });

  async function seedRun(status = "running") {
    return db.agentRun.create({
      data: {
        orgId,
        sessionId: session.id,
        runType: "conversation",
        status,
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

  const persistLatencies: number[] = [];

  async function emit(
    runId: string,
    eventType: Parameters<typeof appendAgentRunEvent>[0]["eventType"],
    payload?: Record<string, unknown>,
  ) {
    return appendAgentRunEvent({
      orgId,
      runId,
      eventType,
      title: eventType,
      payload,
    });
  }

  async function drain(runId: string) {
    await parkOtherOutbox(runId);
    const t0 = performance.now();
    const result = await processAutopilotTelemetryOutbox({
      limit: 50,
      env: { AUTOPILOT_PROCESSOR_ENABLED: "1" },
    });
    return { result, ms: performance.now() - t0 };
  }

  function payloadHasSecrets(payload: unknown): boolean {
    const raw = JSON.stringify(payload ?? {});
    return SECRET_NEEDLES.some((n) => raw.includes(n));
  }

  // ── Scenario A — Human Edit + post-terminal + A1-P1 regression ──
  const runA = await seedRun();
  await emit(runA.id, "run.started", { userMessageId: "msg_a" });
  await emit(runA.id, "planning.completed", { intent: "email" });
  await emit(runA.id, "context.loading");
  await emit(runA.id, "context.loaded", { sourceCount: 1 });
  await emit(runA.id, "retrieval.started", { retrievalId: "ret_a" });
  await emit(runA.id, "retrieval.completed", { retrievalId: "ret_a", resultCount: 1 });
  await emit(runA.id, "model.started", { modelCallId: "mdl_a" });
  await emit(runA.id, "model.completed", { modelCallId: "mdl_a" });
  await emit(runA.id, "tool.started", { toolCallId: "tool_a", name: "draft" });
  await emit(runA.id, "tool.completed", { toolCallId: "tool_a", ok: true });
  await emit(runA.id, "agent.output", { hash: "hA", bytes: 12, outputType: "text" });
  await completeAgentRun(orgId, runA.id);

  const unchanged = await observeHumanEdit({
    orgId,
    sourceAgentRunId: runA.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_a",
    committedVersion: "v1",
    commitAction: "save",
    before: "Dear customer, here is the quote.",
    after: "Dear customer, here is the quote.",
    sourceOutputRef: "out_a",
    artifactOrgId: orgId,
  });
  ok(unchanged.status === "skipped", "A: unchanged draft → no HUMAN_EDIT", unchanged);

  const tEdit0 = performance.now();
  const edited = await observeHumanEdit({
    orgId,
    sourceAgentRunId: runA.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_a",
    committedVersion: "v2",
    commitAction: "save",
    before: "Dear customer, here is the quote.",
    after: "Dear customer, here is the revised quote.",
    sourceOutputRef: "out_a",
    artifactOrgId: orgId,
  });
  persistLatencies.push(performance.now() - tEdit0);
  ok(edited.status === "written", "A: changed + save → HUMAN_EDIT written", edited);

  const replayEdit = await observeHumanEdit({
    orgId,
    sourceAgentRunId: runA.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_a",
    committedVersion: "v2",
    commitAction: "save",
    before: "Dear customer, here is the quote.",
    after: "Dear customer, here is the revised quote.",
    sourceOutputRef: "out_a",
    artifactOrgId: orgId,
  });
  ok(replayEdit.status === "duplicate", "E: same save retried → duplicate suppressed", replayEdit);

  const afterA = await db.agentRun.findUnique({
    where: { id: runA.id },
    include: { events: { orderBy: { sequence: "asc" } } },
  });
  const terminalsA = (afterA?.events ?? []).filter((e) =>
    (TERMINAL_EVENTS as readonly string[]).includes(e.eventType),
  );
  const editsA = (afterA?.events ?? []).filter((e) => e.eventType === "human.edit");
  ok(afterA?.status === "completed", "A/post-terminal: run.status = completed");
  ok(terminalsA.length === 1, "A/post-terminal: terminal event count = 1");
  ok(editsA.length === 1, "A: human.edit count = 1");
  ok(
    (editsA[0]?.sequence ?? 0) > (terminalsA[0]?.sequence ?? 0),
    "A: human.edit sequence > terminal sequence",
  );
  ok(
    !payloadHasSecrets(editsA[0]?.payload) &&
      JSON.stringify(editsA[0]?.payload ?? {}).includes("beforeHash") &&
      JSON.stringify(editsA[0]?.payload ?? {}).includes("afterChars"),
    "A: hashes/lengths persisted, raw text not persisted",
  );

  const drainA = await drain(runA.id);
  const overlayA = await db.autopilotRun.findUnique({
    where: { agentRunId: runA.id },
    include: { events: true },
  });
  const mappedA = (afterA?.events ?? []).filter(
    (e) => classifyAgentRunEvent(e.eventType) === "mapped",
  );
  ok(
    durableCaptureGap({
      captureEnabled: true,
      canonicalEventCount: afterA?.events.length ?? 0,
      outboxEventCount: await db.autopilotTelemetryOutbox.count({
        where: { agentRunId: runA.id, noticeType: "event" },
      }),
    }) === 0,
    "A1-P1: DURABLE_CAPTURE_GAP = 0",
  );
  ok(
    projectionGap({
      mappedEventCount: mappedA.length,
      projectedEventCount: overlayA?.events.length ?? 0,
    }) === 0,
    "A1-P1: PROJECTION_GAP = 0 after drain",
  );
  ok(
    countLifecycleOrphans(afterA?.events ?? [], TOOL_LIFECYCLE).orphanCount === 0,
    "A1-P1: TOOL_ORPHANS = 0",
  );
  ok(
    countLifecycleOrphans(afterA?.events ?? [], MODEL_LIFECYCLE).orphanCount === 0,
    "A1-P1: MODEL_ORPHANS = 0",
  );
  ok(
    countLifecycleOrphans(afterA?.events ?? [], RETRIEVAL_LIFECYCLE).orphanCount ===
      0,
    "A1-P1: RETRIEVAL_ORPHANS = 0",
  );
  ok(overlayA?.humanEdit === true, "A: overlay humanEdit flag");
  ok(
    (overlayA?.events ?? []).some((e) => e.eventType === "HUMAN_EDIT"),
    "A: HUMAN_EDIT projected",
  );
  const sourceHsA = (afterA?.events ?? []).filter((e) => isHumanSource(e.eventType)).length;
  const projectedHsA = (overlayA?.events ?? []).filter((e) =>
    (HUMAN_SIGNAL_PROJECTED_TYPES as readonly string[]).includes(e.eventType),
  ).length;
  ok(
    humanSignalProjectionGap({
      sourceHumanSignalCount: sourceHsA,
      projectedHumanSignalCount: projectedHsA,
    }) === 0,
    "A: HUMAN_SIGNAL_PROJECTION_GAP = 0",
  );

  const nonAi = await observeHumanEdit({
    orgId,
    sourceAgentRunId: "",
    actorUserId: actor.id,
    artifactType: "note",
    artifactId: "note_1",
    committedVersion: "1",
    commitAction: "save",
    before: "user wrote this",
    after: "user wrote this edited",
  });
  ok(nonAi.status === "skipped", "non-AI artifact → no HUMAN_EDIT", nonAi);

  const cross = await observeHumanEdit({
    orgId: `${orgId}_other`,
    sourceAgentRunId: runA.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_x",
    committedVersion: "v1",
    commitAction: "save",
    before: "a",
    after: "b",
  });
  ok(cross.status === "rejected", "cross-org sourceRun → reject", cross);

  const artifactOrg = await observeHumanEdit({
    orgId,
    sourceAgentRunId: runA.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_foreign",
    committedVersion: "v1",
    commitAction: "save",
    before: "a",
    after: "b",
    artifactOrgId: `${orgId}_other`,
  });
  ok(artifactOrg.status === "rejected", "cross-org artifact → reject", artifactOrg);

  // ── Scenario B — Override ──
  const runB = await seedRun("awaiting_approval");
  await emit(runB.id, "run.started", { userMessageId: "msg_b" });
  await emit(runB.id, "agent.output", { hash: "hB", bytes: 4 });
  const paReject = await db.pendingAction.create({
    data: {
      type: "email.send",
      title: "Send quote email",
      preview: "AI proposed send",
      payload: { to: "customer@example.test" },
      status: "rejected",
      createdById: actor.id,
      orgId,
      agentRunId: runB.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      decidedAt: new Date(),
      decidedById: actor.id,
    },
  });
  await reconcileAssistantRunFromPendingActions({
    orgId,
    runId: runB.id,
    triggeredByUserId: actor.id,
    reason: "pending_action_rejected",
    triggerAction: {
      id: paReject.id,
      type: "email.send",
      outcome: "rejected",
    },
  });
  await reconcileAssistantRunFromPendingActions({
    orgId,
    runId: runB.id,
    triggeredByUserId: actor.id,
    reason: "pending_action_rejected",
    triggerAction: {
      id: paReject.id,
      type: "email.send",
      outcome: "rejected",
    },
  });
  const eventsB = await db.agentRunEvent.findMany({
    where: { runId: runB.id },
    orderBy: { sequence: "asc" },
  });
  const rejected = eventsB.filter((e) => e.eventType === "approval.rejected");
  const humanOverrideEvents = eventsB.filter((e) => e.eventType === "human.override");
  ok(rejected.length === 1, "B: AI PA rejected → one approval.rejected", rejected.length);
  ok(humanOverrideEvents.length === 0, "B: no duplicate human.override event");
  ok(
    mapAgentRunEventToAutopilot("approval.rejected", rejected[0]?.payload)
      ?.eventType === "HUMAN_OVERRIDE",
    "B: approval.rejected maps HUMAN_OVERRIDE",
  );
  ok(
    !JSON.stringify(rejected[0]?.payload ?? {}).includes("AI was wrong"),
    "B: no inferred overrideReason",
  );
  const stillRejected = await db.pendingAction.findUnique({ where: { id: paReject.id } });
  ok(stillRejected?.status === "rejected", "B: business SoT remains PendingAction.status");

  const observeDup = await observeHumanOverride({
    orgId,
    sourceAgentRunId: runB.id,
    actorUserId: actor.id,
    overrideType: "REJECTED",
    decisionRef: paReject.id,
    pendingActionId: paReject.id,
    actionType: "email.send",
  });
  ok(
    observeDup.status === "duplicate",
    "B: observe with same rejection key suppressed",
    observeDup,
  );

  const runBApprove = await seedRun("awaiting_approval");
  await emit(runBApprove.id, "run.started", { userMessageId: "msg_b2" });
  const paApprove = await db.pendingAction.create({
    data: {
      type: "email.send",
      title: "Send quote email",
      preview: "AI proposed send",
      payload: { to: "customer@example.test" },
      status: "executed",
      createdById: actor.id,
      orgId,
      agentRunId: runBApprove.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      decidedAt: new Date(),
      decidedById: actor.id,
      executedAt: new Date(),
    },
  });
  await reconcileAssistantRunFromPendingActions({
    orgId,
    runId: runBApprove.id,
    triggeredByUserId: actor.id,
    reason: "pending_action_executed",
    triggerAction: {
      id: paApprove.id,
      type: "email.send",
      outcome: "executed",
    },
  });
  const eventsB2 = await db.agentRunEvent.findMany({
    where: { runId: runBApprove.id },
  });
  ok(
    eventsB2.some((e) => e.eventType === "approval.executed") &&
      !eventsB2.some((e) => e.eventType === "approval.rejected") &&
      !eventsB2.some((e) => e.eventType === "human.override"),
    "B: approve → HUMAN_ACTION source, not HUMAN_OVERRIDE",
  );

  const unlinkedOverride = await observeHumanOverride({
    orgId,
    sourceAgentRunId: "",
    actorUserId: actor.id,
    overrideType: "REJECTED",
    decisionRef: "manual_1",
  });
  ok(unlinkedOverride.status === "skipped", "B: manual action no AI lineage → no override");

  const runReplace = await seedRun();
  await emit(runReplace.id, "agent.output", { hash: "hR" });
  const replaced = await observeHumanOverride({
    orgId,
    sourceAgentRunId: runReplace.id,
    actorUserId: actor.id,
    overrideType: "REPLACED",
    decisionRef: "rec_vendor_a",
    replacementRef: "vendor_b",
  });
  ok(replaced.status === "written", "B: replacement linked to AI rec → HUMAN_OVERRIDE", replaced);
  const replaceEvent = await db.agentRunEvent.findFirst({
    where: { runId: runReplace.id, eventType: "human.override" },
  });
  ok(
    JSON.stringify(replaceEvent?.payload ?? {}).includes("vendor_b") &&
      !JSON.stringify(replaceEvent?.payload ?? {}).includes("Vendor B full proposal"),
    "B: replacementRef persisted, replacement body not",
  );

  await drain(runB.id);
  const overlayB = await db.autopilotRun.findUnique({
    where: { agentRunId: runB.id },
    include: { events: true },
  });
  ok(
    overlayB?.humanOverride === true &&
      (overlayB?.events ?? []).some((e) => e.eventType === "HUMAN_OVERRIDE"),
    "B: HUMAN_OVERRIDE projected",
  );

  // ── Scenario C — Re-Ask ──
  const runC = await seedRun();
  await emit(runC.id, "run.started", { userMessageId: "msg_c" });
  await emit(runC.id, "agent.output", { hash: "hC" });
  await completeAgentRun(orgId, runC.id);
  const runC2 = await seedRun();
  await db.agentRun.update({
    where: { id: runC2.id },
    data: { metadata: { retriedFromRunId: runC.id } },
  });
  const reask = await observeReAsk({
    orgId,
    originalRunId: runC.id,
    newRunId: runC2.id,
    actorUserId: actor.id,
    retryActionId: `assistant-run-retry:${runC.id}:1`,
    originalMessageId: "msg_c",
  });
  ok(reask.status === "written", "C: explicit retry → RE_ASK_SIGNAL", reask);
  const replayReask = await observeReAsk({
    orgId,
    originalRunId: runC.id,
    newRunId: runC2.id,
    actorUserId: actor.id,
    retryActionId: `assistant-run-retry:${runC.id}:1`,
    originalMessageId: "msg_c",
  });
  ok(replayReask.status === "duplicate", "E: same retry replayed → one logical signal", replayReask);
  const reaskEvent = await db.agentRunEvent.findFirst({
    where: { runId: runC.id, eventType: "human.reask" },
  });
  const reaskPayload = (reaskEvent?.payload ?? {}) as Record<string, unknown>;
  ok(
    reaskPayload.originalAgentRunId === runC.id &&
      reaskPayload.newAgentRunId === runC2.id,
    "C: sourceRunId → newRunId correlation",
  );
  await drain(runC.id);
  const overlayC = await db.autopilotRun.findUnique({
    where: { agentRunId: runC.id },
    include: { events: true },
  });
  ok(
    overlayC?.reAskStatus === "CONFIRMED" &&
      (overlayC?.events ?? []).some((e) => e.eventType === "RE_ASK_SIGNAL"),
    "C: RE_ASK_SIGNAL projected",
  );

  // ── Scenario D — Ordinary follow-up ──
  const runD = await seedRun();
  await emit(runD.id, "run.started", { userMessageId: "msg_d" });
  await emit(runD.id, "agent.output", { hash: "hD" });
  await completeAgentRun(orgId, runD.id);
  const follow = await seedRun();
  await emit(follow.id, "run.started", { userMessageId: "msg_follow" });
  const reaskD = await db.agentRunEvent.count({
    where: {
      runId: { in: [runD.id, follow.id] },
      eventType: "human.reask",
    },
  });
  ok(reaskD === 0, "D: ordinary follow-up → RE_ASK_SIGNAL = 0");

  // ── B1 — business fact committed, observe fails, reconciler recovers ──
  const runFact = await seedRun();
  await emit(runFact.id, "run.started", { userMessageId: "msg_fact" });
  await emit(runFact.id, "agent.output", { hash: "hFact" });
  await completeAgentRun(orgId, runFact.id);
  forceNextHumanSignalAppendFailureForTests();
  const feedback = await createHumanFeedbackEvent({
    orgId,
    userId: actor.id,
    taskType: "email_draft",
    humanDecision: "edited",
    aiOutputRef: { messageId: "msg_output_ref" },
    aiOutputSnapshot: "Dear customer, here is the quote.",
    humanEditedOutput: "Dear customer, here is the revised quote.",
    agentRunId: runFact.id,
  });
  const factEditsBefore = await db.agentRunEvent.count({
    where: { runId: runFact.id, eventType: "human.edit" },
  });
  ok(Boolean(feedback.id), "B1: HumanFeedbackEvent committed despite observe fail");
  ok(factEditsBefore === 0, "B1: initial HUMAN_EDIT append failed, no signal yet");
  await reconcileHumanSignals({ orgId, runId: runFact.id });
  const factEdits = await db.agentRunEvent.findMany({
    where: { runId: runFact.id, eventType: "human.edit" },
  });
  ok(factEdits.length === 1, "B1: reconciler writes exactly one HUMAN_EDIT");
  const factPayload = (factEdits[0]?.payload ?? {}) as Record<string, unknown>;
  ok(
    factPayload.sourceOutputRef === "msg_output_ref" &&
      factPayload.sourceOutputRef !== runFact.id,
    "B3: sourceOutputRef is messageId, not agentRunId",
  );
  const factOutbox = await db.autopilotTelemetryOutbox.count({
    where: { agentRunId: runFact.id, noticeType: "event", sourceEventType: "human.edit" },
  });
  ok(factOutbox === 1, "B1: outbox exists after reconcile");
  await drain(runFact.id);
  const factProjected = await db.autopilotRunEvent.count({
    where: { orgId, eventType: "HUMAN_EDIT", run: { agentRunId: runFact.id } },
  });
  ok(factProjected === 1, "B1: projection appears after drain");

  const runReaskFact = await seedRun();
  await emit(runReaskFact.id, "agent.output", { hash: "hRF" });
  await completeAgentRun(orgId, runReaskFact.id);
  const runReaskNew = await seedRun();
  await db.agentRun.update({
    where: { id: runReaskNew.id },
    data: { metadata: { retriedFromRunId: runReaskFact.id } },
  });
  const retryKey = `assistant-run-retry:${runReaskFact.id}:1`;
  await db.approvalDecisionIdempotency.create({
    data: {
      orgId,
      idempotencyKey: retryKey,
      approvalKey: `assistant-run-retry:${runReaskFact.id}`,
      action: "retry",
      userId: actor.id,
      resultJson: {
        status: "COMPLETED",
        retryAttempt: 1,
        oldRunId: runReaskFact.id,
        newRunId: runReaskNew.id,
        userMessageId: "msg_retry_src",
      },
    },
  });
  forceNextHumanSignalAppendFailureForTests();
  const failedReask = await observeReAsk({
    orgId,
    originalRunId: runReaskFact.id,
    newRunId: runReaskNew.id,
    actorUserId: actor.id,
    retryActionId: retryKey,
    originalMessageId: "msg_retry_src",
  });
  ok(failedReask.status === "failed", "B1: initial RE_ASK append failed", failedReask);
  ok(
    (await db.agentRunEvent.count({
      where: { runId: runReaskFact.id, eventType: "human.reask" },
    })) === 0,
    "B1: no human.reask before reconcile",
  );
  await reconcileHumanSignals({ orgId, runId: runReaskFact.id });
  ok(
    (await db.agentRunEvent.count({
      where: { runId: runReaskFact.id, eventType: "human.reask" },
    })) === 1,
    "B1: reconciler recovers exactly one RE_ASK",
  );

  const runPaFact = await seedRun("awaiting_approval");
  const paFact = await db.pendingAction.create({
    data: {
      type: "email.send",
      title: "Send quote",
      preview: "AI proposed send",
      payload: { to: "customer@example.test" },
      status: "rejected",
      createdById: actor.id,
      orgId,
      agentRunId: runPaFact.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      decidedAt: new Date(),
      decidedById: actor.id,
    },
  });
  ok(
    (await db.agentRunEvent.count({
      where: { runId: runPaFact.id, eventType: "approval.rejected" },
    })) === 0,
    "B1: PA rejected is durable without signal yet",
  );
  await reconcileHumanSignals({ orgId, runId: runPaFact.id });
  ok(
    (await db.agentRunEvent.count({
      where: { runId: runPaFact.id, eventType: "approval.rejected" },
    })) === 1,
    "B1: PA reconciler recovers HUMAN_OVERRIDE source",
  );
  const paStill = await db.pendingAction.findUnique({ where: { id: paFact.id } });
  ok(paStill?.status === "rejected", "B1: PA business status unchanged");

  // ── B2 — org / lineage validation ──
  const foreignActorEdit = await observeHumanEdit({
    orgId,
    sourceAgentRunId: runA.id,
    actorUserId: foreignActor.id,
    artifactType: "email_draft",
    artifactId: "draft_foreign_actor",
    committedVersion: "v1",
    commitAction: "save",
    before: "a",
    after: "b",
  });
  ok(
    foreignActorEdit.status === "rejected" &&
      foreignActorEdit.reason === "FOREIGN_ACTOR",
    "B2: foreign actor → REJECT",
    foreignActorEdit,
  );

  const foreignSourceRun = await db.agentRun.create({
    data: {
      orgId: `${orgId}_other`,
      sessionId: session.id,
      runType: "conversation",
      status: "completed",
      startedAt: new Date(),
    },
  });
  const foreignSource = await observeHumanEdit({
    orgId,
    sourceAgentRunId: foreignSourceRun.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_foreign_run",
    committedVersion: "v1",
    commitAction: "save",
    before: "a",
    after: "b",
  });
  ok(
    foreignSource.status === "rejected" &&
      foreignSource.reason === "FOREIGN_SOURCE_RUN",
    "B2: foreign source run → REJECT",
    foreignSource,
  );

  const foreignNew = await db.agentRun.create({
    data: {
      orgId: `${orgId}_other`,
      sessionId: session.id,
      runType: "conversation",
      status: "completed",
      startedAt: new Date(),
      metadata: { retriedFromRunId: runC.id },
    },
  });
  const foreignNewReask = await observeReAsk({
    orgId,
    originalRunId: runC.id,
    newRunId: foreignNew.id,
    actorUserId: actor.id,
    retryActionId: `assistant-run-retry:${runC.id}:foreign`,
  });
  ok(
    foreignNewReask.status === "rejected" &&
      foreignNewReask.reason === "FOREIGN_NEW_RUN",
    "B2: foreign new retry run → REJECT",
    foreignNewReask,
  );

  const wrongMeta = await seedRun();
  await db.agentRun.update({
    where: { id: wrongMeta.id },
    data: { metadata: { retriedFromRunId: "not_the_original" } },
  });
  const wrongRetry = await observeReAsk({
    orgId,
    originalRunId: runC.id,
    newRunId: wrongMeta.id,
    actorUserId: actor.id,
    retryActionId: `assistant-run-retry:${runC.id}:wrong`,
  });
  ok(
    wrongRetry.status === "rejected" &&
      wrongRetry.reason === "INVALID_RETRIED_FROM_RUN",
    "B2: wrong retriedFromRunId → REJECT",
    wrongRetry,
  );

  const foreignPa = await db.pendingAction.create({
    data: {
      type: "email.send",
      title: "Foreign PA",
      preview: "other org",
      payload: {},
      status: "rejected",
      createdById: actor.id,
      orgId: `${orgId}_other`,
      agentRunId: runB.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const foreignPaObs = await observeHumanOverride({
    orgId,
    sourceAgentRunId: runB.id,
    actorUserId: actor.id,
    overrideType: "REJECTED",
    decisionRef: foreignPa.id,
    pendingActionId: foreignPa.id,
  });
  ok(
    foreignPaObs.status === "rejected" &&
      foreignPaObs.reason === "FOREIGN_PENDING_ACTION",
    "B2: foreign PendingAction → REJECT",
    foreignPaObs,
  );

  const validSameOrg = await observeHumanOverride({
    orgId,
    sourceAgentRunId: runReplace.id,
    actorUserId: actor.id,
    overrideType: "CANCELLED_AI_ACTION",
    decisionRef: "cancel_same_org",
  });
  ok(validSameOrg.status === "written", "B2: valid same-org path → PASS", validSameOrg);

  // ── Capture OFF ──
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "0";
  const runOff = await seedRun();
  const beforeOff = await db.autopilotTelemetryOutbox.count({
    where: { agentRunId: runOff.id },
  });
  await emit(runOff.id, "run.started", { userMessageId: "msg_off" });
  await completeAgentRun(orgId, runOff.id);
  const offEdit = await observeHumanEdit({
    orgId,
    sourceAgentRunId: runOff.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_off",
    committedVersion: "v1",
    commitAction: "save",
    before: "alpha",
    after: "beta",
  });
  ok(offEdit.status === "written", "capture-off: business/observe still works", offEdit);
  const afterOff = await db.autopilotTelemetryOutbox.count({
    where: { agentRunId: runOff.id },
  });
  ok(afterOff === beforeOff, "capture-off: outbox ZERO extra");
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";

  // ── Processor down then drain ──
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "0";
  const runP = await seedRun();
  await emit(runP.id, "run.started", { userMessageId: "msg_p" });
  await completeAgentRun(orgId, runP.id);
  const tP = performance.now();
  const pEdit = await observeHumanEdit({
    orgId,
    sourceAgentRunId: runP.id,
    actorUserId: actor.id,
    artifactType: "email_draft",
    artifactId: "draft_p",
    committedVersion: "v1",
    commitAction: "save",
    before: "one",
    after: "two",
  });
  persistLatencies.push(performance.now() - tP);
  ok(pEdit.status === "written", "processor-down: signal source durable", pEdit);
  const skipped = await processAutopilotTelemetryOutbox({
    limit: 25,
    env: { AUTOPILOT_PROCESSOR_ENABLED: "0" },
  });
  ok(skipped.skipped === true, "processor-down: processor skips");
  const projectedBefore = await db.autopilotRunEvent.count({
    where: {
      orgId,
      eventType: { in: [...HUMAN_SIGNAL_PROJECTED_TYPES] },
      run: { agentRunId: runP.id },
    },
  });
  ok(projectedBefore === 0, "processor-down: projection not yet");
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "1";
  const drainP = await drain(runP.id);
  const projectedAfter = await db.autopilotRunEvent.count({
    where: {
      orgId,
      eventType: { in: [...HUMAN_SIGNAL_PROJECTED_TYPES] },
      run: { agentRunId: runP.id },
    },
  });
  const sourceP = await db.agentRunEvent.count({
    where: { runId: runP.id, eventType: { in: [...HUMAN_EDIT_SOURCES] } },
  });
  ok(
    humanSignalProjectionGap({
      sourceHumanSignalCount: sourceP,
      projectedHumanSignalCount: projectedAfter,
    }) === 0,
    "processor-recovery: HUMAN_SIGNAL_PROJECTION_GAP = 0",
  );

  const allHuman = await db.agentRunEvent.findMany({
    where: {
      orgId,
      eventType: { in: ["human.edit", "human.override", "human.reask", "approval.rejected"] },
    },
  });
  ok(
    allHuman.every((e) => !payloadHasSecrets(e.payload)),
    "privacy: RAW_CONTENT_PERSISTED = 0",
  );
  const unlinked = allHuman.filter((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const source =
      (typeof p.sourceAgentRunId === "string" && p.sourceAgentRunId.trim()) ||
      (typeof p.originalAgentRunId === "string" && p.originalAgentRunId.trim());
    return !source;
  });
  ok(unlinked.length === 0, "UNLINKED_HUMAN_SIGNAL = 0 for supported paths");

  console.log(
    `  P50_SIGNAL_PERSIST=${percentile(persistLatencies, 50).toFixed(2)}ms P95_SIGNAL_PERSIST=${percentile(persistLatencies, 95).toFixed(2)}ms PROCESSOR_BATCH=${drainP.ms.toFixed(2)}ms env=isolated-local`,
  );
  console.log(`  drainA_ms=${drainA.ms.toFixed(2)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
