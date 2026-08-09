/**
 * Phase 2A Final — Case K: Stale Worker After Long Tool（确定性 race）
 *
 * 场景：Worker A claim → token T1，step 执行中（模拟长 tool await）→
 * 租约自然过期 → Worker B reclaim → token T2 → A 的 "tool 返回"。
 * 必须证明 A 用 T1 无法：complete step / fail step / set run completed /
 * set run failed / 覆盖 B 的状态 —— 所有 stale mutation 0 rows / LOST_LEASE；
 * 且 B 用 T2 能正常走完整个 fenced V2 round。
 *
 * 结论断言：STALE_WORKER_WRITE_BLOCKED = YES
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  ok,
  finish,
  GOLDEN_GOAL,
} from "./helpers";

requireIsolatedTestDb();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { WORKFORCE_JOB_RUN_TYPE, WORKFORCE_ACTIVE_STATUSES } = await import(
    "../constants"
  );
  const { processWorkforceJobSlice, WORKFORCE_MAX_ATTEMPTS } = await import(
    "../processor"
  );
  const {
    claimRunLease,
    renewRunLease,
    fencedRunUpdate,
    createRunFence,
    fenceGuardedWrite,
    LostLeaseError,
  } = await import("@/lib/agent-runtime/lease");
  const { executeRuntimeV2Round } = await import(
    "@/lib/agent-runtime-v2/executor"
  );

  console.log("Phase 2A Final Case K — Stale Worker After Long Tool");
  const fx = await seedWorkforceFixture("stale");

  // 准备：创建 Job 并推进首个 slice（plan + s1 completed），交还队列
  const job = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job.ok) throw new Error("createWorkforceJob failed");
  const runId = job.runId;

  const slice0 = await processWorkforceJobSlice(runId, { maxRounds: 1 });
  ok(
    slice0.claimed === true && slice0.status === "queued",
    "K0: 首个 slice 完成 plan + s1，交还队列",
    slice0,
  );
  const s2Before = await db.agentRunStep.findFirst({
    where: { runId, stepKey: "s2_opportunities" },
  });
  // pending→ready 提升发生在下一轮 round 开始（refreshReadySteps）
  ok(
    s2Before?.status === "pending" && s2Before.attemptCount === 0,
    "K0: s2 尚未执行（pending，等待下一 slice 提升）",
    { status: s2Before?.status },
  );

  // ── Worker A：极短租约 claim → token T1（DB 中的 token 与 A 手持一致）──
  await db.agentRun.update({
    where: { id: runId },
    data: { nextAttemptAt: new Date(Date.now() - 1_000) },
  });
  const claimA = await claimRunLease({
    runId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 30, // 模拟：A 进入长 tool await，租约在等待中自然过期
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  if (!claimA.ok) throw new Error("worker A claim failed");
  const leaseA = claimA.lease; // T1
  const fenceA = createRunFence({ lease: leaseA });

  // A "正在执行 tool"（长 await）……租约过期
  await sleep(120);

  // ── Worker B：reclaim（过期租约回收）→ token T2 ──
  const claimB = await claimRunLease({
    runId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(claimB.ok, "K1: 租约过期后 Worker B reclaim 成功（token T2）");
  if (!claimB.ok) throw new Error("worker B claim failed");
  const holderB = { lease: claimB.lease };
  const fenceB = createRunFence(holderB);
  ok(
    claimB.lease.leaseExpiresAt.getTime() > leaseA.leaseExpiresAt.getTime(),
    "K1: T2 > T1（token 严格单调，全局唯一）",
  );

  const runUnderB = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const s2UnderB = await db.agentRunStep.findFirstOrThrow({
    where: { runId, stepKey: "s2_opportunities" },
  });

  // ── A 的 "tool 返回"：所有 stale mutation 必须被 fence 挡住 ──

  // (a) 轻量探测：fence.check 立即发现 fence 丢失
  ok((await fenceA.check()) === false, "K2: A 的 fence.check() = false（T1 已被 T2 覆盖）");

  // (b) A cannot complete step（走 V2 内部同款 fenced 写入）
  let stepCompleteBlocked = false;
  try {
    await fenceGuardedWrite(fenceA, (c) =>
      c.agentRunStep.update({
        where: { id: s2UnderB.id },
        data: { status: "completed", completedAt: new Date() },
      }),
    );
  } catch (e) {
    stepCompleteBlocked = e instanceof LostLeaseError;
  }
  ok(stepCompleteBlocked, "K3: A 无法 complete step（fence.guard → LOST_LEASE）");

  // (c) A cannot fail step
  let stepFailBlocked = false;
  try {
    await fenceGuardedWrite(fenceA, (c) =>
      c.agentRunStep.update({
        where: { id: s2UnderB.id },
        data: { status: "failed", errorCode: "tool_failed" },
      }),
    );
  } catch (e) {
    stepFailBlocked = e instanceof LostLeaseError;
  }
  ok(stepFailBlocked, "K4: A 无法 fail step（fence.guard → LOST_LEASE）");

  // (d) A cannot set run completed（0 rows）
  const staleComplete = await fencedRunUpdate({
    lease: leaseA,
    data: { status: "completed", completedAt: new Date() },
  });
  ok(!staleComplete, "K5: A 无法 set run completed（fencedRunUpdate 0 rows）");

  // (e) A cannot set run failed（0 rows）
  const staleFail = await fencedRunUpdate({
    lease: leaseA,
    data: { status: "failed", errorCode: "model_failed" },
  });
  ok(!staleFail, "K6: A 无法 set run failed（fencedRunUpdate 0 rows）");

  // (f) A 无法续租（token 已换代）
  const staleRenew = await renewRunLease({
    lease: leaseA,
    activeStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(!staleRenew.ok, "K7: A 无法用 T1 续租");

  // (g) A 带着 stale fence 走完整 V2 round → lost_lease，且不产生任何状态写入
  const staleRound = await executeRuntimeV2Round({
    orgId: fx.orgId,
    runId,
    userId: fx.ownerUserId,
    role: "sales",
    fence: fenceA,
  });
  ok(
    staleRound.status === "lost_lease",
    "K8: A 的 V2 round 返回 lost_lease（Runtime writes 被 fence）",
    staleRound,
  );

  // (h) B 的状态未被 A 覆盖
  const runAfterStale = await db.agentRun.findUniqueOrThrow({
    where: { id: runId },
  });
  const s2AfterStale = await db.agentRunStep.findFirstOrThrow({
    where: { runId, stepKey: "s2_opportunities" },
  });
  ok(
    runAfterStale.status === runUnderB.status &&
      runAfterStale.leaseExpiresAt?.getTime() ===
        holderB.lease.leaseExpiresAt.getTime() &&
      runAfterStale.errorCode === runUnderB.errorCode,
    "K9: run 状态/token 未被 stale worker 覆盖（仍归 B）",
    { status: runAfterStale.status },
  );
  ok(
    s2AfterStale.status === s2UnderB.status &&
      s2AfterStale.attemptCount === s2UnderB.attemptCount &&
      !s2AfterStale.completedAt,
    "K10: step 状态未被 stale worker 覆盖",
    { status: s2AfterStale.status, attempts: s2AfterStale.attemptCount },
  );

  // ── B 用 T2 正常继续 ──
  const renewB = await renewRunLease({
    lease: holderB.lease,
    activeStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(renewB.ok, "K11: B 用 T2 正常续租");
  if (renewB.ok) holderB.lease = renewB.lease;

  const roundB = await executeRuntimeV2Round({
    orgId: fx.orgId,
    runId,
    userId: fx.ownerUserId,
    role: "sales",
    fence: fenceB,
  });
  ok(
    roundB.status === "continued",
    "K12: B 的 fenced V2 round 正常执行",
    roundB,
  );
  const s2Done = await db.agentRunStep.findFirstOrThrow({
    where: { runId, stepKey: "s2_opportunities" },
  });
  ok(
    s2Done.status === "completed" && s2Done.attemptCount === 1,
    "K13: s2 由 B 完成且仅执行一次（stale A 未贡献 attempt）",
    { status: s2Done.status, attempts: s2Done.attemptCount },
  );

  const requeueB = await fencedRunUpdate({
    lease: holderB.lease,
    allowedFromStatuses: [...WORKFORCE_ACTIVE_STATUSES],
    data: {
      status: "queued",
      leaseExpiresAt: null,
      nextAttemptAt: new Date(),
      attempts: 0,
    },
  });
  ok(requeueB, "K14: B 用 T2 正常交还队列（fenced 写入成功）");

  console.log("\nSTALE_WORKER_WRITE_BLOCKED = YES");
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
