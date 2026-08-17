/**
 * Phase 2B-1 — Task/Worker/Handoff DB 集成测试
 *
 * 覆盖任务书 §41（Task persistence）、§43（Normal Handoff A→B）、
 * §44（Multi-upstream Synthesis）、§45（Unknown version fail-closed）、
 * §47（Stale worker handoff write 被 fence 阻断）、§48（Duplicate completed
 * task）、§50（Kill-switch 回归）、§51（Legacy runtime_v2 不受影响）。
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *       npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  ok,
  finish,
  GOLDEN_GOAL,
  metaOf,
} from "./helpers";

requireIsolatedTestDb();

type AnyRecord = Record<string, unknown>;

function planOf(steps: Array<AnyRecord>): AnyRecord {
  return {
    objective: "Phase 2B-1 集成测试计划",
    summary: "Phase 2B-1 集成测试计划",
    assumptions: [],
    missingInformation: [],
    needsClarification: false,
    completionCriteria: [
      { id: "c1", description: "全部步骤完成", verificationType: "tool_result" },
    ],
    steps,
  };
}

function readStep(
  id: string,
  tool: string,
  extra: AnyRecord = {},
): AnyRecord {
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

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const {
    processWorkforceJobSlice,
    processQueuedWorkforceJobs,
    WORKFORCE_MAX_ATTEMPTS,
  } = await import("../processor");
  const { WORKFORCE_JOB_RUN_TYPE, WORKFORCE_ACTIVE_STATUSES } = await import(
    "../constants"
  );
  const {
    applyWorkforceTaskSpecs,
    readWorkforceTaskSpec,
    WORKFORCE_TASK_CONTRACT_WRITE_VERSION,
  } = await import("../task-contract");
  const {
    parseWorkforceHandoff,
    extractHandoffFromStepOutput,
    WORKFORCE_HANDOFF_CONTRACT_VERSION,
  } = await import("../handoff");
  const { persistPlanAndSteps } = await import(
    "@/lib/agent-runtime-v2/persist"
  );
  const { buildFinalReport } = await import("@/lib/agent-runtime-v2/process");
  const { claimRunLease } = await import("@/lib/agent-runtime/lease");
  const { createRunFence, LostLeaseError } = await import(
    "@/lib/agent-runtime/lease"
  );
  const { executeRuntimeV2Round } = await import(
    "@/lib/agent-runtime-v2/executor"
  );
  type PlannerOutput = import("@/lib/agent-runtime-v2/schemas").PlannerOutput;

  // 确定性：不用真实模型（golden 模板 + grader fallback + verifier 确定性路径）
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_EMAIL_CLIENT_ID;

  console.log("Phase 2B-1 — Task/Worker/Handoff DB 集成测试");
  const fx = await seedWorkforceFixture("p2b1");

  async function kick(runId: string) {
    await db.agentRun.update({
      where: { id: runId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
  }

  /** 自定义计划走 server 管线：applyWorkforceTaskSpecs → persistPlanAndSteps */
  async function createJobWithPlan(goal: string, steps: Array<AnyRecord>) {
    const job = await createWorkforceJob({
      workDomain: "sales",
      orgId: fx.orgId,
      userId: fx.ownerUserId,
      role: "sales",
      goal,
    });
    if (!job.ok) throw new Error(`createWorkforceJob failed: ${job.error}`);
    const adapted = applyWorkforceTaskSpecs(planOf(steps) as unknown as PlannerOutput);
    if (!adapted.ok) throw new Error(`applyWorkforceTaskSpecs: ${adapted.error}`);
    await persistPlanAndSteps({
      orgId: fx.orgId,
      runId: job.runId,
      plan: adapted.plan,
    });
    // persist 将 status 置为 planned；回到 queued 以便 durable claim
    await db.agentRun.update({
      where: { id: job.runId },
      data: { status: "queued", nextAttemptAt: new Date(Date.now() - 1000) },
    });
    return job.runId;
  }

  async function driveUntil(
    runId: string,
    done: (status: string) => boolean,
    maxSlices = 8,
  ): Promise<string> {
    for (let i = 0; i < maxSlices; i++) {
      const row = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
      if (done(row.status)) return row.status;
      await kick(runId);
      await processWorkforceJobSlice(runId, { maxRounds: 6 });
    }
    const last = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    return last.status;
  }

  // ══ §41 Task persistence（golden 计划 → spec 持久化）══
  console.log("\n[§41 Task persistence]");
  const golden = await createWorkforceJob({
    workDomain: "sales",
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!golden.ok) throw new Error("golden createWorkforceJob failed");
  const goldenRunId = golden.runId;
  await kick(goldenRunId);
  await processWorkforceJobSlice(goldenRunId, { maxRounds: 0 });

  const goldenRun = await db.agentRun.findUniqueOrThrow({
    where: { id: goldenRunId },
  });
  const goldenSteps = await db.agentRunStep.findMany({
    where: { runId: goldenRunId },
    orderBy: { createdAt: "asc" },
  });
  ok(goldenSteps.length === 8, "41: golden 计划 8 个 AgentRunStep（Task=Step）");
  const specReads = goldenSteps.map((s) => readWorkforceTaskSpec(s.inputJson));
  ok(
    specReads.every((r) => r.kind === "valid"),
    "41: 每个 Task 持久化可读的 workforceTask spec",
  );
  // T5-P0B 起 writer 一律写 v1.1；reader 仍兼容库中既有 v1
  //（版本兼容矩阵由 phase2b1-contracts.test.ts 在纯函数层覆盖，此处不重复）。
  // 断言 WRITE 常量而非字面量：版本 bump 时此处自动跟随，
  // 不会像 T5-P0B 那样在集成层留下一条过期的字面量断言。
  ok(
    specReads.every(
      (r) =>
        r.kind === "valid" &&
        r.spec.contractVersion === WORKFORCE_TASK_CONTRACT_WRITE_VERSION &&
        r.spec.worker.workerKey === "sales_worker" &&
        r.spec.worker.role === "sales_specialist" &&
        r.spec.taskKind === "work",
    ),
    "41: worker assignment + taskKind persisted（server 默认指派，写当前 write 版本）",
  );
  const s5row = goldenSteps.find((s) => s.stepKey === "s5_prioritize");
  // P0 #89：模板补全真实依赖声明（s5 实际消费商机列表 + 两类分析证据）
  ok(
    JSON.stringify(s5row?.dependsOnJson) ===
      JSON.stringify([
        "s2_opportunities",
        "s3_followup_analysis",
        "s4_quote_risk",
      ]),
    "41: dependency persisted（dependsOnJson 声明序）",
  );
  ok(
    goldenRun.runType === WORKFORCE_JOB_RUN_TYPE &&
      metaOf(goldenRun.metadata).jobId === goldenRunId,
    "41: Job 仍是 root AgentRun（runType=workforce_job, jobId=runId）",
  );
  const childRuns = await db.agentRun.count({
    where: { parentRunId: goldenRunId },
  });
  ok(childRuns === 0, "41: 没有为 Task 创建 child AgentRun（CHILD_RUN_PER_TASK=NO）");

  // ══ §43 Normal Handoff（golden 驱动：A→B 链）══
  console.log("\n[§43 Normal handoff A→B]");
  const goldenEnd = await driveUntil(
    goldenRunId,
    (s) =>
      ["awaiting_approval", "needs_human", "completed", "partially_executed", "failed"].includes(
        s,
      ),
    10,
  );
  const goldenAfter = await db.agentRunStep.findMany({
    where: { runId: goldenRunId },
  });
  const byKey = new Map(goldenAfter.map((s) => [s.stepKey, s]));
  const readChain = [
    "s1_pipeline",
    "s2_opportunities",
    "s3_followup_analysis",
    "s4_quote_risk",
    "s5_prioritize",
  ];
  ok(
    readChain.every((k) => byKey.get(k)?.status === "completed"),
    "43: s1..s5 全部 completed",
    readChain.map((k) => `${k}=${byKey.get(k)?.status}`),
  );
  const handoffChecks = readChain.map((k) => {
    const raw = extractHandoffFromStepOutput(byKey.get(k)?.outputJson);
    const parsed = raw !== undefined ? parseWorkforceHandoff(raw) : null;
    return (
      parsed?.ok === true &&
      parsed.payload.source.runId === goldenRunId &&
      parsed.payload.source.stepKey === k &&
      parsed.payload.source.workerKey === "sales_worker"
    );
  });
  ok(
    handoffChecks.every(Boolean),
    "43: 每个 completed Task 产出合法 V1 Handoff（server 注入 source）",
  );
  const s1out = metaOf(byKey.get("s1_pipeline")?.outputJson);
  ok(
    "opportunityCount" in s1out && "workforceHandoff" in s1out,
    "43: 原业务 output 保留，Handoff 为 namespaced 附加（不覆盖 step result）",
  );
  const s1handoff = parseWorkforceHandoff(
    extractHandoffFromStepOutput(byKey.get("s1_pipeline")?.outputJson),
  );
  ok(
    s1handoff.ok &&
      s1handoff.payload.createdAt ===
        byKey.get("s1_pipeline")?.completedAt?.toISOString(),
    "43: Handoff.createdAt = Step durable completedAt",
  );
  const events = await db.agentRunEvent.findMany({
    where: { runId: goldenRunId, eventType: "step.started" },
    orderBy: { sequence: "asc" },
  });
  const startedPayloads = new Map(
    events.map((e) => [metaOf(e.payload).stepKey as string, metaOf(e.payload)]),
  );
  ok(
    JSON.stringify(startedPayloads.get("s2_opportunities")?.upstreamStepKeys) ===
      JSON.stringify(["s1_pipeline"]),
    "43: Task B 启动时收到 Task A 的 validated handoff 上下文（upstreamStepKeys）",
  );
  ok(
    JSON.stringify(startedPayloads.get("s5_prioritize")?.upstreamStepKeys) ===
      JSON.stringify([
        "s2_opportunities",
        "s3_followup_analysis",
        "s4_quote_risk",
      ]) &&
      startedPayloads.get("s5_prioritize")?.workerKey === "sales_worker",
    "43/§24: 多上游按 dependsOn 声明序 deterministic 注入",
  );
  const completedEvents = await db.agentRunEvent.findMany({
    where: { runId: goldenRunId, eventType: "step.completed" },
  });
  ok(
    completedEvents.some(
      (e) =>
        metaOf(e.payload).stepKey === "s5_prioritize" &&
        metaOf(e.payload).handoffVersion === WORKFORCE_HANDOFF_CONTRACT_VERSION &&
        metaOf(e.payload).workerKey === "sales_worker",
    ),
    "43/§37: step.completed 事件携带 workerKey/taskKind/handoffVersion",
  );
  ok(
    ["awaiting_approval", "needs_human", "completed", "partially_executed"].includes(goldenEnd),
    "43: golden Job 到达明确定义状态（写步骤空数据环境下 skipped/failed 交 verifier）",
    goldenEnd,
  );

  // ══ §44 Multi-upstream Synthesis（A/B/C → S，声明序 C,A,B）══
  console.log("\n[§44 Multi-upstream synthesis]");
  const synthRunId = await createJobWithPlan("多任务汇总集成测试计划", [
    readStep("task_a", "sales_get_pipeline"),
    readStep("task_b", "sales_list_opportunities"),
    readStep("task_c", "sales_get_pipeline"),
    readStep("task_s", "sales_get_pipeline", {
      dependsOn: ["task_c", "task_a", "task_b"],
      workerKey: "synthesis_worker",
      taskKind: "synthesis",
      title: "综合汇总",
      description: "合并 A/B/C 的结构化 Handoff 产出综合结论",
    }),
  ]);
  const synthEnd = await driveUntil(synthRunId, (s) =>
    ["completed", "partially_executed", "failed", "needs_human"].includes(s),
  );
  ok(synthEnd === "completed", "44: Job 顺序执行后 completed", synthEnd);
  const synthSteps = await db.agentRunStep.findMany({
    where: { runId: synthRunId },
  });
  const sMap = new Map(synthSteps.map((s) => [s.stepKey, s]));
  ok(
    ["task_a", "task_b", "task_c", "task_s"].every(
      (k) => sMap.get(k)?.status === "completed",
    ),
    "44: A/B/C/S 全部 completed（sequential，一次一个）",
  );
  const sHandoff = parseWorkforceHandoff(
    extractHandoffFromStepOutput(sMap.get("task_s")?.outputJson),
  );
  ok(
    sHandoff.ok && sHandoff.payload.source.workerKey === "synthesis_worker",
    "44/§26: Synthesis Task 由 server-validated synthesis worker 执行",
  );
  if (sHandoff.ok) {
    const ups = (sHandoff.payload.outputs?.upstreamSummaries ?? []) as Array<{
      stepKey: string;
      workerKey: string;
      summary: string;
    }>;
    ok(
      ups.map((u) => u.stepKey).join(",") === "task_c,task_a,task_b",
      "44/§24: Synthesis 收到 3 个上游 Handoff，顺序=声明序 C,A,B",
      ups.map((u) => u.stepKey),
    );
    ok(
      ups.every((u) => u.summary.length > 0 && u.workerKey === "sales_worker"),
      "44: 上游摘要来自 validated handoff（含 workerKey）",
    );
  }
  const synthReport = await buildFinalReport(fx.orgId, synthRunId);
  ok(
    synthReport.includes("综合结论") && synthReport.includes("task_s"),
    "44/§28: Synthesis Handoff 进入最终 Job report（复用现有 final report）",
  );

  // ══ §45 Unknown version fail-closed ══
  console.log("\n[§45 Unknown handoff version]");
  const uvRunId = await createJobWithPlan("未知版本上游拒绝执行计划", [
    readStep("task_a", "sales_get_pipeline"),
    readStep("task_b", "sales_list_opportunities", { dependsOn: ["task_a"] }),
  ]);
  await processWorkforceJobSlice(uvRunId, { maxRounds: 1 });
  const uvA = await db.agentRunStep.findFirstOrThrow({
    where: { runId: uvRunId, stepKey: "task_a" },
  });
  ok(uvA.status === "completed", "45: 上游 A 先正常完成");
  await db.agentRunStep.update({
    where: { id: uvA.id },
    data: {
      outputJson: JSON.parse(
        JSON.stringify({
          ...(metaOf(uvA.outputJson) as AnyRecord),
          workforceHandoff: { contractVersion: "workforce-handoff/v999" },
        }),
      ),
    },
  });
  await kick(uvRunId);
  await processWorkforceJobSlice(uvRunId, { maxRounds: 2 });
  const uvRun = await db.agentRun.findUniqueOrThrow({ where: { id: uvRunId } });
  const uvB = await db.agentRunStep.findFirstOrThrow({
    where: { runId: uvRunId, stepKey: "task_b" },
  });
  ok(
    uvB.status === "failed" && uvB.errorCode === "HANDOFF_VERSION_UNSUPPORTED",
    "45: 下游 fail-closed（HANDOFF_VERSION_UNSUPPORTED）",
    { status: uvB.status, code: uvB.errorCode },
  );
  ok(
    uvB.attemptCount === 0 && uvB.outputJson === null,
    "45: 下游未以 raw data 执行（无工具调用、无输出）",
  );
  ok(
    uvRun.status === "needs_human" &&
      uvRun.errorCode === "HANDOFF_VERSION_UNSUPPORTED",
    "45: Job 转 needs_human（fail-closed 语义）",
  );

  // ══ §48 Duplicate completed task ══
  console.log("\n[§48 Duplicate completed task]");
  const dupRunId = await createJobWithPlan("重复执行防护验证计划", [
    readStep("task_a", "sales_get_pipeline"),
    readStep("task_b", "sales_list_opportunities", { dependsOn: ["task_a"] }),
  ]);
  await processWorkforceJobSlice(dupRunId, { maxRounds: 1 });
  const dupA1 = await db.agentRunStep.findFirstOrThrow({
    where: { runId: dupRunId, stepKey: "task_a" },
  });
  ok(dupA1.status === "completed" && dupA1.attemptCount === 1, "48: A 完成（attempt=1）");
  const handoffBefore = JSON.stringify(
    extractHandoffFromStepOutput(dupA1.outputJson),
  );
  // 模拟 retry / continuation / resume：Job 回队后继续消费
  const dupEnd = await driveUntil(dupRunId, (s) =>
    ["completed", "partially_executed", "failed", "needs_human"].includes(s),
  );
  const dupA2 = await db.agentRunStep.findFirstOrThrow({
    where: { runId: dupRunId, stepKey: "task_a" },
  });
  ok(
    dupA2.attemptCount === 1 &&
      dupA2.completedAt?.getTime() === dupA1.completedAt?.getTime(),
    "48: continuation/resume 后 A 未被重新执行（attempt/completedAt 不变）",
  );
  ok(
    JSON.stringify(extractHandoffFromStepOutput(dupA2.outputJson)) ===
      handoffBefore,
    "48: Handoff 未变（semantically identical，无重复生成）",
  );
  ok(dupEnd === "completed", "48: Job 正常走完（B 执行一次）", dupEnd);

  // ══ §47 Stale worker handoff write 被 fence 阻断 ══
  console.log("\n[§47 Stale worker fencing]");
  const staleRunId = await createJobWithPlan("过期租约信封写入阻断计划", [
    readStep("task_a", "sales_get_pipeline"),
    readStep("task_b", "sales_list_opportunities", { dependsOn: ["task_a"] }),
  ]);
  await processWorkforceJobSlice(staleRunId, { maxRounds: 1 });
  await kick(staleRunId);
  const claimA = await claimRunLease({
    runId: staleRunId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(claimA.ok, "47: Worker A 认领成功");
  if (!claimA.ok) return finish();
  const fenceA = createRunFence({ lease: claimA.lease });
  // 租约到期 → Worker B reclaim
  await db.agentRun.update({
    where: { id: staleRunId },
    data: { leaseExpiresAt: new Date(Date.now() - 1000) },
  });
  const claimB = await claimRunLease({
    runId: staleRunId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs: 60_000,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES],
  });
  ok(claimB.ok, "47: Worker B reclaim 成功（租约易主）");
  const bBefore = await db.agentRunStep.findFirstOrThrow({
    where: { runId: staleRunId, stepKey: "task_b" },
  });
  let staleBlocked = false;
  try {
    await fenceA.guard((tx) =>
      tx.agentRunStep.updateMany({
        where: { runId: staleRunId, stepKey: "task_b" },
        data: {
          status: "completed",
          outputJson: JSON.parse(
            JSON.stringify({
              workforceHandoff: {
                contractVersion: WORKFORCE_HANDOFF_CONTRACT_VERSION,
                source: {
                  runId: staleRunId,
                  stepKey: "task_b",
                  workerKey: "sales_worker",
                },
                summary: "stale worker 伪造结果",
                createdAt: new Date().toISOString(),
              },
            }),
          ),
        },
      }),
    );
  } catch (e) {
    staleBlocked = e instanceof LostLeaseError;
  }
  ok(staleBlocked, "47: A 的 Step result + Handoff 持久化 → LOST_LEASE");
  const bAfter = await db.agentRunStep.findFirstOrThrow({
    where: { runId: staleRunId, stepKey: "task_b" },
  });
  ok(
    bAfter.status === bBefore.status && bAfter.outputJson === null,
    "47: 无 stale Handoff 写入（row 未变）",
    { status: bAfter.status },
  );
  const staleRound = await executeRuntimeV2Round({
    orgId: fx.orgId,
    runId: staleRunId,
    userId: fx.ownerUserId,
    role: "sales",
    fence: fenceA,
  });
  ok(
    staleRound.status === "lost_lease",
    "47: A 带 stale fence 的完整 V2 round → lost_lease（零写入）",
    staleRound.status,
  );

  // ══ §50 Kill-switch 回归 ══
  console.log("\n[§50 Kill-switch]");
  const ksRunId = await createJobWithPlan("开关关闭不执行计划", [
    readStep("task_a", "sales_get_pipeline"),
  ]);
  const prevFlag = process.env.WORKFORCE_RUNTIME_ENABLED;
  process.env.WORKFORCE_RUNTIME_ENABLED = "0";
  const ksSweep = await processQueuedWorkforceJobs(5);
  const ksSlice = await processWorkforceJobSlice(ksRunId, { maxRounds: 2 });
  const ksA = await db.agentRunStep.findFirstOrThrow({
    where: { runId: ksRunId, stepKey: "task_a" },
  });
  ok(
    ksSweep.processed === 0 &&
      ksSweep.runIds.length === 0 &&
      ksSlice.claimed === false,
    "50: 开关关闭 → 不 claim / 不消费",
  );
  ok(
    ksA.status === "ready" &&
      ksA.attemptCount === 0 &&
      extractHandoffFromStepOutput(ksA.outputJson) === undefined,
    "50: ready Task 未执行、无 Handoff 生成",
  );
  process.env.WORKFORCE_RUNTIME_ENABLED = prevFlag ?? "1";
  await kick(ksRunId);
  const ksResume = await processWorkforceJobSlice(ksRunId, { maxRounds: 1 });
  const ksA2 = await db.agentRunStep.findFirstOrThrow({
    where: { runId: ksRunId, stepKey: "task_a" },
  });
  ok(
    ksResume.claimed === true && ksA2.status === "completed",
    "50: 开关恢复后正常执行（不失败、不清理）",
  );

  // ══ §51 Legacy runtime_v2 不受 Workforce 契约影响 ══
  console.log("\n[§51 Legacy runtime_v2]");
  process.env.AGENT_RUNTIME_V2_ENABLED = "1";
  process.env.AGENT_RUNTIME_V2_USER_ALLOWLIST = fx.ownerUserId;
  const { startAgentRuntimeV2Run } = await import(
    "@/lib/agent-runtime-v2/process"
  );
  const legacy = await startAgentRuntimeV2Run({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  ok(legacy.ok, "51: legacy runtime_v2 启动成功");
  if (legacy.ok) {
    const legacyRun = await db.agentRun.findUniqueOrThrow({
      where: { id: legacy.runId },
    });
    const legacySteps = await db.agentRunStep.findMany({
      where: { runId: legacy.runId },
    });
    ok(legacyRun.runType === "runtime_v2", "51: runType=runtime_v2");
    ok(
      legacySteps.every(
        (s) => readWorkforceTaskSpec(s.inputJson).kind === "absent",
      ),
      "51: legacy Step 不要求 workerKey / 无 workforceTask spec",
    );
    ok(
      legacySteps.every(
        (s) => extractHandoffFromStepOutput(s.outputJson) === undefined,
      ),
      "51: legacy Step 不生成 workforceHandoff",
    );
    ok(
      legacySteps.every(
        (s) =>
          s.errorCode !== "workforce_worker_invalid" &&
          s.errorCode !== "workforce_task_invalid" &&
          s.errorCode !== "HANDOFF_VERSION_UNSUPPORTED",
      ),
      "51: legacy 执行未触发任何 workforce 契约 gate",
    );
    const legacyCompleted = legacySteps.filter((s) => s.status === "completed");
    ok(legacyCompleted.length >= 5, "51: legacy 黄金链 s1..s5 照常执行", legacyCompleted.length);
  }

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
