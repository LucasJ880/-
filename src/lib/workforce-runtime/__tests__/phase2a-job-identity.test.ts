/**
 * Phase 2A — Case A / B / C
 * A Root Job Identity：runType=workforce_job；runId=rootRunId=jobId；actor/owner/trace 落库
 * B Runtime Restore：DB reload → runtimeFromRunMetadata → 与创建时一致
 * C Metadata Survives Queue：queue/durable transition 后 correlation 不丢
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  ok,
  finish,
  metaOf,
  GOLDEN_GOAL,
} from "./helpers";

requireIsolatedTestDb();

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { WORKFORCE_JOB_RUN_TYPE } = await import("../constants");
  const { runtimeFromRunMetadata } = await import("@/lib/ai/runtime-context");
  const { claimRunLease, fencedRunUpdate } = await import(
    "@/lib/agent-runtime/lease"
  );
  const { createAgentRun } = await import("@/lib/agent-runtime/run");
  const { getOrCreateAgentSession } = await import(
    "@/lib/agent-runtime/session"
  );
  const { enqueueBackgroundAgentRun, isBackgroundPayload } = await import(
    "@/lib/agent-runtime/queue"
  );

  console.log("Phase 2A Case A/B/C — Job Identity / Restore / Metadata Survives Queue");
  const fx = await seedWorkforceFixture("abc");

  // ── Case A：Root Job Identity ──
  const created = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
    channel: "workforce_test",
  });
  ok(created.ok, "A: createWorkforceJob 成功");
  if (!created.ok) return finish();

  const run = await db.agentRun.findUniqueOrThrow({
    where: { id: created.runId },
  });
  const meta = metaOf(run.metadata);
  ok(run.runType === WORKFORCE_JOB_RUN_TYPE, "A: runType=workforce_job");
  ok(run.runtimeVersion === "v2", "A: runtimeVersion=v2");
  ok(run.status === "queued", "A: 初始 status=queued（durable 队列）");
  ok(
    meta.runId === run.id && meta.rootRunId === run.id && meta.jobId === run.id,
    "A: runId=rootRunId=jobId=run.id",
    { runId: meta.runId, rootRunId: meta.rootRunId, jobId: meta.jobId },
  );
  ok(
    meta.actorType === "USER" &&
      meta.actorId === fx.ownerUserId &&
      meta.actorUserId === fx.ownerUserId,
    "A: actor=USER(owner) 落库",
  );
  ok(
    meta.ownerType === "USER" && meta.ownerId === fx.ownerUserId,
    "A: owner=USER(owner) 落库",
  );
  ok(
    typeof run.traceId === "string" &&
      run.traceId.length > 0 &&
      meta.traceId === run.traceId,
    "A: traceId 列 + metadata 一致落库",
  );
  ok(meta.initiatedByUserId === fx.ownerUserId, "A: initiatedByUserId 锚点落库");
  ok(run.startedAt instanceof Date, "A: Job.startedAt 记录创建时刻");

  const events = await db.agentRunEvent.findMany({
    where: { runId: run.id },
    orderBy: { sequence: "asc" },
  });
  ok(
    events.some((e) => e.eventType === "job.created") &&
      events.some((e) => e.eventType === "job.queued"),
    "A: job.created / job.queued 事件写入 AgentRunEvent",
  );
  const createdEvent = events.find((e) => e.eventType === "job.created");
  const evCorr = metaOf(metaOf(createdEvent?.payload).correlation);
  ok(
    evCorr.jobId === run.id &&
      evCorr.rootRunId === run.id &&
      evCorr.ownerId === fx.ownerUserId &&
      evCorr.traceId === run.traceId,
    "A: 事件 correlation 含 jobId/rootRunId/owner/traceId",
    evCorr,
  );

  // ── Case B：Runtime Restore ──
  const reloaded = await db.agentRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  const restored = runtimeFromRunMetadata(reloaded);
  ok(restored.orgId === fx.orgId, "B: orgId 恢复一致");
  ok(
    restored.actor?.type === "USER" &&
      restored.actor.id === fx.ownerUserId &&
      restored.actor.userId === fx.ownerUserId,
    "B: actor 恢复一致",
  );
  ok(
    restored.owner?.type === "USER" && restored.owner.id === fx.ownerUserId,
    "B: owner 恢复一致",
  );
  ok(restored.jobId === run.id, "B: jobId 恢复一致");
  ok(restored.rootRunId === run.id && restored.runId === run.id, "B: run 树恢复一致");
  ok(restored.traceId === run.traceId, "B: traceId 恢复一致");
  ok(restored.channel === "workforce_test", "B: channel 恢复一致");
  ok(restored.sessionId === run.sessionId, "B: sessionId 以 DB 列为准");

  // ── Case C-1：workforce durable transition 后 correlation 不丢 ──
  const claim = await claimRunLease({
    runId: run.id,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: 5,
    reclaimableStatuses: ["running", "executing"],
  });
  ok(claim.ok, "C1: durable claim 成功");
  if (claim.ok) {
    await fencedRunUpdate({
      lease: claim.lease,
      data: {
        status: "queued",
        leaseExpiresAt: null,
        nextAttemptAt: new Date(),
      },
    });
  }
  const afterTransit = await db.agentRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  const m2 = metaOf(afterTransit.metadata);
  ok(
    m2.ownerId === fx.ownerUserId &&
      m2.jobId === run.id &&
      m2.rootRunId === run.id &&
      m2.traceId === run.traceId &&
      m2.actorUserId === fx.ownerUserId,
    "C1: claim→requeue 后 owner/jobId/rootRunId/traceId 全部仍在",
    m2,
  );

  // ── Case C-2（§6 Critical Fix）：enqueueBackgroundAgentRun 合并不覆盖 ──
  const session = await getOrCreateAgentSession({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    channel: "wecom",
    channelUserId: `wf_bg_${fx.tag}`,
  });
  const bg = await createAgentRun({
    orgId: fx.orgId,
    sessionId: session.id,
    runType: "conversation",
    runtime: {
      orgId: fx.orgId,
      actor: { type: "USER", id: fx.ownerUserId, userId: fx.ownerUserId },
      owner: { type: "USER", id: fx.ownerUserId },
      jobId: "job_corr_probe",
      channel: "wecom",
    },
  });
  await enqueueBackgroundAgentRun({
    orgId: fx.orgId,
    runId: bg.run.id,
    payload: {
      background: true,
      userId: fx.ownerUserId,
      userRole: "sales",
      userName: "WF Owner",
      channel: "wecom",
      channelUserId: `wf_bg_${fx.tag}`,
      content: "测试后台任务",
      messageType: "text",
      plan: {
        intent: "general",
        complexity: "complex",
        needsTools: true,
        steps: [],
        source: "heuristic",
      } as never,
    },
  });
  const bgReloaded = await db.agentRun.findUniqueOrThrow({
    where: { id: bg.run.id },
  });
  const m3 = metaOf(bgReloaded.metadata);
  ok(isBackgroundPayload(bgReloaded.metadata), "C2: 旧 reader isBackgroundPayload 仍成立");
  ok(
    m3.ownerType === "USER" &&
      m3.ownerId === fx.ownerUserId &&
      m3.actorUserId === fx.ownerUserId &&
      m3.jobId === "job_corr_probe" &&
      typeof m3.traceId === "string" &&
      typeof m3.rootRunId === "string",
    "C2: enqueue 后 actor/owner/jobId/rootRunId/traceId 全部仍在（§6 修复验证）",
    {
      ownerId: m3.ownerId,
      jobId: m3.jobId,
      traceId: m3.traceId,
      rootRunId: m3.rootRunId,
    },
  );
  ok(
    m3.content === "测试后台任务" && m3.background === true,
    "C2: background payload 字段同样在位",
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
