/**
 * Phase 2B-2 — CAS Claim / Approval / Stale Lease / Kill-Switch DB 集成测试
 *
 * 覆盖任务书：P5（§29 审批任务单独执行，PendingAction 后 Job
 * awaiting_approval，无新并行批）、P6（§30 double driver：同一 ready Task
 * 恰好一个执行，Tool side effect = 1）、P7（§31 stale lease：旧 worker 迟到
 * 写入 LOST_LEASE，零 stale result / 零 stale Handoff）、§22 kill-switch
 * slice 内即时生效、§23 cancellation 不启动新 Task。
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *       npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  cleanupWorkforceFixture,
  assertNoLeakedWorkforceJobs,
  ok,
  finish,
  metaOf,
} from "./helpers";
import {
  installDbProbe,
  createGate,
  type DbProbe,
  type ProbeRule,
} from "./parallel-probe";

requireIsolatedTestDb();

type AnyRecord = Record<string, unknown>;

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { processWorkforceJobSlice, WORKFORCE_MAX_ATTEMPTS } = await import(
    "../processor"
  );
  const { WORKFORCE_JOB_RUN_TYPE, WORKFORCE_ACTIVE_STATUSES } = await import(
    "../constants"
  );
  const { applyWorkforceTaskSpecs } = await import("../task-contract");
  const { parseWorkforceHandoff, extractHandoffFromStepOutput } = await import(
    "../handoff"
  );
  const { persistPlanAndSteps } = await import("@/lib/agent-runtime-v2/persist");
  const { executeRuntimeV2Round } = await import(
    "@/lib/agent-runtime-v2/executor"
  );
  const { claimRunLease, createRunFence } = await import(
    "@/lib/agent-runtime/lease"
  );
  type PlannerOutput = import("@/lib/agent-runtime-v2/schemas").PlannerOutput;

  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_EMAIL_CLIENT_ID;

  console.log("Phase 2B-2 — CAS Claim / Approval / Stale Lease 集成测试");
  const fx = await seedWorkforceFixture("p2b2cl");

  function planOf(steps: Array<AnyRecord>): PlannerOutput {
    return {
      objective: "Phase 2B-2 认领语义测试计划",
      summary: "Phase 2B-2 认领语义测试计划",
      assumptions: [],
      missingInformation: [],
      needsClarification: false,
      completionCriteria: [
        { id: "c1", description: "全部步骤完成", verificationType: "tool_result" },
      ],
      steps,
    } as unknown as PlannerOutput;
  }

  function readStep(id: string, tool: string, extra: AnyRecord = {}): AnyRecord {
    return {
      id,
      title: `步骤 ${id}`,
      description: `执行 ${id}`,
      dependsOn: [],
      preferredTool: tool,
      executionMode: "read",
      riskLevel: "LOW",
      requiresApproval: false,
      expectedOutput: `${id} 产出`,
      ...extra,
    };
  }

  async function kick(runId: string) {
    await db.agentRun.update({
      where: { id: runId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
  }

  async function createJobWithPlan(goal: string, steps: Array<AnyRecord>) {
    const job = await createWorkforceJob({
      workDomain: "sales",
      orgId: fx.orgId,
      userId: fx.ownerUserId,
      role: "sales",
      goal,
    });
    if (!job.ok) throw new Error(`createWorkforceJob failed: ${job.error}`);
    const adapted = applyWorkforceTaskSpecs(planOf(steps));
    if (!adapted.ok) throw new Error(`applyWorkforceTaskSpecs: ${adapted.error}`);
    await persistPlanAndSteps({
      orgId: fx.orgId,
      runId: job.runId,
      plan: adapted.plan,
    });
    await db.agentRun.update({
      where: { id: job.runId },
      data: { status: "queued", nextAttemptAt: new Date(Date.now() - 1000) },
    });
    return job.runId;
  }

  async function eventsOf(runId: string, type: string) {
    return db.agentRunEvent.findMany({
      where: { runId, eventType: type },
      orderBy: { sequence: "asc" },
    });
  }

  let probe: DbProbe | null = null;
  function armProbe(rules: ProbeRule[]) {
    probe?.restore();
    probe = installDbProbe(
      db as unknown as Record<string, unknown>,
      fx.orgId,
      rules,
    );
    return probe;
  }

  // ════════════════════════════════════════════════════════════════════
  // P5（§29）：审批任务单独执行；PendingAction 后 Job awaiting_approval；
  // 无新 parallel batch
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P5 审批任务独占]");
  process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = "3";
  {
    armProbe([]);
    const runId = await createJobWithPlan("P5 审批独占计划", [
      readStep("s5_prioritize", "sales_get_pipeline"),
      readStep("task_b", "sales_get_pipeline"),
      readStep("task_e", "grader_create_followup_task", {
        dependsOn: ["s5_prioritize", "task_b"],
        executionMode: "write",
        riskLevel: "HIGH",
        requiresApproval: true,
        description: "为优先客户创建跟进任务草稿（须审批）",
      }),
    ]);
    // slice 1（单轮）：SAFE 上游并行批 [s5_prioritize, task_b]
    await processWorkforceJobSlice(runId, { maxRounds: 1 });
    const started1 = await eventsOf(runId, "parallel.batch_started");
    ok(
      started1.length === 1 &&
        JSON.stringify(metaOf(started1[0].payload).stepKeys) ===
          JSON.stringify(["s5_prioritize", "task_b"]) &&
        !(metaOf(started1[0].payload).stepKeys as string[]).includes("task_e"),
      "P5/§20: 审批任务不与 SAFE 任务同批启动（batch=[s5,b]）",
    );

    // 为审批工具注入优先客户证据（保留 workforceHandoff 信封不动）
    const s5 = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "s5_prioritize" },
    });
    ok(s5.status === "completed", "P5: 上游并行批完成");
    await db.agentRunStep.update({
      where: { id: s5.id },
      data: {
        outputJson: JSON.parse(
          JSON.stringify({
            ...(metaOf(s5.outputJson) as AnyRecord),
            prioritized: [
              { customerId: `cust_${fx.tag}`, customerName: "P5 优先客户" },
            ],
          }),
        ),
      },
    });

    // slice 2：审批任务单独成批执行 → 真实 PendingAction → awaiting_approval
    await kick(runId);
    const slice2 = await processWorkforceJobSlice(runId, { maxRounds: 6 });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const e = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_e" },
    });
    ok(
      slice2.claimed === true &&
        slice2.status === "awaiting_approval" &&
        run.status === "awaiting_approval",
      "P5/§29: PendingAction 产生后 Job → awaiting_approval（2C-1 链路）",
      { slice: slice2.status, run: run.status },
    );
    ok(
      e.status === "awaiting_approval" && typeof e.pendingActionId === "string",
      "P5: 审批 Task awaiting_approval + pendingActionId 挂接",
    );
    const pendingIds =
      (e.evidenceJson as { pendingActionIds?: string[] } | null)
        ?.pendingActionIds ?? [];
    const pendingRows = await db.pendingAction.findMany({
      where: { id: { in: pendingIds }, orgId: fx.orgId },
    });
    ok(
      pendingIds.length >= 1 &&
        pendingRows.length === pendingIds.length &&
        pendingRows.every((p) => p.status === "pending"),
      "P5: 真实 PendingAction 落库且 pending（Human Intervention 挂接点）",
    );
    ok(
      extractHandoffFromStepOutput(e.outputJson) === undefined,
      "P5/§33(2B-1): awaiting_approval 期间无最终 Handoff",
    );
    const claimedE = (await eventsOf(runId, "task.claimed")).filter(
      (ev) => metaOf(ev.payload).stepKey === "task_e",
    );
    ok(
      claimedE.length === 1 &&
        metaOf(claimedE[0].payload).policy === "REQUIRES_APPROVAL",
      "P5: 审批任务经 CAS 认领且 policy=REQUIRES_APPROVAL",
    );
    const started2 = await eventsOf(runId, "parallel.batch_started");
    ok(
      started2.length === 1,
      "P5: 审批轮次无 parallel.batch_started（单任务批）",
    );

    // awaiting 期间不允许任何新 batch / 新认领
    await kick(runId);
    const slice3 = await processWorkforceJobSlice(runId, { maxRounds: 3 });
    const started3 = await eventsOf(runId, "parallel.batch_started");
    const claimedAll = await eventsOf(runId, "task.claimed");
    ok(
      slice3.claimed === false &&
        started3.length === 1 &&
        claimedAll.length === 3,
      "P5/§29: awaiting_approval 期间没有新 parallel batch / 新认领",
      { slice3 },
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // P6（§30）：double driver —— 同一 ready Task 恰好一个 driver 执行
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P6 double driver]");
  process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = "1";
  {
    const p = armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "sleep", ms: 300 } },
    ]);
    const runId = await createJobWithPlan("P6 双 driver 计划", [
      readStep("task_a", "sales_get_pipeline"),
    ]);
    // 两个 executor 同时看到 Task X = ready（production default 并行度=1
    // 下 CAS 仍必须生效——这是 §12 的核心安全点）
    const [r1, r2] = await Promise.all([
      executeRuntimeV2Round({
        orgId: fx.orgId,
        runId,
        userId: fx.ownerUserId,
        role: "sales",
      }),
      executeRuntimeV2Round({
        orgId: fx.orgId,
        runId,
        userId: fx.ownerUserId,
        role: "sales",
      }),
    ]);
    const a = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    ok(
      a.status === "completed" && a.attemptCount === 1,
      "P6/§30: exactly one claims & executes（attemptCount=1）",
      { status: a.status, attempts: a.attemptCount, r1: r1.status, r2: r2.status },
    );
    ok(p.calls() === 1, "P6/§30: Tool side effect count = 1", p.calls());
    const claimed = await eventsOf(runId, "task.claimed");
    const startedEv = await eventsOf(runId, "step.started");
    ok(
      claimed.length === 1 && startedEv.length === 1,
      "P6: 恰好一次 task.claimed / step.started（TASK_ALREADY_CLAIMED 不执行）",
      { claimed: claimed.length, started: startedEv.length },
    );
    const handoff = parseWorkforceHandoff(
      extractHandoffFromStepOutput(a.outputJson),
    );
    ok(
      handoff.ok && handoff.payload.source.stepKey === "task_a",
      "P6: 唯一执行产出唯一合法 Handoff",
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // P7（§31）：stale lease —— A 认领后租约易主，B reclaim 完成任务；
  // A 迟到写入 LOST_LEASE，零 stale result / 零 stale Handoff
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P7 stale lease]");
  {
    const gate = createGate();
    armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "gate", gate } },
    ]);
    const runId = await createJobWithPlan("P7 过期租约计划", [
      readStep("task_a", "sales_get_pipeline"),
    ]);
    const claimA = await claimRunLease({
      runId,
      allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
      leaseMs: 60_000,
      maxAttempts: WORKFORCE_MAX_ATTEMPTS,
      reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
    });
    ok(claimA.ok, "P7: Worker A 认领 run lease");
    if (!claimA.ok) return finish();
    const fenceA = createRunFence({ lease: claimA.lease });

    // A 开始执行 batch：CAS 认领 task_a 后阻塞在工具调用中（gate）
    const driverA = executeRuntimeV2Round({
      orgId: fx.orgId,
      runId,
      userId: fx.ownerUserId,
      role: "sales",
      fence: fenceA,
    });
    let claimedByA = false;
    for (let i = 0; i < 100; i++) {
      const row = await db.agentRunStep.findFirstOrThrow({
        where: { runId, stepKey: "task_a" },
      });
      if (row.status === "running") {
        claimedByA = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    ok(claimedByA, "P7: A 已 CAS 认领 task_a（running），阻塞在 tool 中");

    // 租约易主：A 过期 → B 经 processor reclaim（Final Gate §4：
    // stale-running recovery 的唯一边界 = processor 成功持锁之后；
    // B 的调用不再经过探针拦截）
    probe?.restore();
    probe = null;
    await db.agentRun.update({
      where: { id: runId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const sliceB = await processWorkforceJobSlice(runId, { maxRounds: 6 });
    const afterB = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    ok(
      sliceB.claimed === true &&
        afterB.status === "completed" &&
        afterB.attemptCount === 2,
      "P7: B processor reclaim → recovery(running→ready) → 重新 CAS 并完成（attempt=2）",
      { slice: sliceB.status, status: afterB.status, attempts: afterB.attemptCount },
    );
    const handoffAfterB = JSON.stringify(
      extractHandoffFromStepOutput(afterB.outputJson),
    );

    // 释放 A 的工具调用 → A 迟到写入必须被 fence 阻断
    gate.open();
    const roundA = await driverA;
    ok(
      roundA.status === "lost_lease",
      "P7/§31: A 迟到写入 → LOST_LEASE（本 worker 零状态写入）",
      roundA.status,
    );
    const afterA = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    ok(
      afterA.status === "completed" &&
        afterA.attemptCount === 2 &&
        afterA.completedAt?.getTime() === afterB.completedAt?.getTime() &&
        JSON.stringify(extractHandoffFromStepOutput(afterA.outputJson)) ===
          handoffAfterB,
      "P7/§31: zero stale result / zero stale Handoff（B 的 durable 结果未被覆盖）",
    );
    const completedEvents = await eventsOf(runId, "step.completed");
    ok(
      completedEvents.filter((e) => metaOf(e.payload).stepKey === "task_a")
        .length === 1,
      "P7: step.completed 恰好一次（无重复 Handoff 生成）",
    );
    const claimedEvents = await eventsOf(runId, "task.claimed");
    ok(
      claimedEvents.length === 2,
      "P7: 认领审计完整（A 认领 + B stale-reset 后重新认领）",
      claimedEvents.length,
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // §22：kill-switch 在 executor 层即时生效
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[§22 kill-switch]");
  {
    armProbe([]);
    const runId = await createJobWithPlan("KS 并行开关计划", [
      readStep("task_a", "sales_get_pipeline"),
      readStep("task_b", "sales_get_pipeline"),
    ]);
    const prev = process.env.WORKFORCE_RUNTIME_ENABLED;
    process.env.WORKFORCE_RUNTIME_ENABLED = "0";
    const sweep = await processWorkforceJobSlice(runId, { maxRounds: 2 });
    const round = await executeRuntimeV2Round({
      orgId: fx.orgId,
      runId,
      userId: fx.ownerUserId,
      role: "sales",
    });
    const rows = await db.agentRunStep.findMany({ where: { runId } });
    const claimed = await eventsOf(runId, "task.claimed");
    const batches = await eventsOf(runId, "parallel.batch_started");
    ok(
      sweep.claimed === false &&
        round.status === "continued" &&
        rows.every(
          (s) =>
            s.status === "ready" &&
            s.attemptCount === 0 &&
            extractHandoffFromStepOutput(s.outputJson) === undefined,
        ) &&
        claimed.length === 0 &&
        batches.length === 0,
      "§22: 开关关闭 → NO batch selection / NO Step claim / NO parallel work / NO Handoff",
      { sweep: sweep.claimed, round: round.status },
    );
    process.env.WORKFORCE_RUNTIME_ENABLED = prev ?? "1";
    await kick(runId);
    await processWorkforceJobSlice(runId, { maxRounds: 6 });
    const rowsAfter = await db.agentRunStep.findMany({ where: { runId } });
    ok(
      rowsAfter.every((s) => s.status === "completed"),
      "§22: 开关恢复后正常执行（job 原状保留、不失败）",
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // §23：cancellation —— 已取消 Job 不启动新 Task
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[§23 cancellation]");
  {
    armProbe([]);
    const runId = await createJobWithPlan("取消后不启动计划", [
      readStep("task_a", "sales_get_pipeline"),
    ]);
    await db.agentRun.update({
      where: { id: runId },
      data: { status: "cancelled", nextAttemptAt: null, leaseExpiresAt: null },
    });
    const slice = await processWorkforceJobSlice(runId, { maxRounds: 2 });
    const round = await executeRuntimeV2Round({
      orgId: fx.orgId,
      runId,
      userId: fx.ownerUserId,
      role: "sales",
    });
    const a = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    const claimed = await eventsOf(runId, "task.claimed");
    ok(
      slice.claimed === false &&
        round.status === "cancelled" &&
        a.status === "ready" &&
        a.attemptCount === 0 &&
        claimed.length === 0,
      "§23: cancelled Job 不认领、不启动新 Task、无 CAS claim",
      { slice: slice.claimed, round: round.status },
    );
  }

  probe?.restore();
  delete process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS;

  // ── Test Isolation（#86 契约）：fixture ownership cleanup + 零泄漏 ──
  const { residue } = await cleanupWorkforceFixture(fx);
  ok(
    await assertNoLeakedWorkforceJobs(fx),
    "IS: cleanup 后 fixture org 零 workforce job 泄漏",
    residue,
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
