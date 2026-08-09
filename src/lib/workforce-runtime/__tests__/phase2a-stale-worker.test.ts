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

  // ════════════════════════════════════════════════════════════════
  // K-PLAN：Stale Planner Result Persist（Final BLOCKER 确定性 race）
  //
  // A 持有 planner 结果（长 planner await 后）→ T1 过期 → B reclaim T2 →
  // A 调 persistPlanAndSteps({plan, fence: fenceA})。fence 校验与
  // planJson/status/steps 写入同一事务：A 必须 LOST_LEASE 且零写入。
  // ════════════════════════════════════════════════════════════════

  const { persistPlanAndSteps } = await import(
    "@/lib/agent-runtime-v2/persist"
  );
  const { PlannerOutputSchema } = await import(
    "@/lib/agent-runtime-v2/schemas"
  );

  // 合法 PlannerOutput（不调真实 LLM）；A/B 用不同 objective 以区分覆盖
  const makePlan = (label: string) =>
    PlannerOutputSchema.parse({
      objective: `${label}：整理销售跟进优先级`,
      summary: `${label} 的确定性测试计划`,
      completionCriteria: [
        {
          id: "c1",
          description: "跟进清单已产出",
          verificationType: "database_state",
        },
      ],
      steps: [
        {
          id: "p1_list",
          title: "拉取逾期跟进清单",
          description: "查询逾期商机",
          dependsOn: [],
          executionMode: "read",
          riskLevel: "LOW",
          requiresApproval: false,
          expectedOutput: "逾期清单",
        },
        {
          id: "p2_rank",
          title: "排序",
          description: "按金额与逾期天数排序",
          dependsOn: ["p1_list"],
          executionMode: "analysis",
          riskLevel: "LOW",
          requiresApproval: false,
          expectedOutput: "优先级排序",
        },
      ],
    });
  const planA = makePlan("STALE PLAN A");
  const planB = makePlan("PLAN B");

  // Setup：全新 Job，planJson=null、0 step
  const job2 = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job2.ok) throw new Error("createWorkforceJob (K-PLAN) failed");
  const runId2 = job2.runId;
  {
    const fresh = await db.agentRun.findUniqueOrThrow({ where: { id: runId2 } });
    const stepCount0 = await db.agentRunStep.count({ where: { runId: runId2 } });
    ok(
      fresh.planJson === null && stepCount0 === 0,
      "K15: 新 Job planJson=null、0 step",
    );
  }

  // Worker A2 claim → T1（极短租约，模拟长 planner await 中过期）
  await db.agentRun.update({
    where: { id: runId2 },
    data: { nextAttemptAt: new Date(Date.now() - 1_000) },
  });
  const claimA2 = await claimRunLease({
    runId: runId2,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 30,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  if (!claimA2.ok) throw new Error("worker A2 claim failed");
  const fenceA2 = createRunFence({ lease: claimA2.lease });

  // A "planner 长 await"……租约过期，B reclaim → T2
  await sleep(120);
  const claimB2 = await claimRunLease({
    runId: runId2,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(claimB2.ok, "K16: B reclaim 成功（T2 接管 K-PLAN Job）");
  if (!claimB2.ok) throw new Error("worker B2 claim failed");
  const holderB2 = { lease: claimB2.lease };
  const fenceB2 = createRunFence(holderB2);

  const runUnderB2 = await db.agentRun.findUniqueOrThrow({
    where: { id: runId2 },
  });
  const verifCountBefore = await db.agentRunVerification.count({
    where: { runId: runId2 },
  });

  // A 带 planner 结果调 fenced persist → 必须 LOST_LEASE
  let stalePersistBlocked = false;
  try {
    await persistPlanAndSteps({
      orgId: fx.orgId,
      runId: runId2,
      plan: planA,
      fence: fenceA2,
    });
  } catch (e) {
    stalePersistBlocked = e instanceof LostLeaseError;
  }
  ok(
    stalePersistBlocked,
    "K17: A 的 stale persist → LostLeaseError（fence 校验与写入同一事务）",
  );

  {
    const after = await db.agentRun.findUniqueOrThrow({ where: { id: runId2 } });
    const stepCount = await db.agentRunStep.count({ where: { runId: runId2 } });
    const verifCount = await db.agentRunVerification.count({
      where: { runId: runId2 },
    });
    const planCreatedEvents = await db.agentRunEvent.count({
      where: { runId: runId2, eventType: "plan.created" },
    });
    ok(after.planJson === null, "K18: planJson 未被 stale A 写入（仍 null）");
    ok(
      after.status === runUnderB2.status &&
        after.leaseExpiresAt?.getTime() ===
          holderB2.lease.leaseExpiresAt.getTime(),
      "K19: run status/token 未被 stale A 修改（仍归 B）",
      { status: after.status },
    );
    ok(stepCount === 0, "K20: step count = 0（stale A 未创建任何 step）");
    ok(
      verifCount === verifCountBefore,
      "K21: verification 未被 stale A 改动",
    );
    ok(
      planCreatedEvents === 0,
      "K22: 无 A 发出的 plan.created 事件（persist 失败绝不 emit）",
    );
  }

  // B 用 fenceB 调同一函数 → 必须成功（planJson + status=planned + steps 一次）
  await persistPlanAndSteps({
    orgId: fx.orgId,
    runId: runId2,
    plan: planB,
    fence: fenceB2,
  });
  {
    const after = await db.agentRun.findUniqueOrThrow({ where: { id: runId2 } });
    const steps = await db.agentRunStep.findMany({
      where: { runId: runId2 },
      orderBy: { stepKey: "asc" },
    });
    const planCreatedEvents = await db.agentRunEvent.count({
      where: { runId: runId2, eventType: "plan.created" },
    });
    const planObj = after.planJson as { objective?: string } | null;
    ok(
      planObj?.objective === planB.objective && after.status === "planned",
      "K23: B 的 fenced persist 成功（planJson persisted、status=planned）",
      { objective: planObj?.objective, status: after.status },
    );
    ok(
      steps.length === 2 &&
        steps.map((s) => s.stepKey).join(",") === "p1_list,p2_rank",
      "K24: steps 恰好创建一次（2 个，key 正确）",
      { count: steps.length },
    );
    ok(planCreatedEvents === 1, "K25: plan.created 恰好一次（B 发出）");
  }

  // B 成功后 A 再用 stale T1 persist → 仍 LOST_LEASE，B 的 plan 不被覆盖
  let stalePersistBlockedAgain = false;
  try {
    await persistPlanAndSteps({
      orgId: fx.orgId,
      runId: runId2,
      plan: planA,
      fence: fenceA2,
    });
  } catch (e) {
    stalePersistBlockedAgain = e instanceof LostLeaseError;
  }
  {
    const after = await db.agentRun.findUniqueOrThrow({ where: { id: runId2 } });
    const steps = await db.agentRunStep.findMany({
      where: { runId: runId2 },
      orderBy: { stepKey: "asc" },
    });
    const planObj = after.planJson as { objective?: string } | null;
    ok(
      stalePersistBlockedAgain,
      "K26: B 成功后 A 重试 persist 仍 LOST_LEASE",
    );
    ok(
      planObj?.objective === planB.objective &&
        steps.length === 2 &&
        steps.map((s) => s.stepKey).join(",") === "p1_list,p2_rank",
      "K27: B 的 plan/steps 未被 stale A 覆盖（内容与数量不变）",
      { objective: planObj?.objective, count: steps.length },
    );
  }

  console.log("\nSTALE_WORKER_WRITE_BLOCKED = YES");
  console.log("STALE_PLANNER_PERSIST = BLOCKED");
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
