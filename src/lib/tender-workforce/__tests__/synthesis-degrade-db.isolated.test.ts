/**
 * FIX-20 综合汇总没做出来不再扣住招标分析结果——真实 DB（隔离库）端到端
 *
 * 预置 t1–t7 已完成、交接数据齐全的招投标确定性计划 Job，第 8 步用测试注入口抛
 * 「429 You exceeded your current quota…」，用真处理器驱动；另有中断回收、第 3 步失败、
 * 契约损坏、第 9 步依赖里什么都没有几组。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；不调模型（综合汇总走测试注入口）、不发邮件、零外部情报出站。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-20 综合汇总降级 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-20 synthesis degrade DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

const QUOTA_ERROR = "429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.";
const QUOTA_ZH = "AI 账户余额不足，请联系平台管理员充值";
const LEAK_MARKERS = ["quota", "You exceeded", "SYNTHESIS_MODEL_FAILED", "model_quota_exhausted"];

async function main() {
  // 零外部依赖：不调真模型、不跑外部情报、不推 Muse
  delete process.env.OPENAI_API_KEY;
  delete process.env.EXTERNAL_INTEL_ENABLED;
  delete process.env.MUSE_BRIDGE_ENABLED;
  delete process.env.WORKFORCE_JOB_MAX_PARALLEL_TASKS;
  process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = "1";
  // 确定性计划 9 个任务（默认上限 8）；工具调用预算放宽，免得预置的尝试次数先撞上上限
  process.env.AGENT_RUNTIME_V2_MAX_STEPS = "9";
  process.env.AGENT_RUNTIME_V2_MAX_TOOL_CALLS = "40";

  const { db } = await import("@/lib/db");
  const { seedWorkforceFixture } = await import("@/lib/workforce-runtime/__tests__/helpers");
  const { createWorkforceJob } = await import("@/lib/workforce-runtime/job");
  const { processWorkforceJobSlice } = await import("@/lib/workforce-runtime/processor");
  const { buildWorkforceHandoffV1 } = await import("@/lib/workforce-runtime/handoff");
  const { readWorkforceTaskSpec } = await import("@/lib/workforce-runtime/task-contract");
  const { getWorkforceJobView } = await import("@/lib/workforce-runtime/read-model/service");
  // 必须走 alias 路径：执行器以 "@/lib/workforce-runtime/synthesis" 加载，相对路径会得到第二个模块实例
  const { setWorkforceSynthesisModelForTests } = await import("@/lib/workforce-runtime/synthesis");
  const { executeRuntimeV2Tool } = await import("@/lib/agent-runtime-v2/adapters");
  const { buildTenderDeterministicPlan } = await import("@/lib/tender-workforce/deterministic-plan");
  const { tenderWorkforceDeterministicTools, TENDER_CANONICAL_V2_MARKER, TENDER_SEMANTIC_ENGINE_V2 } = await import("@/lib/tender-workforce/tools");
  const { buildWorkforceTenderIdempotencyKey, TENDER_WORKFORCE_ANALYSIS_VERSION } = await import("@/lib/tender-workforce/analysis-run-service");
  const { getTenderWorkforceAnalysisStatus, buildTenderAnalysisGoal } = await import("@/lib/tender-workforce/trigger-service");

  console.log("FIX-20 synthesis degrade — isolated DB");
  const fx = await seedWorkforceFixture("sd");
  const ORG = fx.orgId;
  const OWNER = fx.ownerUserId;
  const LEAD = fx.approverUserId;
  const projectIds: string[] = [];
  const jobIds: string[] = [];
  let seq = 0;

  type StepPatch = { status: string; errorCode?: string | null; errorMessage?: string | null; attemptCount?: number; outputJson?: unknown };
  /** 预置一个确定性计划 Job：默认 t1–t7 已完成（交接数据齐全）、t8/t9 待开始 */
  async function seedJob(patch: Record<string, StepPatch> = {}, corrupt?: (stepKey: string, out: Record<string, unknown>) => Record<string, unknown>) {
    seq += 1;
    const projectName = `FIX-20 Fixture ${fx.tag}-${seq}`;
    const project = await db.project.create({ data: { name: projectName, orgId: ORG, ownerId: LEAD, workDomain: "tender", intakeStatus: "dispatched" }, select: { id: true } });
    projectIds.push(project.id);
    const created = await createWorkforceJob({
      orgId: ORG, userId: OWNER, role: "sales", goal: buildTenderAnalysisGoal(projectName), channel: "workforce", projectId: project.id, source: "tender_ui",
      plan: buildTenderDeterministicPlan({ projectId: project.id, projectName }),
      planTools: tenderWorkforceDeterministicTools(),
      workDomain: "tender",
      extraMetadata: { trigger: "user", analysisMode: "full", analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION },
    } as Parameters<typeof createWorkforceJob>[0]);
    if (!created.ok) throw new Error(`createWorkforceJob failed: ${JSON.stringify(created)}`);
    const jobId = created.jobId;
    jobIds.push(jobId);
    const analysis = await db.tenderAnalysisRun.create({
      data: {
        orgId: ORG, projectId: project.id, status: "AGENT_ANALYZING", idempotencyKey: buildWorkforceTenderIdempotencyKey(jobId), sourceHashFingerprint: "fixture",
        createdById: OWNER, analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
        summaryJson: { submissionChecklist: [{ item: "Bid bond 10%", requirementCode: "M1" }], analystSynthesis: { headline: "canonical V2 结论（fixture）" } },
        summaryText: "canonical V2 摘要（fixture，不得被覆盖）",
      },
      select: { id: true },
    });
    const manifest = { analysisRunId: analysis.id, projectId: project.id, fingerprint: "fixture", mode: "full", documents: [], addendumCount: 0 };
    const steps = await db.agentRunStep.findMany({ where: { runId: jobId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const at = new Date(Date.now() - 60_000);
    for (const s of steps) {
      const p: StepPatch | undefined = patch[s.stepKey] ?? (["t8_synthesis", "t9_finalize_analysis"].includes(s.stepKey) ? undefined : { status: "completed" });
      if (!p) continue;
      let outputJson: unknown = p.outputJson;
      if (p.status === "completed" && outputJson === undefined) {
        const business: Record<string, unknown> = { ...manifest, summary: `${s.title}（fixture）已完成` };
        if (s.stepKey === "t3_analyze_package_v2") Object.assign(business, { [TENDER_CANONICAL_V2_MARKER]: true, semanticEngine: TENDER_SEMANTIC_ENGINE_V2, canonicalPersisted: true });
        const spec = readWorkforceTaskSpec(s.inputJson);
        if (spec.kind !== "valid") throw new Error(`fixture step ${s.stepKey} spec ${spec.kind}`);
        const h = buildWorkforceHandoffV1({ runId: jobId, stepKey: s.stepKey, workerKey: spec.spec.worker.workerKey, taskKind: spec.spec.taskKind, stepStatus: "completed", taskObjective: spec.spec.objective, businessOutput: business, completedAt: at });
        if (!h.ok) throw new Error(`fixture handoff ${s.stepKey}: ${h.error}`);
        outputJson = { ...business, workforceHandoff: h.payload };
        if (corrupt) outputJson = corrupt(s.stepKey, outputJson as Record<string, unknown>);
      }
      await db.agentRunStep.update({
        where: { id: s.id },
        data: {
          status: p.status,
          attemptCount: p.attemptCount ?? (p.status === "pending" ? 0 : 1),
          errorCode: p.errorCode ?? null,
          errorMessage: p.errorMessage ?? null,
          ...(outputJson !== undefined ? { outputJson: outputJson as object } : {}),
          ...(["completed", "failed"].includes(p.status) ? { startedAt: at, completedAt: at } : {}),
        },
      });
    }
    return { jobId, projectId: project.id, analysisRunId: analysis.id, manifest };
  }

  const stepOf = (jobId: string, stepKey: string) => db.agentRunStep.findFirstOrThrow({ where: { runId: jobId, stepKey } });
  const jobOf = (jobId: string) => db.agentRun.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, errorCode: true } });
  const analysisOf = (id: string) => db.tenderAnalysisRun.findUniqueOrThrow({ where: { id }, select: { status: true, errorCode: true, errorMessageSanitized: true, summaryJson: true, summaryText: true } });
  const eventsOf = (jobId: string, eventType: string, stepKey: string) =>
    db.agentRunEvent.findMany({ where: { runId: jobId, eventType, payload: { path: ["stepKey"], equals: stepKey } }, orderBy: { sequence: "asc" } });
  const failureNotes = (analysisRunId: string) => db.notification.count({ where: { orgId: ORG, type: "runtime_failed", entityType: "tender_analysis_run", entityId: analysisRunId } });
  async function slice(jobId: string, maxRounds: number) {
    await db.agentRun.updateMany({ where: { id: jobId, status: "queued" }, data: { nextAttemptAt: null } });
    return processWorkforceJobSlice(jobId, { maxRounds });
  }
  async function driveToTerminal(jobId: string, maxSlices = 12) {
    for (let i = 0; i < maxSlices; i++) {
      await slice(jobId, 6);
      const j = await jobOf(jobId);
      if (["completed", "failed", "cancelled", "needs_human", "partially_executed"].includes(j.status)) return j.status;
    }
    return (await jobOf(jobId)).status;
  }
  async function readBoth(jobId: string, projectId: string) {
    const v = await getWorkforceJobView({ orgId: ORG, jobId });
    if (!v.ok) throw new Error("job view not found");
    const card = await getTenderWorkforceAnalysisStatus({ orgId: ORG, projectId });
    return { view: v.view, card };
  }
  const leaks = (o: unknown) => LEAK_MARKERS.filter((m) => JSON.stringify(o).includes(m));

  try {
    setWorkforceSynthesisModelForTests(async () => {
      throw new Error(QUOTA_ERROR);
    });

    // —— 1. 余额不足：第 8 步两次失败 → 跳过 → 第 9 步终态化 ——
    console.log("\n[1 余额不足]");
    const a = await seedJob();
    const before = await analysisOf(a.analysisRunId);
    await slice(a.jobId, 1);
    const t8a1 = await stepOf(a.jobId, "t8_synthesis");
    ok(t8a1.status === "ready" && t8a1.attemptCount === 1 && t8a1.errorCode === "model_quota_exhausted", "第一次失败、还剩一次：回到待开始，尝试 1 次，错误码 model_quota_exhausted", { status: t8a1.status, attemptCount: t8a1.attemptCount, errorCode: t8a1.errorCode });
    const retryRead = await readBoth(a.jobId, a.projectId);
    const t8view = retryRead.view.tasks.find((t) => t.stepKey === "t8_synthesis") as { retry?: { attempt: number; maxRetries: number; reasonZh: string } } | undefined;
    ok(t8view?.retry?.attempt === 1 && t8view.retry.maxRetries === 1 && t8view.retry.reasonZh === QUOTA_ZH, "作业视图：第 8 步第 1 次重试、最多 1 次、原因余额不足", t8view?.retry);
    const expectRetry = `第 8 步〈Workforce 执行汇总〉正在第 1 次重试（最多重试 1 次）。上一次没成功：${QUOTA_ZH}`;
    const cardRetry = (retryRead.card.job as { retrying?: { stepIndex: number; stepTitle: string; attempt: number; maxRetries: number; reasonZh: string; sentenceZh: string } } | null)?.retrying;
    ok(retryRead.card.job?.status === "WORKING" && cardRetry?.stepIndex === 8 && cardRetry.stepTitle === "Workforce 执行汇总" && cardRetry.attempt === 1 && cardRetry.maxRetries === 1 && cardRetry.reasonZh === QUOTA_ZH && cardRetry.sentenceZh === expectRetry, "卡片接口：带第 8 步的重试信息与整句", cardRetry);
    ok(leaks(retryRead).length === 0, "作业接口与卡片接口里搜不到 quota / You exceeded / 错误码原文", leaks(retryRead));

    await slice(a.jobId, 1);
    const t8a2 = await stepOf(a.jobId, "t8_synthesis");
    ok(t8a2.status === "failed" && t8a2.attemptCount === 2 && t8a2.errorCode === "model_quota_exhausted", "第二次失败：最终失败，尝试 2 次（不因余额不足跳过重试）", { status: t8a2.status, attemptCount: t8a2.attemptCount });
    const blockedRead = await readBoth(a.jobId, a.projectId);
    const expectBlocked = `卡在第 8 步〈Workforce 执行汇总〉：${QUOTA_ZH}`;
    ok(blockedRead.view.status === "WORKING" && blockedRead.view.stopReason?.sentenceZh === expectBlocked, "两轮之间（进行中、有失败步骤）：作业视图带停止原因", blockedRead.view.stopReason);
    ok((blockedRead.card.job as { blockedReason?: string } | null)?.blockedReason === expectBlocked, "卡片接口：带受阻原因整句", blockedRead.card.job);

    const finalA = await driveToTerminal(a.jobId);
    const t8a = await stepOf(a.jobId, "t8_synthesis");
    const t9a = await stepOf(a.jobId, "t9_finalize_analysis");
    ok(t8a.status === "skipped" && t8a.errorCode === "model_quota_exhausted" && (t8a.errorMessage ?? "").includes("exceeded your current quota"), "第 8 步改为已跳过，原错误码与错误原文保留", { status: t8a.status, errorCode: t8a.errorCode });
    const out8 = (t8a.outputJson ?? {}) as Record<string, unknown>;
    const h8 = (out8.workforceHandoff ?? {}) as { summary?: string; warnings?: string[] };
    ok(out8.synthesisNotGenerated === true && out8.reasonCode === "model_quota_exhausted" && out8.degraded === undefined, "第 8 步产出带「未生成」标记与原因码，不带降级证据标记", out8);
    ok(h8.summary === "综合汇总未生成" && (h8.warnings ?? []).includes(`综合汇总未生成：${QUOTA_ZH}`), "第 8 步交接数据的话", h8);
    const skipEvents = await eventsOf(a.jobId, "step.completed", "t8_synthesis");
    ok(skipEvents.length === 1 && skipEvents[0].title === "Workforce 执行汇总（综合汇总未生成，已跳过）" && skipEvents[0].visibleToUser === true, "只有一条「综合汇总未生成，已跳过」的步骤完成事件（用户可见）", skipEvents.map((e) => e.title));
    const failedEvents = await eventsOf(a.jobId, "tool.failed", "t8_synthesis");
    ok(failedEvents.length === 2 && failedEvents.every((e) => (e.payload as { errorCode?: string }).errorCode === "model_quota_exhausted"), "tool.failed 事件 2 条，错误码都是 model_quota_exhausted", failedEvents.map((e) => e.payload));
    const out9 = (t9a.outputJson ?? {}) as Record<string, unknown>;
    ok(t9a.status === "completed" && out9.synthesisNotGenerated === true && out9.jobSummary === undefined && String(out9.summary ?? "").endsWith("；综合汇总未生成"), "第 9 步完成：返回值写明综合汇总未生成、不带 Job 级汇总", { status: t9a.status, out9: { synthesisNotGenerated: out9.synthesisNotGenerated, jobSummary: out9.jobSummary, summary: out9.summary } });
    const afterA = await analysisOf(a.analysisRunId);
    ok(afterA.status === "REVIEW_REQUIRED", "分析记录为待审阅", { status: afterA.status, errorCode: afterA.errorCode, reason: afterA.errorMessageSanitized });
    ok(JSON.stringify(afterA.summaryJson) === JSON.stringify(before.summaryJson) && afterA.summaryText === before.summaryText, "canonical summaryJson / summaryText 与执行前逐字节相同");
    ok(finalA === "completed", "Job 已完成", { status: finalA, errorCode: (await jobOf(a.jobId)).errorCode, t9: t9a.status });
    ok((await failureNotes(a.analysisRunId)) === 0, "没有「招标分析未能完成」的失败通知");
    const doneRead = await readBoth(a.jobId, a.projectId);
    const sng = (doneRead.view as { synthesisNotGenerated?: { stepIndex: number; stepTitle: string; reasonZh: string } }).synthesisNotGenerated;
    ok(sng?.stepIndex === 8 && sng.stepTitle === "Workforce 执行汇总" && sng.reasonZh === QUOTA_ZH, "作业视图：带「综合汇总未生成」及原因", sng);
    const cardSng = (doneRead.card.job as { synthesisNotGenerated?: { sentenceZh: string } } | null)?.synthesisNotGenerated;
    ok(doneRead.card.latestAnalysisRun?.status === "REVIEW_REQUIRED" && cardSng?.sentenceZh === `本次 AI 数字员工的综合汇总未生成：${QUOTA_ZH}。招标分析结果见下方。`, "卡片接口：带说明整句（只接「招标分析结果见下方。」）", cardSng);
    ok(!JSON.stringify(doneRead).includes("可照常审阅") && !JSON.stringify(doneRead).includes("不影响"), "不写「可照常审阅」「不影响」");
    ok(leaks(doneRead).length === 0, "完成后作业接口与卡片接口里也搜不到原始报错 / 错误码原文", leaks(doneRead));
    ok(doneRead.view.stopReason === undefined && (doneRead.card.job as { blockedReason?: string } | null)?.blockedReason === undefined, "已完成的 Job 不带停止原因");

    // —— 2. 中断回收：被强制结束（1/2）→ 回收留痕；再被强制结束（2/2）→ 长时间没有进展 → 跳过 ——
    console.log("\n[2 中断回收]");
    const b = await seedJob({ t8_synthesis: { status: "running", attemptCount: 1 } });
    await db.agentRun.update({ where: { id: b.jobId }, data: { status: "running", attempts: 1, leaseExpiresAt: new Date(Date.now() - 60_000) } });
    await slice(b.jobId, 0);
    const t8b1 = await stepOf(b.jobId, "t8_synthesis");
    ok(t8b1.status === "ready" && t8b1.attemptCount === 1 && t8b1.errorCode === "stale_running_recovered", "回收：待开始、尝试次数仍为 1、错误码 stale_running_recovered", { status: t8b1.status, attemptCount: t8b1.attemptCount, errorCode: t8b1.errorCode });
    const readyEvents = (await eventsOf(b.jobId, "step.ready", "t8_synthesis")).filter((e) => (e.payload as { recoveredFrom?: string }).recoveredFrom === "stale_running");
    ok(readyEvents.length === 1 && readyEvents[0].visibleToUser === false && (readyEvents[0].payload as { attempt?: number }).attempt === 1, "有一条用户不可见的 step.ready 事件，注明从中断里回收", readyEvents.map((e) => ({ v: e.visibleToUser, p: e.payload })));
    const bView = await getWorkforceJobView({ orgId: ORG, jobId: b.jobId });
    const b8 = bView.ok ? (bView.view.tasks.find((t) => t.stepKey === "t8_synthesis") as { retry?: { attempt: number; reasonZh: string } } | undefined) : undefined;
    ok(b8?.retry?.attempt === 1 && b8.retry.reasonZh === "上一次执行时间过长被中断", "作业视图：回收后显示第 1 次重试、原因「上一次执行时间过长被中断」", b8?.retry);
    await db.agentRunStep.updateMany({ where: { runId: b.jobId, stepKey: "t8_synthesis" }, data: { status: "running", attemptCount: 2, startedAt: new Date() } });
    await db.agentRun.update({ where: { id: b.jobId }, data: { status: "running", leaseExpiresAt: new Date(Date.now() - 60_000), nextAttemptAt: null } });
    const finalB = await driveToTerminal(b.jobId);
    const t8b = await stepOf(b.jobId, "t8_synthesis");
    ok(t8b.status === "skipped" && t8b.errorCode === "stale_running_exhausted", "两次被强制结束：记为长时间没有进展，随后改为已跳过", { status: t8b.status, errorCode: t8b.errorCode });
    ok((await stepOf(b.jobId, "t9_finalize_analysis")).status === "completed" && (await analysisOf(b.analysisRunId)).status === "REVIEW_REQUIRED" && finalB === "completed", "第 9 步完成，分析记录为待审阅，Job 已完成", finalB);
    const bDone = await getTenderWorkforceAnalysisStatus({ orgId: ORG, projectId: b.projectId });
    ok((bDone.job as { synthesisNotGenerated?: { reasonZh: string } } | null)?.synthesisNotGenerated?.reasonZh === "长时间没有进展", "卡片接口：原因「长时间没有进展」", bDone.job);

    // —— 3. 第 3 步失败照旧停下 ——
    console.log("\n[3 第 3 步失败]");
    const pendingRest = Object.fromEntries(["t4_evidence_compliance", "t5_risk_analysis", "t6_clarification_draft", "t7_build_deliverables"].map((k) => [k, { status: "pending" }]));
    const c = await seedJob({ t3_analyze_package_v2: { status: "failed", attemptCount: 2, errorCode: "tool_failed", errorMessage: "TOOL_FAILED: canonical V2 包级分析失败" }, ...pendingRest });
    const finalC = await driveToTerminal(c.jobId);
    const cSteps = await db.agentRunStep.findMany({ where: { runId: c.jobId }, select: { stepKey: true, status: true, attemptCount: true } });
    const downstream = cSteps.filter((s) => /^t[4-9]_/.test(s.stepKey));
    ok(downstream.length === 6 && downstream.every((s) => s.status === "pending" && s.attemptCount === 0), "第 4–9 步不开工", downstream);
    const cAnalysis = await analysisOf(c.analysisRunId);
    ok(finalC === "needs_human" && cAnalysis.status === "AGENT_FAILED", "Job 为需要人工处理，分析记录为「AI 分析未完成」", { finalC, status: cAnalysis.status });
    ok(cAnalysis.errorCode === "tool_failed" && cAnalysis.errorMessageSanitized === "卡在第 3 步〈Canonical V2 包级分析〉：工具执行失败", "分析记录的错误码取第 3 步自己的，原因写那一步", cAnalysis);

    // —— 4. 契约损坏不降级 ——
    console.log("\n[4 契约损坏]");
    const corruptT5 = (k: string, out: Record<string, unknown>) =>
      k === "t5_risk_analysis" ? { ...out, workforceHandoff: { ...(out.workforceHandoff as object), contractVersion: "workforce-handoff/v0" } } : out;
    const d = await seedJob({}, corruptT5);
    const finalD = await driveToTerminal(d.jobId);
    const t8d = await stepOf(d.jobId, "t8_synthesis");
    ok(t8d.status === "failed" && t8d.errorCode === "HANDOFF_VERSION_UNSUPPORTED", "上游第 5 步交接数据损坏：第 8 步保持失败，不改为已跳过", { status: t8d.status, errorCode: t8d.errorCode });
    ok(finalD === "needs_human" && (await eventsOf(d.jobId, "step.completed", "t8_synthesis")).length === 0, "Job 为需要人工处理，没有跳过事件", finalD);
    const dAnalysis = await analysisOf(d.analysisRunId);
    ok(dAnalysis.status === "AGENT_FAILED" && dAnalysis.errorMessageSanitized === "卡在第 8 步〈Workforce 执行汇总〉：执行出错", "契约损坏时原因写「执行出错」", dAnalysis);
    // 4b. 第 8 步本身是执行失败（可降级），但生成跳过交接数据时上游收不齐 → 保持失败
    const d2 = await seedJob({ t8_synthesis: { status: "failed", attemptCount: 2, errorCode: "synthesis_failed", errorMessage: "SYNTHESIS_INVALID_OUTPUT: 模型未返回 JSON 结构化综合结果" } }, corruptT5);
    const finalD2 = await driveToTerminal(d2.jobId);
    const t8d2 = await stepOf(d2.jobId, "t8_synthesis");
    ok(t8d2.status === "failed" && t8d2.errorCode === "synthesis_failed" && finalD2 === "needs_human", "跳过所需的上游交接数据收不齐：第 8 步保持失败，Job 需要人工处理", { status: t8d2.status, finalD2 });
    ok((await analysisOf(d2.analysisRunId)).errorMessageSanitized === "卡在第 8 步〈Workforce 执行汇总〉：综合汇总生成失败", "原因写第 8 步自己的「综合汇总生成失败」，不写「前置步骤没有完成」");

    // —— 5. 第 9 步：依赖里什么都没有 / 旧兼容模式 ——
    console.log("\n[5 第 9 步输入]");
    const e = await seedJob();
    const t3out = ((await stepOf(e.jobId, "t3_analyze_package_v2")).outputJson ?? {}) as Record<string, unknown>;
    const ctx = (prior: Record<string, unknown>) => ({ orgId: ORG, userId: OWNER, role: "sales", runId: e.jobId, stepKey: "t9_finalize_analysis", operationKey: `op_fix20_${seq}`, priorEvidence: prior });
    const nothing = await executeRuntimeV2Tool("tender_finalize_analysis", ctx({ t1_validate_input: e.manifest, t3_analyze_package_v2: t3out, t8_synthesis: { reasonCode: "x" } }));
    ok(!nothing.ok && (nothing.error ?? "").startsWith("INPUT_MISSING: 未在声明依赖中找到综合汇总结果"), "依赖里既没有综合结果也没有跳过标记 → 输入缺失", nothing);
    const v1 = await executeRuntimeV2Tool("tender_finalize_analysis", ctx({ t1_validate_input: e.manifest, t8_synthesis: { synthesisNotGenerated: true } }));
    ok(!v1.ok && (v1.error ?? "").startsWith("INPUT_MISSING: 未在声明依赖中找到综合汇总结果"), "旧兼容模式（没有 canonical V2 证据）照旧要求综合结果", v1);
    ok((await analysisOf(e.analysisRunId)).status === "AGENT_ANALYZING", "两次输入缺失都没有改动分析记录");
  } finally {
    setWorkforceSynthesisModelForTests(null);
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.agentRunEvent.deleteMany({ where: { runId: { in: jobIds } } }).catch(() => undefined);
    await db.agentRunVerification.deleteMany({ where: { runId: { in: jobIds } } }).catch(() => undefined);
    await db.agentRunStep.deleteMany({ where: { runId: { in: jobIds } } }).catch(() => undefined);
    await db.capabilityQuotaReservation.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.agentRun.deleteMany({ where: { id: { in: jobIds } } }).catch(() => undefined);
    await db.agentSession.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: ORG } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [OWNER, LEAD] } } }).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(`\nFIX-20 synthesis degrade DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
