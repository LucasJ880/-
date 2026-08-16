/**
 * Phase 2B-2 — Controlled Parallel Execution DB 集成测试
 *
 * 覆盖任务书：P1（§25 真实并行 overlap，barrier 证明 maxConcurrency≥2）、
 * P2（§26 MAX_PARALLEL bound）、P3（§27 SEQUENTIAL 不重叠）、P4（§28 资源
 * 冲突串行 / 无冲突并行）、P8（§32 完成顺序 C→A→B 但 Synthesis 消费顺序
 * 恒为声明序 A→B→C）、P9（§33 sibling 失败隔离）。
 *
 * 并发观测：parallel-probe 在 Prisma delegate 层注入 barrier/sleep/fail
 * （生产代码零 test seam），以 interval 扫描线证明真实 overlap。
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
  maxConcurrentIntervals,
  intervalsOverlap,
  type DbProbe,
  type ProbeRule,
} from "./parallel-probe";

requireIsolatedTestDb();

type AnyRecord = Record<string, unknown>;

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { processWorkforceJobSlice } = await import("../processor");
  const { applyWorkforceTaskSpecs } = await import("../task-contract");
  const { parseWorkforceHandoff, extractHandoffFromStepOutput } = await import(
    "../handoff"
  );
  const { persistPlanAndSteps } = await import("@/lib/agent-runtime-v2/persist");
  type PlannerOutput = import("@/lib/agent-runtime-v2/schemas").PlannerOutput;

  // 确定性：不用真实模型（grader 无 key → 降级 fallback；verifier 确定性路径）
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_EMAIL_CLIENT_ID;

  console.log("Phase 2B-2 — Controlled Parallel Execution DB 集成测试");
  const fx = await seedWorkforceFixture("p2b2ex");

  function planOf(steps: Array<AnyRecord>): PlannerOutput {
    return {
      objective: "Phase 2B-2 并行集成测试计划",
      summary: "Phase 2B-2 并行集成测试计划",
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

  function withParallel(n: number) {
    process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS = String(n);
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
  // P1（§25）：A/B/C 真实并行 overlap（barrier 证明），随后 Synthesis
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P1 真实并行 A/B/C + Synthesis]");
  withParallel(3);
  {
    const p = armProbe([
      // 三个 read 任务全部在 barrier 处会合：只有真实并发才能全员到达
      { model: "salesOpportunity", take: 40, behavior: { kind: "barrier", expected: 3, timeoutMs: 8000 } },
    ]);
    const runId = await createJobWithPlan("P1 并行读取计划", [
      readStep("task_a", "sales_get_pipeline"),
      readStep("task_b", "sales_get_pipeline"),
      readStep("task_c", "sales_get_pipeline"),
      readStep("task_s", "sales_get_pipeline", {
        dependsOn: ["task_a", "task_b", "task_c"],
        workerKey: "synthesis_worker",
        taskKind: "synthesis",
        description: "合并 A/B/C 的 Handoff",
      }),
    ]);
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "P1: Job completed", end);

    const sMap = await stepsOf(runId);
    ok(
      ["task_a", "task_b", "task_c", "task_s"].every(
        (k) => sMap.get(k)?.status === "completed",
      ),
      "P1: A/B/C/S 全部 completed",
    );
    const batchIntervals = p.intervals.filter(
      (iv) => iv.model === "salesOpportunity" && iv.take === 40,
    );
    const maxCc = maxConcurrentIntervals(batchIntervals);
    ok(
      maxCc >= 3,
      "P1/§25: barrier 证明 maxObservedConcurrency >= 3（真实 overlap，≥2 达标）",
      { maxCc, intervals: batchIntervals.length },
    );
    const claimed = await eventsOf(runId, "task.claimed");
    ok(
      claimed.length === 4 &&
        claimed
          .slice(0, 3)
          .every((e) => metaOf(e.payload).policy === "SAFE_PARALLEL"),
      "P1: 每个 Task 先 CAS 认领（task.claimed，policy=SAFE_PARALLEL）",
      claimed.map((e) => metaOf(e.payload).stepKey),
    );
    const started = await eventsOf(runId, "parallel.batch_started");
    const completedEv = await eventsOf(runId, "parallel.batch_completed");
    ok(
      started.length === 1 &&
        JSON.stringify(metaOf(started[0].payload).stepKeys) ===
          JSON.stringify(["task_a", "task_b", "task_c"]) &&
        completedEv.length === 1,
      "P1/§24: parallel.batch_started/completed 事件（stepKeys=A,B,C）",
    );
    ok(
      started.every((e) => e.visibleToUser === false) &&
        claimed.every((e) => e.visibleToUser === false),
      "P1/§24: 内部事件 visibleToUser=false",
    );
    // Handoff 完整性：并行完成的任务各自产出合法 V1 信封
    ok(
      ["task_a", "task_b", "task_c"].every((k) => {
        const parsed = parseWorkforceHandoff(
          extractHandoffFromStepOutput(sMap.get(k)?.outputJson),
        );
        return (
          parsed.ok &&
          parsed.payload.source.stepKey === k &&
          parsed.payload.source.runId === runId
        );
      }),
      "P1/§18: 并行任务各自产出合法 workforce-handoff/v1（source 正确）",
    );
    ok(
      sMap.get("task_s")?.status === "completed" &&
        parseWorkforceHandoff(
          extractHandoffFromStepOutput(sMap.get("task_s")?.outputJson),
        ).ok,
      "P1: Synthesis 消费并行上游后完成",
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // P2（§26）：MAX_PARALLEL=2，4 个 SAFE 任务，并发恒 ≤2 且真实达到 2
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P2 并行上限 bound]");
  withParallel(2);
  {
    const p = armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "sleep", ms: 500 } },
    ]);
    const runId = await createJobWithPlan("P2 上限测试计划", [
      readStep("t1", "sales_get_pipeline"),
      readStep("t2", "sales_get_pipeline"),
      readStep("t3", "sales_get_pipeline"),
      readStep("t4", "sales_get_pipeline"),
    ]);
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "P2: Job completed", end);
    const ivs = p.intervals.filter(
      (iv) => iv.model === "salesOpportunity" && iv.take === 40,
    );
    const maxCc = maxConcurrentIntervals(ivs);
    ok(ivs.length === 4, "P2: 4 个任务各执行一次", ivs.length);
    ok(maxCc === 2, "P2/§26: max concurrency = 2，never 3", { maxCc });
    const started = await eventsOf(runId, "parallel.batch_started");
    ok(
      started.length === 2 &&
        started.every(
          (e) => (metaOf(e.payload).stepKeys as string[]).length === 2,
        ),
      "P2: 两个 batch 各 2 任务（bounded batch，非 Promise.all(allReady)）",
      started.map((e) => metaOf(e.payload).stepKeys),
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // P3（§27）：SAFE A + SEQUENTIAL B + SAFE C —— B 与任何任务不重叠
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P3 SEQUENTIAL 不重叠]");
  withParallel(3);
  {
    const p = armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "sleep", ms: 500 } },
      { model: "salesQuote", behavior: { kind: "sleep", ms: 500 } },
    ]);
    const runId = await createJobWithPlan("P3 串行策略计划", [
      readStep("task_a", "sales_get_pipeline"),
      // riskLevel HIGH → server 分类 SEQUENTIAL（read 但不满足 SAFE 条件）
      readStep("task_b", "sales_quote_risk_analysis", { riskLevel: "HIGH" }),
      readStep("task_c", "sales_get_pipeline"),
    ]);
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "P3: Job completed", end);
    const pipeIvs = p.intervals.filter(
      (iv) => iv.model === "salesOpportunity" && iv.take === 40,
    );
    const quoteIvs = p.intervals.filter((iv) => iv.model === "salesQuote");
    ok(
      pipeIvs.length === 2 && maxConcurrentIntervals(pipeIvs) === 2,
      "P3: SAFE A/C 真实并行（同批 overlap）",
      { n: pipeIvs.length, cc: maxConcurrentIntervals(pipeIvs) },
    );
    ok(
      quoteIvs.length >= 1 &&
        quoteIvs.every((q) => pipeIvs.every((s) => !intervalsOverlap(q, s))),
      "P3/§27: SEQUENTIAL B 与任何任务执行区间零重叠",
      { quoteIvs: quoteIvs.length },
    );
    const claimed = await eventsOf(runId, "task.claimed");
    const policyOf = (k: string) =>
      metaOf(claimed.find((e) => metaOf(e.payload).stepKey === k)?.payload).policy;
    ok(
      policyOf("task_a") === "SAFE_PARALLEL" &&
        policyOf("task_b") === "SEQUENTIAL" &&
        policyOf("task_c") === "SAFE_PARALLEL",
      "P3: server 分类正确（A/C SAFE，B SEQUENTIAL）",
    );
    const started = await eventsOf(runId, "parallel.batch_started");
    ok(
      started.length === 1 &&
        JSON.stringify(metaOf(started[0].payload).stepKeys) ===
          JSON.stringify(["task_a", "task_c"]),
      "P3: 并行批只含 A/C；B 单独轮次执行",
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // P4（§28）：资源冲突 quote:123/quote:123 串行；quote:123/quote:456 并行
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P4 资源冲突]");
  withParallel(2);
  {
    const p = armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "sleep", ms: 500 } },
    ]);
    const runId = await createJobWithPlan("P4 同资源串行计划", [
      readStep("task_a", "sales_get_pipeline", { resources: ["quote:q123"] }),
      readStep("task_b", "sales_get_pipeline", { resources: ["quote:q123"] }),
    ]);
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "P4a: Job completed", end);
    const ivs = p.intervals.filter(
      (iv) => iv.model === "salesOpportunity" && iv.take === 40,
    );
    ok(
      ivs.length === 2 && maxConcurrentIntervals(ivs) === 1,
      "P4a/§28: 相同资源 quote:q123 → not overlapping（串行）",
      { cc: maxConcurrentIntervals(ivs) },
    );
    const started = await eventsOf(runId, "parallel.batch_started");
    ok(started.length === 0, "P4a: 无并行批（两轮各自单任务）");
  }
  {
    const p = armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "sleep", ms: 500 } },
    ]);
    const runId = await createJobWithPlan("P4 异资源并行计划", [
      readStep("task_a", "sales_get_pipeline", { resources: ["quote:q123"] }),
      readStep("task_b", "sales_get_pipeline", { resources: ["quote:q456"] }),
    ]);
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "P4b: Job completed", end);
    const ivs = p.intervals.filter(
      (iv) => iv.model === "salesOpportunity" && iv.take === 40,
    );
    ok(
      ivs.length === 2 && maxConcurrentIntervals(ivs) === 2,
      "P4b/§28: 不同资源 quote:q123 / quote:q456 且都 safe → 可以并行",
      { cc: maxConcurrentIntervals(ivs) },
    );
    const started = await eventsOf(runId, "parallel.batch_started");
    ok(
      started.length === 1 &&
        JSON.stringify(metaOf(started[0].payload).stepKeys) ===
          JSON.stringify(["task_a", "task_b"]),
      "P4b: A/B 同一并行批",
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // P8（§32）：完成顺序 C→A→B，Synthesis 消费顺序仍 = 声明序 A→B→C
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P8 Synthesis 顺序确定性]");
  withParallel(3);
  {
    // gate 显式顺序协议（与负载/内部实现路径无关，deterministic）：
    // C 不受 gate 最先完成 → 开 A 闸 → A 完成 → 开 B 闸 → B 最后完成
    const { createGate } = await import("./parallel-probe");
    const gateA = createGate();
    const gateB = createGate();
    armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "gate", gate: gateA } },
      { model: "salesOpportunity", take: 30, behavior: { kind: "gate", gate: gateB } },
    ]);
    const runId = await createJobWithPlan("P8 顺序确定性计划", [
      readStep("task_a", "sales_get_pipeline"),
      readStep("task_b", "sales_list_opportunities"),
      readStep("task_c", "sales_quote_risk_analysis"),
      readStep("task_s", "sales_get_pipeline", {
        dependsOn: ["task_a", "task_b", "task_c"],
        workerKey: "synthesis_worker",
        taskKind: "synthesis",
        description: "按声明序合并 A/B/C",
      }),
    ]);
    const waitCompleted = async (stepKey: string) => {
      for (let i = 0; i < 240; i++) {
        const row = await db.agentRunStep.findFirst({ where: { runId, stepKey } });
        if (row?.status === "completed") return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    const sliceP8 = processWorkforceJobSlice(runId, { maxRounds: 1 });
    ok(await waitCompleted("task_c"), "P8: C 最先完成（A/B 被 gate 持有）");
    gateA.open();
    ok(await waitCompleted("task_a"), "P8: 释放后 A 第二个完成");
    gateB.open();
    ok(await waitCompleted("task_b"), "P8: 释放后 B 最后完成");
    await sliceP8;
    const end = await driveUntil(runId, (s) =>
      ["completed", "partially_executed", "failed", "needs_human"].includes(s),
    );
    ok(end === "completed", "P8: Job completed", end);
    const sMap = await stepsOf(runId);
    const tA = sMap.get("task_a")?.completedAt?.getTime() ?? 0;
    const tB = sMap.get("task_b")?.completedAt?.getTime() ?? 0;
    const tC = sMap.get("task_c")?.completedAt?.getTime() ?? 0;
    ok(
      tC < tA && tA < tB,
      "P8/§32: 实际完成顺序被协议强制为 C → A → B",
      { tC, tA, tB },
    );
    const sHandoff = parseWorkforceHandoff(
      extractHandoffFromStepOutput(sMap.get("task_s")?.outputJson),
    );
    const ups = sHandoff.ok
      ? ((sHandoff.payload.outputs?.upstreamSummaries ?? []) as Array<{
          stepKey: string;
        }>)
      : [];
    ok(
      ups.map((u) => u.stepKey).join(",") === "task_a,task_b,task_c",
      "P8/§32: Synthesis 消费顺序 = dependsOn 声明序 A,B,C（与完成顺序无关）",
      ups.map((u) => u.stepKey),
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // P9（§33）：A PASS / B FAIL / C PASS —— sibling 失败隔离
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[P9 sibling 失败隔离]");
  withParallel(3);
  {
    armProbe([
      { model: "salesOpportunity", take: 40, behavior: { kind: "sleep", ms: 100 } },
      // sales_list_opportunities 在 adapter 内直连 DB（take:30）——
      // 注入的异常确定性传播为 tool failure（不经 grader 内部降级）
      { model: "salesOpportunity", take: 30, behavior: { kind: "fail", message: "P9 注入失败" } },
    ]);
    const runId = await createJobWithPlan("P9 失败隔离计划", [
      readStep("task_a", "sales_get_pipeline"),
      readStep("task_b", "sales_list_opportunities"),
      readStep("task_c", "sales_get_pipeline"),
      readStep("task_d", "sales_get_pipeline", { dependsOn: ["task_b"] }),
    ]);
    const end = await driveUntil(runId, (s) =>
      ["needs_human", "failed", "completed", "partially_executed"].includes(s),
    );
    const sMap = await stepsOf(runId);
    ok(
      sMap.get("task_a")?.status === "completed" &&
        sMap.get("task_c")?.status === "completed",
      "P9/§33: A/C durable completed（不因 B exception 丢失）",
      { a: sMap.get("task_a")?.status, c: sMap.get("task_c")?.status },
    );
    ok(
      ["task_a", "task_c"].every((k) => {
        const parsed = parseWorkforceHandoff(
          extractHandoffFromStepOutput(sMap.get(k)?.outputJson),
        );
        return parsed.ok && parsed.payload.source.stepKey === k;
      }),
      "P9: A/C Handoff 完整（sibling 结果零丢失）",
    );
    const b = sMap.get("task_b");
    ok(
      b?.status === "failed" &&
        b.errorCode === "tool_failed" &&
        b.attemptCount === 2,
      "P9: B 记录真实 Task outcome（重试耗尽 → failed）",
      { status: b?.status, code: b?.errorCode, attempts: b?.attemptCount },
    );
    const d = sMap.get("task_d");
    ok(
      d?.status === "pending" && d.attemptCount === 0 && d.outputJson === null,
      "P9/§33: B 的 downstream 不执行（pending，零 attempt）",
      { status: d?.status },
    );
    const claimedD = (await eventsOf(runId, "task.claimed")).filter(
      (e) => metaOf(e.payload).stepKey === "task_d",
    );
    ok(claimedD.length === 0, "P9: downstream 从未被认领");
    ok(
      end === "needs_human",
      "P9/§21: Job 按现有安全语义收敛 needs_human（依赖无法推进）",
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
