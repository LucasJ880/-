/**
 * Phase 2B-2 — Final Integration Gate DB 集成测试（#93 × #94 P0）
 *
 * 覆盖 Final Gate 任务书：
 * §2  Native Synthesis × Parallel：A/B/C 并行（完成序 C→A→B）→ S
 *     （taskKind=synthesis，无 preferredTool）→ 消费序恒 A,B,C、
 *     真实结构化综合、workforce-handoff/v1、绝无 no_tool；
 * §3  SECRET_X 证据隔离（并行不扩大证据作用域）：synthesis 通道（模型
 *     输入仅含声明上游）+ 工具通道（targetSource=recent_fallback，
 *     poison 零出现）；
 * §5  P6b deterministic race：Step 已 running 时第二个 driver 不得
 *     reset / 二次 CAS / 二次执行；
 * §6  全局工具预算：effectiveBatchMax = min(parallelMax, remaining)，
 *     maxToolCalls=10 / used=9 / ready=4 → 恰 1 个新认领，总 attempts ≤ 10；
 * §7  CAS attempt 上限：running Step attemptCount==maxAttempts 且租约
 *     易主 → 终态 failed（stale_running_exhausted），Tool 不再执行。
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

const POISON = "SECRET_POISON_MARKER_2B2";

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { processWorkforceJobSlice } = await import("../processor");
  const { applyWorkforceTaskSpecs } = await import("../task-contract");
  const { parseWorkforceHandoff, extractHandoffFromStepOutput } = await import(
    "../handoff"
  );
  const { setWorkforceSynthesisModelForTests } = await import("../synthesis");
  const { persistPlanAndSteps } = await import("@/lib/agent-runtime-v2/persist");
  const { executeRuntimeV2Round } = await import(
    "@/lib/agent-runtime-v2/executor"
  );
  type PlannerOutput = import("@/lib/agent-runtime-v2/schemas").PlannerOutput;

  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_EMAIL_CLIENT_ID;

  console.log("Phase 2B-2 — Final Integration Gate 集成测试");
  const fx = await seedWorkforceFixture("p2b2fg");

  function planOf(steps: Array<AnyRecord>): PlannerOutput {
    return {
      objective: "Phase 2B-2 Final Gate 测试计划",
      summary: "Phase 2B-2 Final Gate 测试计划",
      assumptions: [],
      missingInformation: [],
      needsClarification: false,
      completionCriteria: [
        { id: "c1", description: "全部步骤完成", verificationType: "tool_result" },
      ],
      steps,
    } as unknown as PlannerOutput;
  }

  function readStep(id: string, tool: string | undefined, extra: AnyRecord = {}): AnyRecord {
    return {
      id,
      title: `步骤 ${id}`,
      description: `执行 ${id}`,
      dependsOn: [],
      ...(tool ? { preferredTool: tool } : {}),
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

  async function eventsOf(runId: string, type: string) {
    return db.agentRunEvent.findMany({
      where: { runId, eventType: type },
      orderBy: { sequence: "asc" },
    });
  }

  async function stepsOf(runId: string) {
    const rows = await db.agentRunStep.findMany({ where: { runId } });
    return new Map(rows.map((s) => [s.stepKey, s]));
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

  const waitStepCompleted = async (runId: string, stepKey: string) => {
    for (let i = 0; i < 240; i++) {
      const row = await db.agentRunStep.findFirst({ where: { runId, stepKey } });
      if (row?.status === "completed") return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  // ════════════════════════════════════════════════════════════════════
  // FG§2：Native Synthesis × Parallel（完成序 C→A→B，消费序恒 A,B,C）
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[FG2 Native Synthesis × Parallel]");
  process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = "3";
  {
    const stubCalls: Array<{ userPrompt: string }> = [];
    setWorkforceSynthesisModelForTests(async ({ userPrompt }) => {
      stubCalls.push({ userPrompt });
      return JSON.stringify({
        summary: "FG2 综合结论：三个上游读取全部完成，管道数据一致。",
        conclusions: ["上游 A/B/C 数据交叉一致", "无阻断性风险"],
        risks: ["数据量较小"],
        evidenceRefs: ["task_a", "task_b", "task_c"],
      });
    });
    const gateA = createGate();
    const gateB = createGate();
    armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "gate", gate: gateA } },
      { model: "salesOpportunity", take: 30, behavior: { kind: "gate", gate: gateB } },
    ]);
    const runId = await createJobWithPlan("FG2 原生综合并行计划", [
      readStep("task_a", "sales_get_pipeline"),
      readStep("task_b", "sales_list_opportunities"),
      readStep("task_c", "sales_quote_risk_analysis"),
      readStep("task_s", undefined, {
        dependsOn: ["task_a", "task_b", "task_c"],
        workerKey: "synthesis_worker",
        taskKind: "synthesis",
        description: "合并 A/B/C 的结构化产出为综合结论",
      }),
    ]);
    const slice1 = processWorkforceJobSlice(runId, { maxRounds: 1 });
    ok(await waitStepCompleted(runId, "task_c"), "FG2: C 最先完成（A/B 被 gate 持有）");
    gateA.open();
    ok(await waitStepCompleted(runId, "task_a"), "FG2: A 第二个完成");
    gateB.open();
    ok(await waitStepCompleted(runId, "task_b"), "FG2: B 最后完成");
    await slice1;
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "FG2: Job completed", end);

    const sMap = await stepsOf(runId);
    const s = sMap.get("task_s");
    const tA = sMap.get("task_a")?.completedAt?.getTime() ?? 0;
    const tB = sMap.get("task_b")?.completedAt?.getTime() ?? 0;
    const tC = sMap.get("task_c")?.completedAt?.getTime() ?? 0;
    ok(tC < tA && tA < tB, "FG2: 完成顺序被协议强制为 C → A → B", { tC, tA, tB });
    ok(
      s?.status === "completed" && s.preferredTool === null,
      "FG2: S completes（无 preferredTool 的 native synthesis）",
      { status: s?.status, tool: s?.preferredTool },
    );
    const allSteps = [...sMap.values()];
    ok(
      allSteps.every((r) => r.errorCode !== "no_tool"),
      "FG2: NO no_tool（native synthesis 语义在并行调度下保持）",
    );
    const sOut = metaOf(s?.outputJson);
    ok(
      typeof sOut.summary === "string" &&
        Array.isArray(sOut.conclusions) &&
        JSON.stringify(sOut.synthesisOf) ===
          JSON.stringify(["task_a", "task_b", "task_c"]),
      "FG2: real structured synthesis（summary/conclusions/synthesisOf 声明序审计）",
    );
    const sHandoff = parseWorkforceHandoff(
      extractHandoffFromStepOutput(s?.outputJson),
    );
    const ups = sHandoff.ok
      ? ((sHandoff.payload.outputs?.upstreamSummaries ?? []) as Array<{
          stepKey: string;
        }>)
      : [];
    ok(
      sHandoff.ok &&
        sHandoff.payload.source.workerKey === "synthesis_worker" &&
        ups.map((u) => u.stepKey).join(",") === "task_a,task_b,task_c",
      "FG2: workforce-handoff/v1 产出，input order = A,B,C（≠ 完成序）",
    );
    ok(stubCalls.length === 1, "FG2: 统一模型出口恰一次（测试接缝）");
    const prompt = stubCalls[0]?.userPrompt ?? "";
    const order = ["task_a", "task_b", "task_c"].map((k) => prompt.indexOf(`"${k}"`));
    ok(
      order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2],
      "FG2: synthesis 模型输入按声明序 A,B,C 注入",
      order,
    );
    const claimedS = (await eventsOf(runId, "task.claimed")).filter(
      (e) => metaOf(e.payload).stepKey === "task_s",
    );
    ok(
      claimedS.length === 1 &&
        metaOf(claimedS[0].payload).policy === "SEQUENTIAL",
      "FG2: native synthesis 经 CAS 认领且策略保守 SEQUENTIAL（单独成批）",
    );
    setWorkforceSynthesisModelForTests(null);
  }

  // ════════════════════════════════════════════════════════════════════
  // FG§3：SECRET_X 证据隔离——并行不扩大证据作用域（双通道观测）
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[FG3 SECRET_X 证据隔离]");
  process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = "3";
  {
    const stubCalls: Array<{ userPrompt: string }> = [];
    setWorkforceSynthesisModelForTests(async ({ userPrompt }) => {
      stubCalls.push({ userPrompt });
      return JSON.stringify({
        summary: "FG3 综合：仅基于声明上游 A/B。",
        conclusions: ["A/B 证据一致"],
      });
    });
    armProbe([]);
    const runId = await createJobWithPlan("FG3 证据隔离计划", [
      readStep("task_a", "sales_get_pipeline"),
      readStep("task_b", "sales_list_opportunities"),
      readStep("secret_x", "sales_get_pipeline"),
      readStep("task_c", "sales_get_customer", {
        dependsOn: ["task_a", "task_b"],
        description: "只依赖 A/B 的客户读取（工具通道观测）",
      }),
      readStep("task_s", undefined, {
        dependsOn: ["task_a", "task_b"],
        workerKey: "synthesis_worker",
        taskKind: "synthesis",
        description: "只依赖 A/B 的综合（synthesis 通道观测）",
      }),
    ]);
    // 轮 1：A/B/SECRET_X 并行批
    await processWorkforceJobSlice(runId, { maxRounds: 1 });
    const sx = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "secret_x" },
    });
    ok(sx.status === "completed", "FG3: SECRET_X 已完成（并行批内）");
    // 数据面注入 poison：若证据作用域被并行扩大，poison 将进入 C 的
    // 目标推导（prioritized→customerId）与 S 的模型输入
    await db.agentRunStep.update({
      where: { id: sx.id },
      data: {
        outputJson: JSON.parse(
          JSON.stringify({
            ...(metaOf(sx.outputJson) as AnyRecord),
            prioritized: [
              { customerId: POISON, customerName: POISON },
            ],
            poisonNote: POISON,
          }),
        ),
      },
    });
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "FG3: Job completed", end);
    const sMap = await stepsOf(runId);
    const c = sMap.get("task_c");
    const cOut = metaOf(c?.outputJson);
    ok(
      c?.status === "completed" && cOut.targetSource === "recent_fallback",
      "FG3: C 工具通道 targetSource=recent_fallback（声明依赖 A/B 无客户线索；SECRET_X 目标不可见）",
      cOut.targetSource,
    );
    ok(
      !JSON.stringify(c?.outputJson ?? {}).includes(POISON),
      "FG3: C receives A/B、does NOT receive SECRET_X（poison 零出现）",
    );
    const prompt = stubCalls[0]?.userPrompt ?? "";
    ok(
      stubCalls.length === 1 &&
        prompt.includes('"task_a"') &&
        prompt.includes('"task_b"') &&
        !prompt.includes("secret_x") &&
        !prompt.includes(POISON),
      "FG3: S synthesis 通道输入仅含声明上游 A/B（SECRET_X 内容完全不可见）",
    );
    setWorkforceSynthesisModelForTests(null);
  }

  // ════════════════════════════════════════════════════════════════════
  // FG§5：P6b deterministic race——Step 已 running 时的第二个 driver
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[FG5 P6b：running 态二次 driver]");
  process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = "1";
  {
    const gate = createGate();
    const p = armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "gate", gate } },
    ]);
    const runId = await createJobWithPlan("FG5 P6b 竞态计划", [
      readStep("task_a", "sales_get_pipeline"),
    ]);
    const driverA = executeRuntimeV2Round({
      orgId: fx.orgId,
      runId,
      userId: fx.ownerUserId,
      role: "sales",
    });
    let runningSeen = false;
    for (let i = 0; i < 100; i++) {
      const row = await db.agentRunStep.findFirstOrThrow({
        where: { runId, stepKey: "task_a" },
      });
      if (row.status === "running") {
        runningSeen = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    ok(runningSeen, "FG5: Driver A 已 CAS 认领（DB 确认 Step=running），Tool 被 gate 持有");
    // 等待 A 真正进入 Tool 执行（CAS 与 tool 调用之间还有事件写入窗口）
    for (let i = 0; i < 100 && p.calls() < 1; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    ok(p.calls() === 1, "FG5: A 已进入 Tool 执行（calls=1，gate 持有中）");

    // Driver B：普通 executor round 绝不 running→ready / 二次 CAS / 二次执行
    const roundB = await executeRuntimeV2Round({
      orgId: fx.orgId,
      runId,
      userId: fx.ownerUserId,
      role: "sales",
    });
    const during = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    ok(
      roundB.status === "continued" &&
        during.status === "running" &&
        during.attemptCount === 1,
      "FG5: Driver B 不 reset、不二次 CAS（Step 保持 running，attempt=1）",
      { round: roundB.status, status: during.status },
    );
    ok(p.calls() === 1, "FG5: 无第二次 Tool execution（calls=1）");

    gate.open();
    const roundA = await driverA;
    const after = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    const claimed = await eventsOf(runId, "task.claimed");
    const completedEv = (await eventsOf(runId, "step.completed")).filter(
      (e) => metaOf(e.payload).stepKey === "task_a",
    );
    ok(
      roundA.status === "continued" &&
        after.status === "completed" &&
        after.attemptCount === 1 &&
        p.calls() === 1 &&
        claimed.length === 1 &&
        completedEv.length === 1 &&
        parseWorkforceHandoff(extractHandoffFromStepOutput(after.outputJson)).ok,
      "FG5: 终态 attempt=1 / tool side effect=1 / task.claimed=1 / step.completed=1 / Handoff=1",
      { attempts: after.attemptCount, calls: p.calls() },
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // FG§6：全局工具调用预算 bounded parallelism
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[FG6 tool budget 边界]");
  process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = "3";
  const prevMaxToolCalls = process.env.AGENT_RUNTIME_V2_MAX_TOOL_CALLS;
  process.env.AGENT_RUNTIME_V2_MAX_TOOL_CALLS = "10";
  {
    armProbe([]);
    const runId = await createJobWithPlan("FG6 预算边界计划", [
      readStep("pre_budget", "sales_get_pipeline"),
      readStep("t1", "sales_get_pipeline"),
      readStep("t2", "sales_get_pipeline"),
      readStep("t3", "sales_get_pipeline"),
      readStep("t4", "sales_get_pipeline"),
    ]);
    // 数据面固化「已消耗 9 次工具调用」：pre_budget 完成且 attemptCount=9
    const pre = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "pre_budget" },
    });
    await db.agentRunStep.update({
      where: { id: pre.id },
      data: {
        status: "completed",
        attemptCount: 9,
        completedAt: new Date(),
        outputJson: { budgetFixture: true },
      },
    });
    await kick(runId);
    await processWorkforceJobSlice(runId, { maxRounds: 1 });
    const afterRound = await db.agentRunStep.findMany({ where: { runId } });
    const executed = afterRound.filter(
      (s) => s.stepKey.startsWith("t") && s.attemptCount > 0,
    );
    const totalAttempts = afterRound.reduce((n, s) => n + s.attemptCount, 0);
    ok(
      executed.length === 1 && executed[0].status === "completed",
      "FG6: remaining=1 → 恰 1 个新 Task 认领执行（4 ready 只放行 1）",
      executed.map((s) => s.stepKey),
    );
    ok(totalAttempts === 10, "FG6: attempt total = 10（绝不突破 maxToolCalls）", totalAttempts);
    const claimed = await eventsOf(runId, "task.claimed");
    ok(claimed.length === 1, "FG6: 恰 1 次 task.claimed");
    // 预算耗尽后：不再认领任何新 Task（既有 needs_human 语义收敛）
    await kick(runId);
    await processWorkforceJobSlice(runId, { maxRounds: 2 });
    const runAfter = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const finalSteps = await db.agentRunStep.findMany({ where: { runId } });
    const finalAttempts = finalSteps.reduce((n, s) => n + s.attemptCount, 0);
    const claimedFinal = await eventsOf(runId, "task.claimed");
    ok(
      finalAttempts === 10 &&
        claimedFinal.length === 1 &&
        runAfter.status === "needs_human",
      "FG6: remaining<=0 → 零新认领，run 按既有预算语义收敛 needs_human",
      { finalAttempts, status: runAfter.status },
    );
  }
  process.env.AGENT_RUNTIME_V2_MAX_TOOL_CALLS = prevMaxToolCalls ?? "";
  if (!prevMaxToolCalls) delete process.env.AGENT_RUNTIME_V2_MAX_TOOL_CALLS;

  // ════════════════════════════════════════════════════════════════════
  // FG§7：CAS attempt 上限——耗尽的 running Step 在租约易主后不再执行
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[FG7 attempt 耗尽 reclaim 边界]");
  process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = "1";
  {
    const p = armProbe([]);
    const runId = await createJobWithPlan("FG7 attempt 耗尽计划", [
      readStep("task_a", "sales_get_pipeline"),
    ]);
    // 数据面固化「旧 worker 遗留 running 且重试预算已耗尽」+ 租约过期
    const a = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    await db.agentRunStep.update({
      where: { id: a.id },
      data: {
        status: "running",
        attemptCount: a.maxAttempts,
        startedAt: new Date(Date.now() - 60_000),
      },
    });
    await db.agentRun.update({
      where: { id: runId },
      data: {
        status: "running",
        leaseExpiresAt: new Date(Date.now() - 1000),
        nextAttemptAt: null,
      },
    });
    // maxRounds=0：只走 claim → recovery boundary → 交还队列，
    // 精确观测 recovery 本身的终态化（不被后续 verifier REPAIR 干扰）
    const slice = await processWorkforceJobSlice(runId, { maxRounds: 0 });
    ok(slice.claimed === true, "FG7: 新 worker reclaim 成功（recovery boundary 进入）");
    const afterRecovery = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    ok(
      afterRecovery.status === "failed" &&
        afterRecovery.errorCode === "stale_running_exhausted",
      "FG7: recovery 边界将耗尽 Step 终态化（stale_running_exhausted，不回 ready）",
      { status: afterRecovery.status, code: afterRecovery.errorCode },
    );
    // verifier REPAIR 可能复活 failed Step（不重置 attempt）——继续驱动，
    // pre-flight 耗尽终态化 + repair 预算耗尽后必须诚实收敛 needs_human
    const end = await driveUntil(runId, (s) =>
      ["needs_human", "failed", "completed", "partially_executed"].includes(s),
    );
    const after = await db.agentRunStep.findFirstOrThrow({
      where: { runId, stepKey: "task_a" },
    });
    ok(
      after.status === "failed" &&
        (after.errorCode === "stale_running_exhausted" ||
          after.errorCode === "step_attempts_exhausted") &&
        after.attemptCount === a.maxAttempts,
      "FG7: 终态 failed（不再执行，attempt 恒 == maxAttempts 不超限）",
      { status: after.status, code: after.errorCode, attempts: after.attemptCount },
    );
    ok(p.calls() === 0, "FG7: Tool NOT executed again（零工具调用）");
    ok(
      end === "needs_human",
      "FG7: Job 按 #90A hard floor 收敛 needs_human（真实失败显性化）",
      end,
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
