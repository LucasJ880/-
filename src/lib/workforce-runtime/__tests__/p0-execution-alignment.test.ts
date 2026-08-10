/**
 * P0 Runtime Execution Alignment — DB 集成 Golden Tests
 *
 * P0-G2 真实客户读工具 + 租户隔离
 * P0-G3 模型命名步骤（无字面 stepKey 耦合）
 * P0-G4 Native Synthesis（无 preferredTool，不得 no_tool）
 * P0-G5 Synthesis 依赖范围（SECRET_X 不可见）
 * P0-G6 Synthesis 输入顺序（声明序 ≠ 完成序）
 * P0-G7 失败审批类任务对 verifier 可见（#90A）
 * P0-G8 审批拒绝冻结行为回归（2C-1）
 * P0-G9 Handoff 契约回归（missing/poisoned fail-closed 不因 scoping 削弱）
 * P0-G10 Kill-Switch（含 synthesis 零模型调用）
 *
 * 运行：DATABASE_URL=<隔离分支> DIRECT_URL=<同> NODE_ENV=test \
 *       DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  cleanupWorkforceFixture,
  assertNoLeakedWorkforceJobs,
  ok,
  finish,
  metaOf,
  type WorkforceFixture,
} from "./helpers";

requireIsolatedTestDb();

type AnyRecord = Record<string, unknown>;

function planOf(steps: Array<AnyRecord>): AnyRecord {
  return {
    objective: "P0 execution alignment 集成测试计划",
    summary: "P0 execution alignment 集成测试计划",
    assumptions: [],
    missingInformation: [],
    needsClarification: false,
    completionCriteria: [
      { id: "c1", description: "全部步骤完成", verificationType: "tool_result" },
    ],
    steps,
  };
}

function stepOf(id: string, extra: AnyRecord = {}): AnyRecord {
  return {
    id,
    title: `步骤 ${id}`,
    description: `执行 ${id}`,
    dependsOn: [],
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
  const { processWorkforceJobSlice } = await import("../processor");
  const { applyWorkforceTaskSpecs } = await import("../task-contract");
  const {
    parseWorkforceHandoff,
    extractHandoffFromStepOutput,
  } = await import("../handoff");
  const { setWorkforceSynthesisModelForTests } = await import("../synthesis");
  const { fabricateContractCompletedStep } = await import("./handoff-fixtures");
  const { persistPlanAndSteps } = await import(
    "@/lib/agent-runtime-v2/persist"
  );
  const { buildFinalReport, resumeRuntimeV2AfterApproval } = await import(
    "@/lib/agent-runtime-v2/process"
  );
  const { verifyRuntimeV2Run } = await import("@/lib/agent-runtime-v2/verifier");
  const { executeRuntimeV2Tool } = await import(
    "@/lib/agent-runtime-v2/adapters"
  );
  const { createDraft } = await import("@/lib/pending-actions/drafts");
  type PlannerOutput = import("@/lib/agent-runtime-v2/schemas").PlannerOutput;

  // 确定性：verifier 模型复核 / planner 模型不可用（fallback 到确定性）；
  // gmail 天然关闭（G7 用其构造确定性写失败）
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_EMAIL_CLIENT_ID;
  delete process.env.GMAIL_DRAFT_ENABLED;

  console.log("P0 Execution Alignment — DB 集成 Golden Tests");
  const fx = await seedWorkforceFixture("p0align");
  const fxB = await seedWorkforceFixture("p0alignB");
  const fixtures: WorkforceFixture[] = [fx, fxB];

  // ── 业务数据种子：org A 3 客户/3 商机/2 报价/2 互动；org B 1 套 ──
  async function seedSalesData(orgId: string, ownerId: string, tag: string) {
    const customers = [] as Array<{ id: string; name: string }>;
    for (let i = 1; i <= 3; i++) {
      const c = await db.salesCustomer.create({
        data: {
          orgId,
          name: `P0客户${tag}_${i}`,
          email: i === 1 ? `p0_${tag}_${i}@test.qingyan.local` : null,
          status: "active",
          createdById: ownerId,
        },
      });
      customers.push({ id: c.id, name: c.name });
    }
    const opportunities = [] as Array<{ id: string; customerId: string }>;
    for (let i = 0; i < 3; i++) {
      const o = await db.salesOpportunity.create({
        data: {
          orgId,
          customerId: customers[i].id,
          title: `P0商机${tag}_${i + 1}`,
          stage: i === 0 ? "negotiation" : "quoted",
          estimatedValue: 5000 + i * 1000,
          nextFollowupAt: new Date(Date.now() - (i + 3) * 86400000),
          createdById: ownerId,
        },
      });
      opportunities.push({ id: o.id, customerId: o.customerId });
    }
    for (let i = 0; i < 2; i++) {
      await db.salesQuote.create({
        data: {
          orgId,
          customerId: customers[i].id,
          opportunityId: opportunities[i].id,
          status: i === 0 ? "sent" : "draft",
          grandTotal: 8000 + i * 500,
          sentAt: i === 0 ? new Date(Date.now() - 5 * 86400000) : null,
          createdById: ownerId,
        },
      });
      await db.customerInteraction.create({
        data: {
          orgId,
          customerId: customers[i].id,
          opportunityId: opportunities[i].id,
          type: "phone_call",
          direction: "outbound",
          summary: `P0互动${tag}_${i + 1}`,
          createdById: ownerId,
        },
      });
    }
    return { customers, opportunities };
  }
  const salesA = await seedSalesData(fx.orgId, fx.ownerUserId, "A");
  const salesB = await seedSalesData(fxB.orgId, fxB.ownerUserId, "B");

  async function cleanupSalesData(orgId: string) {
    await db.customerInteraction.deleteMany({ where: { orgId } });
    await db.salesQuote.deleteMany({ where: { orgId } });
    await db.salesOpportunity.deleteMany({ where: { orgId } });
    await db.salesCustomer.deleteMany({ where: { orgId } });
  }

  async function kick(runId: string) {
    await db.agentRun.update({
      where: { id: runId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
  }

  /** 自定义计划走 server 管线：applyWorkforceTaskSpecs → persistPlanAndSteps */
  async function createJobWithPlan(goal: string, steps: Array<AnyRecord>) {
    const job = await createWorkforceJob({
      orgId: fx.orgId,
      userId: fx.ownerUserId,
      role: "sales",
      goal,
    });
    if (!job.ok) throw new Error(`createWorkforceJob failed: ${job.error}`);
    const adapted = applyWorkforceTaskSpecs(
      planOf(steps) as unknown as PlannerOutput,
    );
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

  const adapterCtx = (prior: AnyRecord = {}) => ({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    runId: "p0-adapter-direct",
    stepKey: "direct",
    operationKey: "p0-direct",
    priorEvidence: prior,
  });

  // ══ P0-G2：真实客户读工具 + 租户隔离 ══
  console.log("\n[P0-G2 客户读工具 / 租户隔离]");
  {
    const search = await executeRuntimeV2Tool(
      "sales_search_customers",
      adapterCtx(),
    );
    const searchRows = (search.data?.customers ?? []) as Array<{
      id: string;
      name: string;
    }>;
    const aIds = new Set(salesA.customers.map((c) => c.id));
    ok(
      search.ok &&
        searchRows.length >= 3 &&
        searchRows.filter((c) => c.name.startsWith("P0客户")).every((c) => aIds.has(c.id)),
      "G2: sales_search_customers 可执行且只返回 org A 客户",
      searchRows.length,
    );
    ok(
      !searchRows.some((c) => c.name.startsWith("P0客户B")),
      "G2: 检索结果零跨租户（不含 org B 客户）",
    );

    // 依赖证据定位：org A 目标
    const getA = await executeRuntimeV2Tool(
      "sales_get_customer",
      adapterCtx({
        up: { prioritized: [{ customerId: salesA.customers[0].id, customerName: "x" }] },
      }),
    );
    const getARows = (getA.data?.customers ?? []) as Array<{ id: string }>;
    ok(
      getA.ok &&
        getARows.length === 1 &&
        getARows[0].id === salesA.customers[0].id &&
        getA.data?.targetSource === "dependency_evidence",
      "G2: sales_get_customer 依赖证据定位 org A 客户",
    );

    // 跨 org 投毒：org B 客户 id 出现在证据中 → org scope 过滤为空
    const poisoned = await executeRuntimeV2Tool(
      "sales_get_customer",
      adapterCtx({
        up: { prioritized: [{ customerId: salesB.customers[0].id, customerName: "毒" }] },
      }),
    );
    const poisonedRows = (poisoned.data?.customers ?? []) as Array<{ id: string }>;
    ok(
      poisoned.ok && poisonedRows.length === 0,
      "G2: 跨 org 客户 id 投毒 → 空结果（无数据泄漏、无报错泄露存在性）",
      poisonedRows,
    );

    const ix = await executeRuntimeV2Tool(
      "sales_get_customer_interactions",
      adapterCtx({
        up: { customers: [{ id: salesA.customers[0].id }] },
      }),
    );
    const ixRows = (ix.data?.interactions ?? []) as Array<{ customerId: string }>;
    ok(
      ix.ok && ixRows.length >= 1 && ixRows.every((r) => aIds.has(r.customerId)),
      "G2: sales_get_customer_interactions 只返回 org A 互动",
    );
    const ixPoisoned = await executeRuntimeV2Tool(
      "sales_get_customer_interactions",
      adapterCtx({ up: { customerId: salesB.customers[0].id } }),
    );
    ok(
      ixPoisoned.ok &&
        ((ixPoisoned.data?.interactions ?? []) as unknown[]).length === 0,
      "G2: 互动读取跨 org 投毒 → 空结果",
    );

    const quotes = await executeRuntimeV2Tool(
      "sales_get_customer_quotes",
      adapterCtx(),
    );
    const quoteRows = (quotes.data?.quotes ?? []) as Array<{ customerId: string }>;
    ok(
      quotes.ok &&
        quoteRows.length >= 2 &&
        quoteRows.every((q) => aIds.has(q.customerId)),
      "G2: sales_get_customer_quotes 组织内近期兜底且零跨租户",
      quoteRows.length,
    );
    const quotesB = await executeRuntimeV2Tool(
      "sales_get_customer_quotes",
      adapterCtx({ up: { customers: [{ id: salesB.customers[0].id }] } }),
    );
    ok(
      quotesB.ok && ((quotesB.data?.quotes ?? []) as unknown[]).length === 0,
      "G2: 报价读取跨 org 投毒 → 空结果",
    );
  }

  // ══ P0-G3：模型命名步骤（read_pipeline/risk_review/followup_review/rank_customers）══
  console.log("\n[P0-G3 模型命名步骤]");
  const g3RunId = await createJobWithPlan("P0-G3 模型命名多任务计划", [
    stepOf("read_pipeline", { preferredTool: "sales_get_pipeline" }),
    stepOf("followup_review", {
      preferredTool: "sales_customer_followup_analysis",
      dependsOn: ["read_pipeline"],
      executionMode: "analysis",
    }),
    stepOf("risk_review", {
      preferredTool: "sales_quote_risk_analysis",
      dependsOn: ["read_pipeline"],
      executionMode: "analysis",
    }),
    stepOf("rank_customers", {
      preferredTool: "sales_prioritize_followups",
      dependsOn: ["read_pipeline", "followup_review", "risk_review"],
      executionMode: "analysis",
    }),
  ]);
  const g3End = await driveUntil(g3RunId, (s) =>
    ["completed", "needs_human", "failed"].includes(s),
  );
  {
    const steps = await db.agentRunStep.findMany({ where: { runId: g3RunId } });
    const byKey = new Map(steps.map((s) => [s.stepKey, s]));
    const rank = byKey.get("rank_customers");
    ok(
      rank?.status === "completed",
      "G3: rank_customers（sales_prioritize_followups）完成——零字面 stepKey 耦合",
      { status: rank?.status, error: rank?.errorMessage },
    );
    ok(
      !steps.some((s) => s.errorMessage?.includes("s3") || s.errorMessage?.includes("s4")),
      "G3: 无任何步骤报模板编号错误（MISSING_GRADER_EVIDENCE 旧文案）",
    );
    const rankOut = metaOf(rank?.outputJson);
    ok(
      Array.isArray(rankOut.prioritized),
      "G3: 排序输出为结构化 prioritized 列表",
    );
    ok(
      ["completed", "needs_human"].includes(g3End),
      "G3: Job 到达明确定义终态（PARTIAL 降级证据时 needs_human 属既有 verifier 语义）",
      g3End,
    );
    const g3Report = await buildFinalReport(fx.orgId, g3RunId);
    ok(
      typeof g3Report === "string" && g3Report.length > 0,
      "G3: 最终报告按工具语义（非 s5_prioritize 字面键）生成",
    );
  }

  // ══ P0-G4：Native Synthesis（A/B/C → S，无 preferredTool）══
  console.log("\n[P0-G4 Native Synthesis]");
  const synthCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
  setWorkforceSynthesisModelForTests(async (input) => {
    synthCalls.push(input);
    return JSON.stringify({
      summary: "P0 综合结论：三个上游产出一致表明管道健康、风险可控。",
      conclusions: ["管道数据完整", "上游证据一致"],
      risks: ["报价回复周期偏长"],
      recommendations: ["优先跟进 negotiation 阶段客户"],
      evidenceRefs: ["task_a", "task_b", "task_c"],
    });
  });
  const g4RunId = await createJobWithPlan("P0-G4 native synthesis 计划", [
    stepOf("task_a", { preferredTool: "sales_get_pipeline" }),
    stepOf("task_b", { preferredTool: "sales_list_opportunities" }),
    stepOf("task_c", { preferredTool: "sales_get_pipeline" }),
    stepOf("task_s", {
      dependsOn: ["task_a", "task_b", "task_c"],
      workerKey: "synthesis_worker",
      taskKind: "synthesis",
      executionMode: "analysis",
      title: "综合汇总",
      description: "综合 A/B/C 的结构化 Handoff 产出结论",
    }),
  ]);
  const g4End = await driveUntil(g4RunId, (s) =>
    ["completed", "needs_human", "failed"].includes(s),
  );
  {
    const steps = await db.agentRunStep.findMany({ where: { runId: g4RunId } });
    const sStep = steps.find((s) => s.stepKey === "task_s");
    ok(g4End === "completed", "G4: Job completed（synthesis 场景全绿）", g4End);
    ok(
      sStep?.status === "completed" && sStep?.preferredTool === null,
      "G4: synthesis 任务无 preferredTool 而完成",
      { status: sStep?.status, tool: sStep?.preferredTool },
    );
    ok(
      sStep?.errorCode !== "no_tool",
      "G4: 不存在 no_tool 失败（native synthesis 语义）",
    );
    const sOut = metaOf(sStep?.outputJson);
    ok(
      typeof sOut.summary === "string" &&
        Array.isArray(sOut.conclusions) &&
        JSON.stringify(sOut.synthesisOf) ===
          JSON.stringify(["task_a", "task_b", "task_c"]),
      "G4: 结构化综合结果（summary/conclusions/synthesisOf 审计）",
    );
    const sHandoff = parseWorkforceHandoff(
      extractHandoffFromStepOutput(sStep?.outputJson),
    );
    ok(
      sHandoff.ok &&
        sHandoff.payload.source.workerKey === "synthesis_worker" &&
        sHandoff.payload.summary.includes("P0 综合结论"),
      "G4: workforce-handoff/v1 信封携带真实综合结论（非模板文）",
    );
    const report = await buildFinalReport(fx.orgId, g4RunId);
    ok(
      report.includes("综合结论") && report.includes("P0 综合结论"),
      "G4: 最终报告呈现真实 synthesis 结论",
    );
    ok(synthCalls.length === 1, "G4: 统一模型出口恰被调用一次", synthCalls.length);
  }

  // ══ P0-G5：Synthesis 依赖范围（SECRET_X 不可见）══
  console.log("\n[P0-G5 Synthesis 依赖范围]");
  synthCalls.length = 0;
  const g5RunId = await createJobWithPlan("P0-G5 依赖范围计划", [
    stepOf("task_a", { preferredTool: "sales_get_pipeline" }),
    stepOf("task_b", { preferredTool: "sales_list_opportunities" }),
    stepOf("task_c", { preferredTool: "sales_get_pipeline" }),
    stepOf("secret_x", { preferredTool: "sales_get_pipeline" }),
    stepOf("task_s", {
      dependsOn: ["task_a", "task_b", "task_c"],
      workerKey: "synthesis_worker",
      taskKind: "synthesis",
      executionMode: "analysis",
    }),
  ]);
  await fabricateContractCompletedStep({
    runId: g5RunId,
    stepKey: "secret_x",
    businessOutput: {
      summary: "QY_SECRET_MARKER_93 机密上游内容",
      secretNote: "QY_SECRET_MARKER_93",
    },
  });
  const g5End = await driveUntil(g5RunId, (s) =>
    ["completed", "needs_human", "failed"].includes(s),
  );
  {
    ok(g5End === "completed", "G5: Job completed", g5End);
    ok(synthCalls.length === 1, "G5: synthesis 恰执行一次");
    const prompt = synthCalls[0]?.userPrompt ?? "";
    const upstreams = (JSON.parse(prompt) as {
      upstreams: Array<{ stepKey: string }>;
    }).upstreams;
    ok(
      JSON.stringify(upstreams.map((u) => u.stepKey)) ===
        JSON.stringify(["task_a", "task_b", "task_c"]),
      "G5: synthesis 输入仅含声明依赖 A/B/C",
      upstreams.map((u) => u.stepKey),
    );
    ok(
      !prompt.includes("QY_SECRET_MARKER_93"),
      "G5: SECRET_X 内容对 synthesis 完全不可见（dependency scope enforced）",
    );
  }

  // ══ P0-G6：Synthesis 输入顺序（完成序 C,A,B ≠ 声明序 A,B,C）══
  console.log("\n[P0-G6 Synthesis 输入顺序]");
  synthCalls.length = 0;
  const g6RunId = await createJobWithPlan("P0-G6 输入顺序计划", [
    stepOf("task_a", { preferredTool: "sales_get_pipeline" }),
    stepOf("task_b", { preferredTool: "sales_get_pipeline" }),
    stepOf("task_c", { preferredTool: "sales_get_pipeline" }),
    stepOf("task_s", {
      dependsOn: ["task_a", "task_b", "task_c"],
      workerKey: "synthesis_worker",
      taskKind: "synthesis",
      executionMode: "analysis",
    }),
  ]);
  // 完成序 C → A → B（fabricate 依次落 completedAt）
  await fabricateContractCompletedStep({
    runId: g6RunId,
    stepKey: "task_c",
    businessOutput: { summary: "C 的产出" },
  });
  await fabricateContractCompletedStep({
    runId: g6RunId,
    stepKey: "task_a",
    businessOutput: { summary: "A 的产出" },
  });
  await fabricateContractCompletedStep({
    runId: g6RunId,
    stepKey: "task_b",
    businessOutput: { summary: "B 的产出" },
  });
  const g6End = await driveUntil(g6RunId, (s) =>
    ["completed", "needs_human", "failed"].includes(s),
  );
  {
    const steps = await db.agentRunStep.findMany({ where: { runId: g6RunId } });
    const t = (k: string) =>
      steps.find((s) => s.stepKey === k)?.completedAt?.getTime() ?? 0;
    ok(
      t("task_c") <= t("task_a") && t("task_a") <= t("task_b"),
      "G6: 完成序确为 C ≤ A ≤ B（构造成立）",
    );
    ok(g6End === "completed", "G6: Job completed", g6End);
    const upstreams = (JSON.parse(synthCalls[0]?.userPrompt ?? "{}") as {
      upstreams?: Array<{ stepKey: string }>;
    }).upstreams;
    ok(
      JSON.stringify(upstreams?.map((u) => u.stepKey)) ===
        JSON.stringify(["task_a", "task_b", "task_c"]),
      "G6: synthesis 输入严格按声明序 A,B,C（非完成序/DB 行序）",
      upstreams?.map((u) => u.stepKey),
    );
  }

  // ══ P0-G7：失败审批类任务对 verifier 可见（#90A）══
  console.log("\n[P0-G7 失败审批任务 verifier 可见]");
  // G7a：写工具执行失败（gmail 未配置 → FEATURE_NOT_CONFIGURED）
  const g7RunId = await createJobWithPlan("P0-G7 失败写任务计划", [
    stepOf("read_a", { preferredTool: "sales_get_pipeline" }),
    stepOf("write_b", {
      preferredTool: "gmail_create_draft",
      dependsOn: ["read_a"],
      executionMode: "write",
      riskLevel: "HIGH",
      requiresApproval: true,
    }),
  ]);
  const g7End = await driveUntil(g7RunId, (s) =>
    ["completed", "needs_human", "failed"].includes(s),
  );
  {
    const steps = await db.agentRunStep.findMany({ where: { runId: g7RunId } });
    const writeB = steps.find((s) => s.stepKey === "write_b");
    ok(
      writeB?.status === "failed" && writeB.requiresApproval === true,
      "G7: 写任务（requiresApproval=true）终态 failed",
      writeB?.status,
    );
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: g7RunId } });
    ok(
      run.status === "needs_human" && g7End !== "completed",
      "G7: Job != completed（失败必需任务不可静默）",
      run.status,
    );
    const verifications = await db.agentRunVerification.findMany({
      where: { runId: g7RunId },
      orderBy: { attempt: "desc" },
    });
    ok(
      verifications.length > 0 && verifications[0].verdict !== "PASS",
      "G7: Verifier != PASS（deterministic 规则可见失败写任务）",
      verifications[0]?.verdict,
    );
    ok(
      verifications[0]?.verdict === "NEEDS_HUMAN" &&
        (verifications[0]?.unsatisfiedCriteriaJson as string[]).some((c) =>
          c.includes("必需写任务终态失败"),
        ),
      "G7: 判定为 NEEDS_HUMAN 且明示失败原因（不空转 REPAIR）",
    );
    ok(
      run.errorCode === "verification_failed",
      "G7: durable errorCode = verification_failed（不再 null/残留）",
      run.errorCode,
    );
  }

  // G7b：审批通过后执行失败（PendingAction failed → reconcile → verifier）
  const g7bRunId = await createJobWithPlan("P0-G7b 审批后执行失败计划", [
    stepOf("read_a", { preferredTool: "sales_get_pipeline" }),
    stepOf("write_b", {
      preferredTool: "grader_create_followup_task",
      dependsOn: ["read_a"],
      executionMode: "write",
      riskLevel: "HIGH",
      requiresApproval: true,
    }),
  ]);
  {
    await fabricateContractCompletedStep({
      runId: g7bRunId,
      stepKey: "read_a",
      businessOutput: { summary: "读取完成" },
    });
    const draft = await createDraft({
      type: "calendar.create_event",
      title: "P0-G7b 审批后失败",
      preview: "test",
      payload: {
        title: "P0-G7b",
        description: "approved-then-failed",
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 + 1800000).toISOString(),
        metadata: { orgId: fx.orgId, source: "p0_g7b_test" },
      },
      userId: fx.ownerUserId,
      orgId: fx.orgId,
      agentRunId: g7bRunId,
      idempotencyKey: `p0g7b_${fx.tag}`,
    });
    const paId = (draft.data as { actionId?: string } | undefined)?.actionId;
    if (!paId) throw new Error("G7b draft 创建失败");
    await db.agentRunStep.updateMany({
      where: { runId: g7bRunId, stepKey: "write_b" },
      data: {
        status: "awaiting_approval",
        pendingActionId: paId,
        evidenceJson: { pendingActionIds: [paId] },
      },
    });
    await db.agentRun.update({
      where: { id: g7bRunId },
      data: { status: "awaiting_approval", leaseExpiresAt: null },
    });
    // 审批通过 → 执行失败：PendingAction 终态 failed
    await db.pendingAction.update({
      where: { id: paId },
      data: { status: "failed" },
    });
    await resumeRuntimeV2AfterApproval({
      orgId: fx.orgId,
      runId: g7bRunId,
      approvalActorUserId: fx.approverUserId,
    });
    const writeB = await db.agentRunStep.findFirstOrThrow({
      where: { runId: g7bRunId, stepKey: "write_b" },
    });
    ok(
      writeB.status === "failed",
      "G7b: CASE B（审批通过→执行失败）reconcile 为 step failed",
      writeB.status,
    );
    const verdict = await verifyRuntimeV2Run({
      orgId: fx.orgId,
      runId: g7bRunId,
      userId: fx.ownerUserId,
    });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: g7bRunId } });
    ok(
      verdict.verdict !== "PASS" && run.status !== "completed",
      "G7b: 审批语义不遮蔽真实执行失败（Verifier != PASS，Job != completed）",
      { verdict: verdict.verdict, run: run.status },
    );
  }

  // ══ P0-G8：审批拒绝冻结行为回归（2C-1）══
  console.log("\n[P0-G8 审批拒绝回归]");
  const g8RunId = await createJobWithPlan("P0-G8 审批拒绝计划", [
    stepOf("pick", { preferredTool: "sales_prioritize_followups" }),
    stepOf("write_b", {
      preferredTool: "grader_create_followup_task",
      dependsOn: ["pick"],
      executionMode: "write",
      riskLevel: "HIGH",
      requiresApproval: true,
    }),
    stepOf("after_c", {
      preferredTool: "sales_get_pipeline",
      dependsOn: ["write_b"],
    }),
  ]);
  {
    await fabricateContractCompletedStep({
      runId: g8RunId,
      stepKey: "pick",
      businessOutput: {
        prioritized: [
          {
            customerId: salesA.customers[0].id,
            customerName: salesA.customers[0].name,
            opportunityId: salesA.opportunities[0].id,
            reasons: ["G8 测试"],
          },
        ],
        summary: "选出 1 个优先客户",
      },
    });
    const g8Mid = await driveUntil(
      g8RunId,
      (s) => ["awaiting_approval", "needs_human", "failed"].includes(s),
      4,
    );
    ok(g8Mid === "awaiting_approval", "G8: 写任务挂起等待审批", g8Mid);
    const writeB = await db.agentRunStep.findFirstOrThrow({
      where: { runId: g8RunId, stepKey: "write_b" },
    });
    const paIds =
      (metaOf(writeB.evidenceJson).pendingActionIds as string[]) ?? [];
    ok(paIds.length > 0, "G8: PendingAction 已创建");
    await db.pendingAction.updateMany({
      where: { id: { in: paIds } },
      data: { status: "rejected" },
    });
    await resumeRuntimeV2AfterApproval({
      orgId: fx.orgId,
      runId: g8RunId,
      approvalActorUserId: fx.approverUserId,
    });
    const writeBAfter = await db.agentRunStep.findFirstOrThrow({
      where: { runId: g8RunId, stepKey: "write_b" },
    });
    const afterC = await db.agentRunStep.findFirstOrThrow({
      where: { runId: g8RunId, stepKey: "after_c" },
    });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: g8RunId } });
    ok(
      writeBAfter.status === "skipped",
      "G8: 全拒 → step skipped（合法 skip，不因 #90A 变成 failed）",
      writeBAfter.status,
    );
    ok(
      run.status === "needs_human" && run.errorCode === "approval_rejected",
      "G8: 2C-1 冻结行为保持：needs_human(approval_rejected)",
      { status: run.status, code: run.errorCode },
    );
    ok(
      ["pending", "ready"].includes(afterC.status),
      "G8: 下游不执行（no downstream after rejection）",
      afterC.status,
    );
  }

  // ══ P0-G9：Handoff 契约回归（scoping 不削弱 fail-closed）══
  console.log("\n[P0-G9 Handoff 契约回归]");
  {
    // 9a：契约任务上游缺信封 → HANDOFF_MISSING fail-closed
    const g9aRunId = await createJobWithPlan("P0-G9a missing handoff", [
      stepOf("up_a", { preferredTool: "sales_get_pipeline" }),
      stepOf("down_b", {
        preferredTool: "sales_list_opportunities",
        dependsOn: ["up_a"],
      }),
    ]);
    // 伪造 completed 但不带信封（破坏 durable 状态）
    await db.agentRunStep.updateMany({
      where: { runId: g9aRunId, stepKey: "up_a" },
      data: {
        status: "completed",
        completedAt: new Date(),
        outputJson: { opportunityCount: 0 },
      },
    });
    const g9aEnd = await driveUntil(g9aRunId, (s) =>
      ["needs_human", "failed", "completed"].includes(s),
    );
    const downB = await db.agentRunStep.findFirstOrThrow({
      where: { runId: g9aRunId, stepKey: "down_b" },
    });
    ok(
      g9aEnd === "needs_human" &&
        downB.status === "failed" &&
        downB.errorCode === "HANDOFF_MISSING",
      "G9a: 契约任务缺信封 → HANDOFF_MISSING fail-closed（scoping 未削弱）",
      { end: g9aEnd, code: downB.errorCode },
    );

    // 9b：信封版本投毒 → HANDOFF_VERSION_UNSUPPORTED fail-closed
    const g9bRunId = await createJobWithPlan("P0-G9b poisoned version", [
      stepOf("up_a", { preferredTool: "sales_get_pipeline" }),
      stepOf("down_b", {
        preferredTool: "sales_list_opportunities",
        dependsOn: ["up_a"],
      }),
    ]);
    await kick(g9bRunId);
    await processWorkforceJobSlice(g9bRunId, { maxRounds: 1 });
    const upA = await db.agentRunStep.findFirstOrThrow({
      where: { runId: g9bRunId, stepKey: "up_a" },
    });
    ok(upA.status === "completed", "G9b: 上游正常完成");
    const upOut = metaOf(upA.outputJson) as AnyRecord;
    const envelope = metaOf(upOut.workforceHandoff) as AnyRecord;
    await db.agentRunStep.update({
      where: { id: upA.id },
      data: {
        outputJson: JSON.parse(
          JSON.stringify({
            ...upOut,
            workforceHandoff: { ...envelope, contractVersion: "workforce-handoff/v999" },
          }),
        ),
      },
    });
    const g9bEnd = await driveUntil(g9bRunId, (s) =>
      ["needs_human", "failed", "completed"].includes(s),
    );
    const downB2 = await db.agentRunStep.findFirstOrThrow({
      where: { runId: g9bRunId, stepKey: "down_b" },
    });
    ok(
      g9bEnd === "needs_human" &&
        downB2.status === "failed" &&
        downB2.errorCode === "HANDOFF_VERSION_UNSUPPORTED",
      "G9b: 未知信封版本 → fail-closed（2B-1 安全边界不降）",
      { end: g9bEnd, code: downB2.errorCode },
    );
  }

  // ══ P0-G10：Kill-Switch（含 synthesis 零模型调用）══
  console.log("\n[P0-G10 Kill-Switch]");
  {
    synthCalls.length = 0;
    const g10RunId = await createJobWithPlan("P0-G10 kill switch 计划", [
      stepOf("task_a", { preferredTool: "sales_get_pipeline" }),
      stepOf("task_s", {
        dependsOn: ["task_a"],
        workerKey: "synthesis_worker",
        taskKind: "synthesis",
        executionMode: "analysis",
      }),
    ]);
    const beforeSteps = await db.agentRunStep.findMany({
      where: { runId: g10RunId },
      orderBy: { createdAt: "asc" },
    });
    const prevFlag = process.env.WORKFORCE_RUNTIME_ENABLED;
    process.env.WORKFORCE_RUNTIME_ENABLED = "0";
    try {
      await kick(g10RunId);
      const sliceOff = await processWorkforceJobSlice(g10RunId, { maxRounds: 6 });
      ok(
        sliceOff.claimed === false,
        "G10: 开关关闭 → 不 claim、不处理",
      );
      const afterSteps = await db.agentRunStep.findMany({
        where: { runId: g10RunId },
        orderBy: { createdAt: "asc" },
      });
      const run = await db.agentRun.findUniqueOrThrow({
        where: { id: g10RunId },
      });
      ok(
        run.status === "queued" &&
          JSON.stringify(afterSteps.map((s) => [s.stepKey, s.status, s.attemptCount])) ===
            JSON.stringify(beforeSteps.map((s) => [s.stepKey, s.status, s.attemptCount])),
        "G10: queued 冻结、零 Step mutation",
      );
      ok(
        synthCalls.length === 0,
        "G10: 零 synthesis 模型调用（kill-switch 覆盖 native synthesis）",
      );
    } finally {
      process.env.WORKFORCE_RUNTIME_ENABLED = prevFlag ?? "1";
    }
    // 开关恢复后可正常消费（synthesis 恢复执行）
    const g10End = await driveUntil(g10RunId, (s) =>
      ["completed", "needs_human", "failed"].includes(s),
    );
    ok(
      g10End === "completed" && synthCalls.length === 1,
      "G10: 开关恢复 → 正常执行至 completed（synthesis 恢复）",
      { end: g10End, calls: synthCalls.length },
    );
  }

  setWorkforceSynthesisModelForTests(null);

  // ── 清理：先业务数据再 fixture；断言零 workforce job 泄漏 ──
  for (const f of fixtures) {
    await cleanupSalesData(f.orgId);
  }
  for (const f of fixtures) {
    const cleaned = await cleanupWorkforceFixture(f);
    ok(
      await assertNoLeakedWorkforceJobs(f),
      `CLEANUP: fixture ${f.tag} 无 workforce job 泄漏`,
      cleaned.residue,
    );
  }

  finish();
}

main().catch((err) => {
  console.error("P0 execution alignment 测试异常退出:", err);
  process.exit(1);
});
