/**
 * Phase 2A Final — Case L: More Than Max Normal Slices
 *
 * attempts 语义 = consecutive retry/crash/recovery budget，不是 total normal
 * slices。合法长 Job 连续推进 > WORKFORCE_MAX_ATTEMPTS 个正常 continuation
 * slice 后必须仍可被 claim（不 queued forever / 不因正常推进 failed）；
 * 连续 retryable failure 仍必须累计并在 maxAttempts 后 failed。
 *
 * 结论断言：NORMAL_CONTINUATION_DOES_NOT_EXHAUST_RETRY_BUDGET = YES
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
  const { WORKFORCE_JOB_RUN_TYPE, WORKFORCE_ACTIVE_STATUSES } = await import(
    "../constants"
  );
  const {
    processWorkforceJobSlice,
    processQueuedWorkforceJobs,
    WORKFORCE_MAX_ATTEMPTS,
  } = await import("../processor");
  const { claimRunLease, fencedRunUpdate } = await import(
    "@/lib/agent-runtime/lease"
  );

  console.log("Phase 2A Final Case L — More Than Max Normal Slices");
  const fx = await seedWorkforceFixture("slices");

  // ── L1：合法 Job，每 slice 0 个 round（极端 continuation），
  //        连续正常推进 > WORKFORCE_MAX_ATTEMPTS 个 slice ──
  const job = await createWorkforceJob({
    workDomain: "sales",
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job.ok) throw new Error("createWorkforceJob failed");
  const runId = job.runId;

  const totalSlices = WORKFORCE_MAX_ATTEMPTS + 3; // 明确超过 retry budget
  let allContinued = true;
  const attemptsAfterEach: number[] = [];
  for (let i = 0; i < totalSlices; i++) {
    await db.agentRun.update({
      where: { id: runId },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const r = await processWorkforceJobSlice(runId, { maxRounds: 0 });
    const row = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    attemptsAfterEach.push(row.attempts);
    if (!(r.claimed && r.status === "queued" && row.status === "queued")) {
      allContinued = false;
      break;
    }
  }
  ok(
    allContinued,
    `L1: 连续 ${totalSlices} 个正常 continuation slice（> maxAttempts=${WORKFORCE_MAX_ATTEMPTS}）全部成功交还队列`,
    attemptsAfterEach,
  );
  ok(
    attemptsAfterEach.every((a) => a === 0),
    "L2: 每次正常 continuation 后 attempts 归零（不消耗 retry budget）",
    attemptsAfterEach,
  );

  const rowAfter = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  ok(
    rowAfter.status === "queued" && rowAfter.attempts < WORKFORCE_MAX_ATTEMPTS,
    "L3: 超过 maxAttempts 个 slice 后 Job 未 failed、未卡死",
    { status: rowAfter.status, attempts: rowAfter.attempts },
  );

  // 仍可被正常 claim（不被 attempts 限制卡死）
  await db.agentRun.update({
    where: { id: runId },
    data: { nextAttemptAt: new Date(Date.now() - 1_000) },
  });
  const claimStill = await claimRunLease({
    runId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(claimStill.ok, "L4: 第 N+1 次仍可被 claim（不会 queued forever）");
  if (claimStill.ok) {
    await fencedRunUpdate({
      lease: claimStill.lease,
      data: {
        status: "queued",
        leaseExpiresAt: null,
        nextAttemptAt: new Date(),
        attempts: 0,
      },
    });
  }

  // 正常推进（有实际 round）也同样不耗尽预算，且 Job 真实前进
  await db.agentRun.update({
    where: { id: runId },
    data: { nextAttemptAt: new Date(Date.now() - 1_000) },
  });
  const progressSlice = await processWorkforceJobSlice(runId, { maxRounds: 1 });
  const s1 = await db.agentRunStep.findFirst({
    where: { runId, stepKey: "s1_pipeline" },
  });
  ok(
    progressSlice.claimed === true && s1?.status === "completed",
    "L5: 正常推进 slice 真实执行步骤（s1 completed），Job 未被 attempts 语义拖住",
    { status: progressSlice.status, s1: s1?.status },
  );

  // ── L6：连续 retryable failure 仍累计 → maxAttempts → failed ──
  delete process.env.OPENAI_API_KEY;
  const jobFail = await createWorkforceJob({
    workDomain: "sales",
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: "供应商付款计划审查与安排核对（Case L failure 分支）",
  });
  if (!jobFail.ok) throw new Error("createWorkforceJob failed");

  const failureAttempts: number[] = [];
  let lastStatus = "";
  for (let i = 0; i < WORKFORCE_MAX_ATTEMPTS + 1; i++) {
    await db.agentRun.update({
      where: { id: jobFail.runId },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const r = await processWorkforceJobSlice(jobFail.runId);
    if (!r.claimed) break;
    const row = await db.agentRun.findUniqueOrThrow({
      where: { id: jobFail.runId },
    });
    failureAttempts.push(row.attempts);
    lastStatus = r.status;
    if (r.status === "failed") break;
  }
  ok(
    failureAttempts.every((a, i) => a === i + 1),
    "L6: 连续 retryable failure 的 attempts 严格递增（不被正常语义重置）",
    failureAttempts,
  );
  const failRow = await db.agentRun.findUniqueOrThrow({
    where: { id: jobFail.runId },
  });
  ok(
    failRow.status === "failed" &&
      lastStatus === "failed" &&
      failRow.attempts >= WORKFORCE_MAX_ATTEMPTS,
    "L7: 连续失败到 maxAttempts → failed（失败预算未被放宽）",
    { status: failRow.status, attempts: failRow.attempts },
  );
  const claimAfterFail = await claimRunLease({
    runId: jobFail.runId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(!claimAfterFail.ok, "L8: failed 后不再可被 claim");
  const sweep = await processQueuedWorkforceJobs(5);
  ok(!sweep.runIds.includes(jobFail.runId), "L9: 批量消费不再拾取已失败 Job");

  console.log("\nNORMAL_CONTINUATION_DOES_NOT_EXHAUST_RETRY_BUDGET = YES");
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
