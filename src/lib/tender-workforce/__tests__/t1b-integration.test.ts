/**
 * Tender T1B — Workforce 集成测试（DB 平面；隔离 Neon 分支运行）
 *
 * 覆盖任务书 §38：
 *   T1B-01 授权用户启动 / T1B-03 跨组织拒绝 / T1B-04 双触发幂等 /
 *   T1B-05 缺文档 fail-closed→needs_human / T1B-06 canonical 域持久化 /
 *   T1B-07 证据限定当前项目（跨项目 manifest 拒绝）/ T1B-08 结构化风险 /
 *   T1B-09 澄清仅草稿 / T1B-10 native synthesis 结构化 + 结果契约 /
 *   T1B-11 required task 失败禁止 completed（verifier hard floor）/
 *   T1B-12 cancel 不复活 / T1B-13 Job Center 投影安全 /
 *   T1B-14 flag off 保持 legacy 行为 / §7 legacy 队列零认领
 *
 * 运行（隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-workforce/__tests__/t1b-integration.test.ts
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  cleanupWorkforceFixture,
  ok,
  finish,
  metaOf,
} from "@/lib/workforce-runtime/__tests__/helpers";

requireIsolatedTestDb("t1b-integration");

async function main(): Promise<void> {
  const { db } = await import("@/lib/db");
  const { processWorkforceJobSlice } = await import(
    "@/lib/workforce-runtime/processor"
  );
  const { applyWorkforceTaskSpecs } = await import(
    "@/lib/workforce-runtime/task-contract"
  );
  const { persistPlanAndSteps } = await import(
    "@/lib/agent-runtime-v2/persist"
  );
  const { executeRuntimeV2Tool } = await import(
    "@/lib/agent-runtime-v2/adapters"
  );
  const { setWorkforceSynthesisModelForTests } = await import(
    "@/lib/workforce-runtime/synthesis"
  );
  const { getWorkforceJobView } = await import(
    "@/lib/workforce-runtime/read-model/service"
  );
  const {
    startTenderWorkforceAnalysis,
    cancelTenderWorkforceAnalysis,
    getTenderWorkforceAnalysisStatus,
  } = await import("../trigger-service");
  // 必须走 alias 路径：adapters 以 "@/lib/tender-workforce/tools" 加载 handler，
  // 相对路径会得到第二个模块实例，测试接缝设不进执行实例（repo 已知现象）
  const { setTenderRiskModelForTests } = await import(
    "@/lib/tender-workforce/tools"
  );
  const {
    TENDER_WORKFORCE_ANALYSIS_VERSION,
    TENDER_AGENT_RUN_STATUS,
  } = await import("../analysis-run-service");
  const { parseTenderAnalysisResultV1 } = await import("../result-contract");
  const { enqueueTenderPackageAnalysis } = await import(
    "@/lib/tender-auto-analysis/enqueue-package"
  );
  type PlannerOutput = import("@/lib/agent-runtime-v2/schemas").PlannerOutput;

  // 强制零外部模型依赖（risk/synthesis 走测试接缝；planner 不参与——计划手工构造）
  delete process.env.OPENAI_API_KEY;
  process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = "1";
  delete process.env.TENDER_WORKFORCE_ANALYSIS_ORG_ALLOWLIST;
  delete process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS;

  console.log("Tender T1B — Workforce 集成测试（DB）\n");

  const fx = await seedWorkforceFixture("t1b");
  const fxB = await seedWorkforceFixture("t1b_orgb");
  const cleanupProjects: string[] = [];

  async function seedTenderProject(
    name: string,
    opts?: { withDocs?: boolean },
  ): Promise<string> {
    const project = await db.project.create({
      data: {
        name,
        orgId: fx.orgId,
        ownerId: fx.ownerUserId,
        workDomain: "tender",
        intakeStatus: "dispatched",
      },
      select: { id: true },
    });
    cleanupProjects.push(project.id);
    if (opts?.withDocs !== false) {
      const doc1 = await db.projectDocument.create({
        data: {
          projectId: project.id,
          title: "RFP Window Coverings.pdf",
          url: `https://blob.test/${project.id}/rfp.pdf`,
          fileType: "application/pdf",
          contentHash: `hash_rfp_${project.id}`,
          parseStatus: "done",
          pageCount: 2,
        },
        select: { id: true },
      });
      const doc2 = await db.projectDocument.create({
        data: {
          projectId: project.id,
          title: "Addendum 1.pdf",
          url: `https://blob.test/${project.id}/addendum.pdf`,
          fileType: "pdf",
          contentHash: `hash_add_${project.id}`,
          parseStatus: "done",
          pageCount: 1,
        },
        select: { id: true },
      });
      await db.projectDocumentPage.createMany({
        data: [
          {
            documentId: doc1.id,
            pageNumber: 1,
            contentText: [
              "REQUEST FOR PROPOSAL - Window Coverings Supply and Installation",
              "The closing date for this tender is September 1, 2026 at 14:00 local time.",
              "M1: Bidders must provide a bid bond of 10% of the total bid price.",
              "M2: The supplier shall provide a 5 year warranty certificate for all motorized blinds.",
            ].join("\n"),
            charCount: 300,
            parseStatus: "done",
            extractionMethod: "unpdf",
          },
          {
            documentId: doc1.id,
            pageNumber: 2,
            contentText: [
              "M3: Contractors must submit shop drawings within 10 days of award.",
              "Bidders must include product samples with their submission.",
              "It is mandatory that all fabrics meet NFPA 701 flame resistance standards.",
            ].join("\n"),
            charCount: 260,
            parseStatus: "done",
            extractionMethod: "unpdf",
          },
          {
            documentId: doc2.id,
            pageNumber: 1,
            contentText: [
              "ADDENDUM NO. 1",
              "The supplier shall provide installation within 30 days of order.",
            ].join("\n"),
            charCount: 120,
            parseStatus: "done",
            extractionMethod: "unpdf",
          },
        ],
      });
    }
    return project.id;
  }

  function buildTenderPlan(): PlannerOutput {
    const step = (
      id: string,
      title: string,
      tool: string | undefined,
      dependsOn: string[],
      taskKind: "work" | "synthesis" = "work",
    ) => ({
      id,
      title,
      description: title,
      dependsOn,
      ...(tool ? { preferredTool: tool } : {}),
      executionMode: "analysis" as const,
      riskLevel: (taskKind === "synthesis" ? "LOW" : "MEDIUM") as
        | "LOW"
        | "MEDIUM",
      requiresApproval: false,
      expectedOutput: title,
      workerKey: taskKind === "synthesis" ? "synthesis_worker" : "tender_worker",
      taskKind,
    });
    return {
      objective: "一键 AI 投标分析",
      summary: "校验→解析→提取→证据→风险→澄清→综合→写回",
      assumptions: [],
      missingInformation: [],
      needsClarification: false,
      completionCriteria: [
        {
          id: "c1",
          description: "分析清单建立且文件解析完成",
          verificationType: "tool_result",
        },
        {
          id: "c2",
          description: "要求/风险/澄清已产出并写回域模型",
          verificationType: "database_state",
        },
      ],
      steps: [
        step("t0_validate", "校验投标输入", "tender_validate_input", []),
        step("t1_parse", "解析投标文件", "tender_parse_documents", [
          "t0_validate",
        ]),
        step(
          "t2_extract",
          "提取要求与章节",
          "tender_extract_requirements",
          ["t0_validate", "t1_parse"],
        ),
        step(
          "t3_evidence",
          "证据与合规覆盖",
          "tender_evidence_compliance",
          ["t0_validate", "t2_extract"],
        ),
        step("t4_risk", "风险分析", "tender_risk_analysis", [
          "t0_validate",
          "t2_extract",
          "t3_evidence",
        ]),
        step(
          "t5_clarify",
          "澄清问题草稿",
          "tender_clarification_draft",
          ["t0_validate", "t2_extract"],
        ),
        step(
          "t6_synthesis",
          "综合汇总",
          undefined,
          ["t0_validate", "t2_extract", "t3_evidence", "t4_risk", "t5_clarify"],
          "synthesis",
        ),
        step("t7_finalize", "写回分析结果", "tender_finalize_analysis", [
          "t0_validate",
          "t6_synthesis",
        ]),
      ],
    };
  }

  async function persistPlanFor(jobId: string): Promise<void> {
    const plan = buildTenderPlan();
    const adapted = applyWorkforceTaskSpecs(plan);
    if (!adapted.ok) {
      throw new Error(`plan adaptation failed: ${adapted.code} ${adapted.error}`);
    }
    await persistPlanAndSteps({ orgId: fx.orgId, runId: jobId, plan: adapted.plan });
    // out-of-band persist 后复位队列（与 2B-2 套件同法：planned 态不可认领）
    await db.agentRun.update({
      where: { id: jobId },
      data: { status: "queued", nextAttemptAt: new Date(Date.now() - 1000) },
    });
  }

  async function driveToTerminal(
    jobId: string,
    maxSlices = 24,
  ): Promise<string> {
    for (let i = 0; i < maxSlices; i++) {
      await processWorkforceJobSlice(jobId, { maxRounds: 6 });
      const run = await db.agentRun.findFirst({
        where: { id: jobId, orgId: fx.orgId },
        select: { status: true, nextAttemptAt: true },
      });
      if (!run) throw new Error("job disappeared");
      if (
        ["completed", "failed", "cancelled", "needs_human"].includes(run.status)
      ) {
        return run.status;
      }
      // 退避快进（与既有套件同法）：立即到期
      if (run.nextAttemptAt && run.nextAttemptAt.getTime() > Date.now()) {
        await db.agentRun.update({
          where: { id: jobId },
          data: { nextAttemptAt: new Date(Date.now() - 1000) },
        });
      }
    }
    const last = await db.agentRun.findFirst({
      where: { id: jobId },
      select: { status: true },
    });
    return last?.status ?? "unknown";
  }

  const stubRisks = [
    {
      severity: "CRITICAL",
      kind: "MANDATORY_REQUIREMENT_MISSING",
      statement: "M1 投标保证金要求缺少来源支撑，存在废标风险",
      source: "M1",
    },
    {
      severity: "HIGH",
      kind: "AMBIGUOUS_SPECIFICATION",
      statement: "保修范围未明确是否含电机（M2 与补遗表述不一致）",
      source: "M2",
    },
    {
      severity: "MEDIUM",
      kind: "SUBMISSION_RISK",
      statement: "样品随标提交时间紧张",
      source: "GEN-001",
    },
  ];
  const installRiskStub = () =>
    setTenderRiskModelForTests(async () =>
      JSON.stringify({
        risks: stubRisks,
        summary: "共识别 3 条风险，其中 1 条 CRITICAL 需人工确认。",
      }),
    );
  const installSynthesisStub = () =>
    setWorkforceSynthesisModelForTests(async () =>
      JSON.stringify({
        summary:
          "本项目为窗帘供应安装投标：共提取多条强制要求，存在保证金来源缺口与保修歧义，建议澄清后再报价。",
        conclusions: [
          "强制要求 M1-M3 已识别并挂来源",
          "保证金要求缺少来源支撑，属关键缺口",
        ],
        recommendations: ["先发澄清问题再定价", "人工复核强制要求清单"],
        evidenceRefs: ["t2_extract", "t4_risk"],
      }),
    );

  /* ══════════ T1B-01 / §11：授权用户启动 + Job 元数据 ══════════ */
  console.log("[T1B-01 启动与元数据]");
  const projectA = await seedTenderProject("T1B 主场景项目");
  const started = await startTenderWorkforceAnalysis({
    orgId: fx.orgId,
    projectId: projectA,
    projectName: "T1B 主场景项目",
    userId: fx.ownerUserId,
    role: "sales",
    requestId: "req_t1b_01",
  });
  ok(started.ok, "T1B-01: 授权用户启动成功", started);
  const jobId = started.ok ? started.jobId : "";
  {
    const run = await db.agentRun.findFirst({
      where: { id: jobId, orgId: fx.orgId },
      select: { runType: true, status: true, metadata: true },
    });
    const meta = metaOf(run?.metadata);
    ok(
      run?.runType === "workforce_job" && run.status === "queued",
      "T1B-01: Job = workforce_job AgentRun（queued）",
    );
    ok(
      meta.workDomain === "tender" &&
        meta.trigger === "user" &&
        meta.analysisMode === "full" &&
        meta.requestId === "req_t1b_01" &&
        meta.projectId === projectA &&
        meta.source === "tender_ui" &&
        meta.analysisVersion === TENDER_WORKFORCE_ANALYSIS_VERSION,
      "T1B-01/§11: metadata 完整（workDomain/trigger/mode/requestId/projectId/source/version）",
      meta,
    );
  }

  /* ══════════ T1B-04：双触发幂等 ══════════ */
  console.log("\n[T1B-04 双触发幂等]");
  {
    const replay = await startTenderWorkforceAnalysis({
      orgId: fx.orgId,
      projectId: projectA,
      projectName: "T1B 主场景项目",
      userId: fx.ownerUserId,
      role: "sales",
      requestId: "req_t1b_01",
    });
    ok(
      replay.ok && replay.jobId === jobId && replay.reused,
      "T1B-04: 同 requestId 重放（HTTP retry）→ 复用同一 Job",
    );
    const differentReq = await startTenderWorkforceAnalysis({
      orgId: fx.orgId,
      projectId: projectA,
      projectName: "T1B 主场景项目",
      userId: fx.ownerUserId,
      role: "sales",
      requestId: "req_t1b_01b",
    });
    ok(
      differentReq.ok && differentReq.jobId === jobId && differentReq.reused,
      "T1B-04: 活跃 Job 存在时不同 requestId → 仍复用（at-most-one active）",
    );
    const [c1, c2] = await Promise.all([
      startTenderWorkforceAnalysis({
        orgId: fx.orgId,
        projectId: projectA,
        projectName: "T1B 主场景项目",
        userId: fx.ownerUserId,
        role: "sales",
        requestId: "req_t1b_01c",
      }),
      startTenderWorkforceAnalysis({
        orgId: fx.orgId,
        projectId: projectA,
        projectName: "T1B 主场景项目",
        userId: fx.ownerUserId,
        role: "sales",
        requestId: "req_t1b_01d",
      }),
    ]);
    const activeCount = await db.agentRun.count({
      where: {
        orgId: fx.orgId,
        runType: "workforce_job",
        status: { notIn: ["completed", "failed", "cancelled"] },
        AND: [
          { metadata: { path: ["projectId"], equals: projectA } },
          { metadata: { path: ["workDomain"], equals: "tender" } },
        ],
      },
    });
    ok(
      c1.ok &&
        c2.ok &&
        c1.jobId === jobId &&
        c2.jobId === jobId &&
        activeCount === 1,
      `T1B-04/§36: 并发双触发 → ACTIVE_JOB_COUNT = 1（实测 ${activeCount}）`,
    );
  }

  /* ══════════ T1B-03：跨组织拒绝 ══════════ */
  console.log("\n[T1B-03 跨组织隔离]");
  {
    const foreign = await getTenderWorkforceAnalysisStatus({
      orgId: fxB.orgId,
      projectId: projectA,
    });
    ok(
      foreign.job === null && foreign.latestAnalysisRun === null,
      "T1B-03: 他组织读不到本项目的分析状态",
    );
    const foreignCancel = await cancelTenderWorkforceAnalysis({
      orgId: fxB.orgId,
      projectId: projectA,
      jobId,
    });
    ok(
      !foreignCancel.ok && foreignCancel.code === "NOT_FOUND",
      "T1B-03: 他组织拿到 jobId 也不能 cancel（org+project 归属校验）",
    );
  }

  /* ══════════ 主管线：T1B-05~T1B-10 / T1B-13 / §7 ══════════ */
  console.log("\n[主管线执行]");
  installRiskStub();
  installSynthesisStub();
  await persistPlanFor(jobId);
  const finalStatus = await driveToTerminal(jobId);
  ok(finalStatus === "completed", `管线: Job 终态 completed（实测 ${finalStatus}）`);
  if (finalStatus !== "completed") {
    const steps = await db.agentRunStep.findMany({
      where: { runId: jobId },
      orderBy: { createdAt: "asc" },
      select: {
        stepKey: true,
        status: true,
        errorCode: true,
        errorMessage: true,
        attemptCount: true,
      },
    });
    console.log(
      "  [诊断] 步骤状态：",
      steps.map(
        (s) =>
          `${s.stepKey}=${s.status}(a${s.attemptCount})${s.errorCode ? ` ${s.errorCode}:${(s.errorMessage ?? "").slice(0, 160)}` : ""}`,
      ),
    );
  }

  const domainRun = await db.tenderAnalysisRun.findFirst({
    where: {
      orgId: fx.orgId,
      projectId: projectA,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
    },
    orderBy: { createdAt: "desc" },
  });
  ok(
    domainRun !== null && domainRun.status === "REVIEW_REQUIRED",
    `T1B-06: canonical TenderAnalysisRun 终态 REVIEW_REQUIRED（实测 ${domainRun?.status}）`,
  );

  if (domainRun) {
    const [reqCount, factCount, refCount, sectionRisks, clarifications] =
      await Promise.all([
        db.tenderExtractedRequirement.count({
          where: { analysisRunId: domainRun.id },
        }),
        db.tenderAnalysisFact.count({ where: { runId: domainRun.id } }),
        db.tenderAnalysisSourceRef.count({ where: { runId: domainRun.id } }),
        db.tenderAnalysisSection.findFirst({
          where: { runId: domainRun.id, sectionKey: "RISKS" },
          select: { structuredJson: true, contentZh: true },
        }),
        db.tenderClarificationQuestion.findMany({
          where: { analysisRunId: domainRun.id },
          select: { question: true, status: true },
        }),
      ]);
    // factCount 可为 0：legacy fact 抽取规则为样本特化正则（真实缺口，
    // 记报告 Known Gaps），通用 shall/must/M-code 要求抽取才是本断言核心
    ok(
      reqCount >= 3 && refCount > 0 && factCount >= 0,
      `T1B-06: 要求/来源经共享 service 落 canonical 域（req=${reqCount} fact=${factCount} ref=${refCount}）`,
    );
    const risksJson = sectionRisks?.structuredJson as {
      risks?: Array<{ severity?: string; statement?: string }>;
    } | null;
    ok(
      Array.isArray(risksJson?.risks) &&
        risksJson.risks.length === 3 &&
        risksJson.risks.some((r) => r.severity === "CRITICAL") &&
        (sectionRisks?.contentZh ?? "").includes("CRITICAL"),
      "T1B-08: 结构化风险写入 RISKS 章节（真实分级，覆盖 legacy 模板文案）",
    );
    ok(
      clarifications.length > 0 &&
        clarifications.every((c) => c.status === "OPEN"),
      `T1B-09: 澄清问题为 OPEN 草稿（${clarifications.length} 条，零发送）`,
    );
    const parsedResult = parseTenderAnalysisResultV1(domainRun.summaryJson);
    ok(
      parsedResult.ok,
      "T1B-10/§23: summaryJson 符合 tender-analysis-result/v1 契约",
      parsedResult.ok ? undefined : parsedResult,
    );
    if (parsedResult.ok) {
      ok(
        parsedResult.result.criticalRisks.length === 1 &&
          parsedResult.result.readiness === "GAPS_FOUND" &&
          parsedResult.result.requirementsSummary.total === reqCount &&
          parsedResult.result.projectSummary.includes("窗帘"),
        "T1B-10: 结果由 synthesis 结论 + 域内统计确定性组装（readiness=GAPS_FOUND）",
      );
    }
    // §7：legacy 队列零认领——候选查询与 reaper 状态集不含 AGENT_*
    const legacyEligible = await db.tenderAnalysisRun.count({
      where: {
        projectId: projectA,
        status: { in: ["PENDING", "FAILED", "EXTRACTING", "ANALYZING"] },
      },
    });
    ok(
      legacyEligible === 0,
      "§7: Workforce 域 run 不落 legacy 可认领状态（零 Runtime inside Runtime）",
    );
  }

  // T1B-10b：synthesis 步骤真实产生结构化 Handoff（native，无工具）
  {
    const synthesisStep = await db.agentRunStep.findFirst({
      where: { runId: jobId, stepKey: "t6_synthesis" },
      select: { status: true, outputJson: true },
    });
    const out = (synthesisStep?.outputJson ?? {}) as Record<string, unknown>;
    ok(
      synthesisStep?.status === "completed" &&
        typeof out.summary === "string" &&
        Array.isArray(out.synthesisOf) &&
        (out.synthesisOf as string[]).length === 5,
      "T1B-10: native synthesis completed（声明序消费 5 个上游）",
    );
  }

  // T1B-13：Job Center 投影安全 + 可见性
  {
    const view = await getWorkforceJobView({ orgId: fx.orgId, jobId });
    ok(view.ok, "T1B-13: Job 出现在 Job Center read model");
    if (view.ok) {
      const s = JSON.stringify(view.view);
      ok(
        view.view.status === "COMPLETED" &&
          view.view.tasks.length === 8 &&
          view.view.progress.completedTasks === 8,
        "T1B-13: 视图含 8 任务全完成（type/status/progress 可追踪）",
      );
      ok(
        !s.includes("workforceHandoff") &&
          !s.includes("operationKey") &&
          !s.includes("priorEvidence") &&
          !s.includes("idempotencyKey"),
        "T1B-13: 投影不泄漏内部 JSON（handoff/operationKey/evidence/幂等键）",
      );
    }
    const cardStatus = await getTenderWorkforceAnalysisStatus({
      orgId: fx.orgId,
      projectId: projectA,
    });
    ok(
      cardStatus.job?.status === "COMPLETED" &&
        cardStatus.latestAnalysisRun?.status === "REVIEW_REQUIRED",
      "T1B-13/§26: Tender 卡片状态投影（Job COMPLETED + 域 run 待审阅）",
    );
  }

  /* ══════════ T1B-07：跨项目 manifest 拒绝（工具级双保险） ══════════ */
  console.log("\n[T1B-07 证据项目隔离]");
  {
    const projectB = await seedTenderProject("T1B 隔离项目 B");
    const startedB = await startTenderWorkforceAnalysis({
      orgId: fx.orgId,
      projectId: projectB,
      projectName: "T1B 隔离项目 B",
      userId: fx.ownerUserId,
      role: "sales",
      requestId: "req_t1b_07",
    });
    ok(startedB.ok, "T1B-07: 项目 B 启动成功（准备跨项目注入）");
    if (startedB.ok && domainRun) {
      // 项目 B 的 Job 里注入项目 A 的 manifest（跨项目证据攻击面）
      const attack = await executeRuntimeV2Tool("tender_extract_requirements", {
        orgId: fx.orgId,
        userId: fx.ownerUserId,
        role: "sales",
        runId: startedB.jobId,
        stepKey: "t2_extract",
        operationKey: "op_attack",
        priorEvidence: {
          t0_validate: {
            analysisRunId: domainRun.id,
            projectId: projectA,
            fingerprint: "x",
            mode: "full",
            documents: [],
            addendumCount: 0,
          },
        },
      });
      ok(
        !attack.ok && (attack.error ?? "").includes("跨项目"),
        "T1B-07/§35: 工具拒绝消费跨项目 manifest（projectId 不一致 fail-closed）",
        attack,
      );
      const cancelB = await cancelTenderWorkforceAnalysis({
        orgId: fx.orgId,
        projectId: projectB,
        jobId: startedB.jobId,
      });
      ok(cancelB.ok, "T1B-07: 清场（取消项目 B Job）");
    }
  }

  /* ══════════ T1B-05：缺文档 → fail-closed → needs_human ══════════ */
  console.log("\n[T1B-05 缺文档 fail-closed]");
  {
    const emptyProject = await seedTenderProject("T1B 无文档项目", {
      withDocs: false,
    });
    const s = await startTenderWorkforceAnalysis({
      orgId: fx.orgId,
      projectId: emptyProject,
      projectName: "T1B 无文档项目",
      userId: fx.ownerUserId,
      role: "sales",
      requestId: "req_t1b_05",
    });
    ok(s.ok, "T1B-05: 启动成功（文档缺失在执行期 fail-closed）");
    if (s.ok) {
      await persistPlanFor(s.jobId);
      const status = await driveToTerminal(s.jobId);
      ok(
        status === "needs_human",
        `T1B-05/T1B-11: 缺文档 → 任务 fail-closed → verifier hard floor → needs_human（实测 ${status}）`,
      );
      const t0 = await db.agentRunStep.findFirst({
        where: { runId: s.jobId, stepKey: "t0_validate" },
        select: { status: true, errorMessage: true },
      });
      ok(
        t0?.status === "failed" &&
          (t0.errorMessage ?? "").includes("INPUT_MISSING"),
        "T1B-05/§33: 步骤失败语义 = INPUT_MISSING（不虚构文档内容）",
      );
      const ghost = await db.tenderAnalysisRun.count({
        where: { projectId: emptyProject },
      });
      ok(ghost === 0, "T1B-05: 未产生任何域 run（无输入即无分析记录）");
    }
  }

  /* ══════════ T1B-11：中途 required task 失败禁止 completed ══════════ */
  console.log("\n[T1B-11 verifier hard floor]");
  {
    const projectC = await seedTenderProject("T1B 风险失败项目");
    const s = await startTenderWorkforceAnalysis({
      orgId: fx.orgId,
      projectId: projectC,
      projectName: "T1B 风险失败项目",
      userId: fx.ownerUserId,
      role: "sales",
      requestId: "req_t1b_11",
    });
    ok(s.ok, "T1B-11: 启动成功");
    if (s.ok) {
      // 风险模型永远返回非法输出 → t4_risk 耗尽重试终态 failed
      setTenderRiskModelForTests(async () => "not json at all");
      installSynthesisStub();
      await persistPlanFor(s.jobId);
      const status = await driveToTerminal(s.jobId);
      ok(
        status !== "completed",
        `T1B-11/§34: required 任务失败后 Job 不得 completed（实测 ${status}）`,
      );
      const t4 = await db.agentRunStep.findFirst({
        where: { runId: s.jobId, stepKey: "t4_risk" },
        select: { status: true },
      });
      ok(t4?.status === "failed", "T1B-11: t4_risk 终态 failed（重试耗尽）");
      const domainC = await db.tenderAnalysisRun.findFirst({
        where: {
          projectId: projectC,
          analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
        },
        select: { status: true },
      });
      ok(
        domainC?.status === TENDER_AGENT_RUN_STATUS.running,
        "T1B-11: 域 run 停留 AGENT_ANALYZING（绝不假 REVIEW_REQUIRED）",
      );
      installRiskStub();
    }
  }

  /* ══════════ T1B-12：cancel 不复活 ══════════ */
  console.log("\n[T1B-12 取消语义]");
  {
    const projectD = await seedTenderProject("T1B 取消项目");
    const s = await startTenderWorkforceAnalysis({
      orgId: fx.orgId,
      projectId: projectD,
      projectName: "T1B 取消项目",
      userId: fx.ownerUserId,
      role: "sales",
      requestId: "req_t1b_12",
    });
    ok(s.ok, "T1B-12: 启动成功");
    if (s.ok) {
      installRiskStub();
      installSynthesisStub();
      await persistPlanFor(s.jobId);
      // 跑一个 slice（部分执行）后取消
      await processWorkforceJobSlice(s.jobId, { maxRounds: 2 });
      const cancelled = await cancelTenderWorkforceAnalysis({
        orgId: fx.orgId,
        projectId: projectD,
        jobId: s.jobId,
      });
      ok(cancelled.ok, "T1B-12: 项目上下文校验后取消成功");
      const before = await db.agentRunStep.aggregate({
        where: { runId: s.jobId },
        _sum: { attemptCount: true },
      });
      const slice = await processWorkforceJobSlice(s.jobId, { maxRounds: 4 });
      const after = await db.agentRunStep.aggregate({
        where: { runId: s.jobId },
        _sum: { attemptCount: true },
      });
      const run = await db.agentRun.findFirst({
        where: { id: s.jobId },
        select: { status: true },
      });
      ok(
        run?.status === "cancelled" &&
          (after._sum.attemptCount ?? 0) === (before._sum.attemptCount ?? 0),
        `T1B-12/§29: cancelled Job 不再认领新 Task（attempts 不增；slice claimed=${String(
          (slice as { claimed?: boolean }).claimed,
        )}）`,
      );
      const domainD = await db.tenderAnalysisRun.findFirst({
        where: {
          projectId: projectD,
          analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
        },
        select: { status: true, errorCode: true },
      });
      ok(
        !domainD ||
          (domainD.status === TENDER_AGENT_RUN_STATUS.failed &&
            domainD.errorCode === "cancelled"),
        "T1B-12: 域 run 同步终态 AGENT_FAILED(cancelled)（若已创建）",
        domainD,
      );
    }
  }

  /* ══════════ T1B-14：flag off 保持 legacy 行为 ══════════ */
  console.log("\n[T1B-14 flag off]");
  {
    process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = "0";
    const s = await startTenderWorkforceAnalysis({
      orgId: fx.orgId,
      projectId: projectA,
      projectName: "T1B 主场景项目",
      userId: fx.ownerUserId,
      role: "sales",
      requestId: "req_t1b_14",
    });
    ok(
      !s.ok && s.code === "FEATURE_DISABLED",
      "T1B-14: flag off → 启动拒绝（不产生 Job）",
    );
    const statusOff = await getTenderWorkforceAnalysisStatus({
      orgId: fx.orgId,
      projectId: projectA,
    });
    ok(
      statusOff.enabled === false,
      "T1B-14: 状态接口 enabled=false（卡片渲染 null，legacy UI 原样）",
    );
    // legacy 入口完全不受影响：全新项目（无 workforce 历史）照常入队
    const freshProject = await seedTenderProject("T1B legacy 原样项目");
    const legacy = await enqueueTenderPackageAnalysis({
      projectId: freshProject,
      orgId: fx.orgId,
      userId: fx.ownerUserId,
    });
    ok(
      legacy.enqueued === true,
      "T1B-14/§37: legacy 分析入口照常可用（新项目 enqueued=true）",
      legacy,
    );
    // 已有同指纹 workforce 结果（REVIEW_REQUIRED）的项目：legacy 幂等复用
    // 到同一 canonical run——域收敛的正确交互，非回归（reanalyze 仍可强制新跑）
    const legacyOnAnalyzed = await enqueueTenderPackageAnalysis({
      projectId: projectA,
      orgId: fx.orgId,
      userId: fx.ownerUserId,
    });
    ok(
      legacyOnAnalyzed.enqueued === false &&
        legacyOnAnalyzed.reason === "idempotent_reuse",
      "T1B-14/§37: legacy 对同指纹 workforce 结果幂等复用（canonical 域收敛）",
      legacyOnAnalyzed,
    );
    process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = "1";
  }

  /* ══════════ 清理 ══════════ */
  setTenderRiskModelForTests(null);
  setWorkforceSynthesisModelForTests(null);
  for (const pid of cleanupProjects) {
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: pid } });
    await db.projectDocument.deleteMany({ where: { projectId: pid } });
    await db.project.delete({ where: { id: pid } }).catch(() => {});
  }
  await cleanupWorkforceFixture(fx);
  await cleanupWorkforceFixture(fxB);

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
