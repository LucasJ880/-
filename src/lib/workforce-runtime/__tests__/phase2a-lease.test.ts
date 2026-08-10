/**
 * Phase 2A — Case D / E / F / G / J
 * D Concurrent Claim：并发双 claim 恰好一个成功
 * E Lease Renewal：renew 后 T2>T1 且第二 worker 无法 claim
 * F Expired Lease Reclaim：模拟 crash → 新 worker claim 成功并从既有 step state 续跑
 * G No Duplicate Completed Step：completed step 在 reclaim 后不被重置/重跑
 * J Retry Exhaustion：retryable failure 到 maxAttempts → failed 且不再被 claim
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
  const { claimRunLease, renewRunLease } = await import(
    "@/lib/agent-runtime/lease"
  );

  console.log("Phase 2A Case D/E/F/G/J — Lease / Reclaim / No-Duplicate / Exhaustion");
  const fx = await seedWorkforceFixture("lease");

  const claimArgs = (runId: string) => ({
    runId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });

  // ── Case D：并发双 claim ──
  const jobD = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!jobD.ok) throw new Error("createWorkforceJob failed");
  const [c1, c2] = await Promise.all([
    claimRunLease(claimArgs(jobD.runId)),
    claimRunLease(claimArgs(jobD.runId)),
  ]);
  ok(
    Number(c1.ok) + Number(c2.ok) === 1,
    "D: Promise.all 双 claim 恰好一个成功",
    { c1: c1.ok, c2: c2.ok },
  );

  // ── Case E：续租 + 第二 worker 无法 claim ──
  const winner = c1.ok ? c1 : c2;
  if (!winner.ok) throw new Error("no winner");
  const t1 = winner.lease.leaseExpiresAt;
  const renewed = await renewRunLease({
    lease: winner.lease,
    activeStatuses: ["running", ...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(renewed.ok, "E: 持有者续租成功");
  const t2 = renewed.ok ? renewed.lease.leaseExpiresAt : t1;
  ok(t2.getTime() > t1.getTime(), "E: T2 > T1（token 严格单调递增）", {
    t1: t1.toISOString(),
    t2: t2.toISOString(),
  });
  const intruder = await claimRunLease(claimArgs(jobD.runId));
  ok(!intruder.ok, "E: 租约有效期间第二 worker 无法 claim");
  // stale token（t1）续租必须失败 —— fencing 生效
  const staleRenew = await renewRunLease({
    lease: { runId: jobD.runId, leaseExpiresAt: t1, leaseMs: 60_000 },
    activeStatuses: ["running", ...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(!staleRenew.ok, "E: 旧 token 续租失败（leaseExpiresAt fencing）");

  // ── Case F/G：过期重认领 + completed step 不重跑 ──
  const jobF = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!jobF.ok) throw new Error("createWorkforceJob failed");

  // slice 1：规划 + 执行 s1_pipeline（纯 DB 读，无需 LLM）
  const slice1 = await processWorkforceJobSlice(jobF.runId, {
    maxRounds: 1,
  });
  ok(
    slice1.claimed === true,
    "F: 首个 slice 认领并推进（plan + s1）",
    slice1,
  );
  const s1After = await db.agentRunStep.findFirst({
    where: { runId: jobF.runId, stepKey: "s1_pipeline" },
  });
  ok(
    s1After?.status === "completed" && s1After.attemptCount === 1,
    "F: s1_pipeline 已完成（attemptCount=1）",
    { status: s1After?.status, attempts: s1After?.attemptCount },
  );
  const s1CompletedAt = s1After?.completedAt?.toISOString();

  // 模拟 crash：执行中 + 租约已过期（不走正常交还）
  await db.agentRun.update({
    where: { id: jobF.runId },
    data: {
      status: "executing",
      leaseExpiresAt: new Date(Date.now() - 5_000),
      nextAttemptAt: null,
    },
  });

  // 新 worker 重认领并续跑（executeRound 只挑 status=ready 的步骤）
  const slice2 = await processWorkforceJobSlice(jobF.runId, {
    maxRounds: 1,
  });
  ok(slice2.claimed === true, "F: 租约过期后新 worker claim 成功", slice2);

  const s1Again = await db.agentRunStep.findFirst({
    where: { runId: jobF.runId, stepKey: "s1_pipeline" },
  });
  const s2Now = await db.agentRunStep.findFirst({
    where: { runId: jobF.runId, stepKey: "s2_opportunities" },
  });
  ok(
    s1Again?.status === "completed" &&
      s1Again.attemptCount === 1 &&
      s1Again.completedAt?.toISOString() === s1CompletedAt,
    "G: reclaim 后 completed step 执行次数/完成时间不变（未重跑）",
    { attempts: s1Again?.attemptCount },
  );
  ok(
    s2Now?.status === "completed" && s2Now.attemptCount === 1,
    "F/G: 续跑从既有 step state 推进（s2 被执行而非整 Job 重跑）",
    { status: s2Now?.status, attempts: s2Now?.attemptCount },
  );

  // ── Case J：retryable failure 耗尽 → failed 且不可再 claim ──
  // 目标不匹配黄金模板 → planner 走模型 → 测试环境无 OPENAI_API_KEY → 抛错 → retryable 回队
  delete process.env.OPENAI_API_KEY;
  const jobJ = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: "供应商付款计划审查与安排核对",
  });
  if (!jobJ.ok) throw new Error("createWorkforceJob failed");

  let lastStatus = "";
  for (let i = 0; i < WORKFORCE_MAX_ATTEMPTS + 1; i++) {
    await db.agentRun.update({
      where: { id: jobJ.runId },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const r = await processWorkforceJobSlice(jobJ.runId);
    if (!r.claimed) break;
    lastStatus = r.status;
    if (r.status === "failed") break;
  }
  const jobJRow = await db.agentRun.findUniqueOrThrow({
    where: { id: jobJ.runId },
  });
  ok(
    jobJRow.status === "failed" && lastStatus === "failed",
    "J: 重复 retryable failure 到 maxAttempts → failed",
    { status: jobJRow.status, attempts: jobJRow.attempts },
  );
  ok(
    jobJRow.attempts >= WORKFORCE_MAX_ATTEMPTS,
    "J: attempts 达到上限",
    jobJRow.attempts,
  );
  const claimAfterFail = await claimRunLease(claimArgs(jobJ.runId));
  ok(!claimAfterFail.ok, "J: failed 后不再可被 claim");
  const sweep = await processQueuedWorkforceJobs(5);
  ok(
    !sweep.runIds.includes(jobJ.runId),
    "J: 批量消费不再拾取已失败 Job",
  );
  const failEvents = await db.agentRunEvent.findMany({
    where: { runId: jobJ.runId, eventType: "job.failed" },
  });
  ok(failEvents.length > 0, "J: job.failed 事件已写入");

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
