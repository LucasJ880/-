/**
 * Phase 2A — Case I：Durable Timeout 语义
 * Job 年龄超过旧 timeout（run.startedAt 很旧）但本次 slice 刚开始 →
 * 不得因 startedAt 旧而立即 failed；per-slice 时间预算仍然有效。
 * 对照组：非 workforce 的 runtime_v2 run 保持旧语义（startedAt 超时 → failed）。
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  cleanupWorkforceFixture,
  assertNoLeakedWorkforceJobs,
  ok,
  finish,
  GOLDEN_GOAL,
} from "./helpers";

requireIsolatedTestDb();

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { processWorkforceJobSlice } = await import("../processor");
  const { executeRuntimeV2Round } = await import(
    "@/lib/agent-runtime-v2/executor"
  );
  const { createAgentRun } = await import("@/lib/agent-runtime/run");
  const { getOrCreateAgentSession } = await import(
    "@/lib/agent-runtime/session"
  );

  console.log("Phase 2A Case I — Durable Timeout（per-slice，不看 Job 年龄）");
  const fx = await seedWorkforceFixture("timeout");

  const job = await createWorkforceJob({
    workDomain: "sales",
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job.ok) throw new Error("createWorkforceJob failed");

  // slice 1：规划 + 执行 s1
  await processWorkforceJobSlice(job.runId, { maxRounds: 1 });

  // 让 Job "老化"：startedAt 比 V2 默认 timeout（180s）老得多
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  await db.agentRun.update({
    where: { id: job.runId },
    data: { startedAt: twoHoursAgo, nextAttemptAt: new Date(Date.now() - 1000) },
  });

  // 新 slice：不得因 startedAt 旧而 failed，应继续推进 s2
  const slice = await processWorkforceJobSlice(job.runId, { maxRounds: 1 });
  const runAfter = await db.agentRun.findUniqueOrThrow({
    where: { id: job.runId },
  });
  ok(
    slice.claimed === true && runAfter.status !== "failed",
    "I: Job 年龄超旧 timeout，slice 刚开始 → 不 failed（回答：NO，不再用 run.startedAt 做单次执行 timeout）",
    { slice: slice.claimed ? slice.status : "unclaimed", run: runAfter.status },
  );
  ok(
    runAfter.errorCode !== "external_timeout",
    "I: 未标记 external_timeout",
  );
  ok(
    runAfter.startedAt?.getTime() === twoHoursAgo.getTime(),
    "I: Job.startedAt 未被 claim 重置（保留 Job 真实年龄）",
  );
  const s2 = await db.agentRunStep.findFirst({
    where: { runId: job.runId, stepKey: "s2_opportunities" },
  });
  ok(s2?.status === "completed", "I: 老 Job 的下一步骤正常执行");

  // per-slice 预算仍有效：预算=0 → 本 slice 不执行任何 round，交还队列（而非 failed）
  await db.agentRun.update({
    where: { id: job.runId },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
  const s3Before = await db.agentRunStep.findFirst({
    where: { runId: job.runId, stepKey: "s3_followup_analysis" },
  });
  const zeroBudget = await processWorkforceJobSlice(job.runId, {
    sliceBudgetMs: -1,
    maxRounds: 6,
  });
  const s3After = await db.agentRunStep.findFirst({
    where: { runId: job.runId, stepKey: "s3_followup_analysis" },
  });
  const runAfterZero = await db.agentRun.findUniqueOrThrow({
    where: { id: job.runId },
  });
  ok(
    zeroBudget.claimed === true &&
      zeroBudget.status === "queued" &&
      runAfterZero.status === "queued" &&
      s3Before?.attemptCount === s3After?.attemptCount,
    "I: slice 时间预算用尽 → 交还队列且不执行新 round（per-slice timeout 生效）",
    { status: zeroBudget.claimed ? zeroBudget.status : "unclaimed" },
  );

  // 对照组：非 workforce 的 runtime_v2 run 保持旧 startedAt 超时语义
  const session = await getOrCreateAgentSession({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    channel: "web_assistant",
    channelUserId: `wf_timeout_${fx.tag}`,
  });
  const legacy = await createAgentRun({
    orgId: fx.orgId,
    sessionId: session.id,
    runType: "runtime_v2",
    metadata: { runtimeVersion: "v2", initiatedByUserId: fx.ownerUserId },
  });
  await db.agentRun.update({
    where: { id: legacy.run.id },
    data: {
      runtimeVersion: "v2",
      status: "executing",
      startedAt: twoHoursAgo,
    },
  });
  const legacyRound = await executeRuntimeV2Round({
    orgId: fx.orgId,
    runId: legacy.run.id,
    userId: fx.ownerUserId,
    role: "sales",
  });
  const legacyRun = await db.agentRun.findUniqueOrThrow({
    where: { id: legacy.run.id },
  });
  ok(
    legacyRound.status === "failed" &&
      legacyRun.status === "failed" &&
      legacyRun.errorCode === "external_timeout",
    "I: 对照组 runtime_v2（非 workforce）旧超时语义不变（回归保护）",
    { round: legacyRound.status, errorCode: legacyRun.errorCode },
  );

  // Lane B §5/§7：fixture ownership cleanup —— 只删本 suite 自己的数据，
  // 不给后续 suite 留任何 eligible workforce job
  const cleanedFx = await cleanupWorkforceFixture(fx);
  ok(
    await assertNoLeakedWorkforceJobs(fx),
    "CLEANUP: 本 suite 无 workforce job 泄漏",
    cleanedFx.residue,
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
