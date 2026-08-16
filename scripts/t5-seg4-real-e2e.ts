/**
 * T5-P1 Segment 4 — 真实模型 E2E（隔离生产快照分支专用）
 *
 * 走**真实入口**：startTenderWorkforceAnalysis（API route 在鉴权后调用的同一函数）
 * → 确定性 server plan → Workforce Job → 真实 cron slice 循环
 * → 真实 canonical V2 推理（真模型）→ 投影 → 真实 native synthesis → canonical 终态化。
 *
 * 零 mock：不打桩模型、不预写 canonical 结果、不绕过 legacy orchestrator。
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/t5-seg4-real-e2e.ts <projectId> [--legacy]
 *     默认         = Workforce 确定性 canonical V2 路径
 *     --legacy     = legacy full V2 路径（analyzeAndPersistV2 编排），用于 parity A 路
 *
 * 结束打印结构化 JSON（供 parity 比对脚本消费）。绝不修改生产。
 */

import { db } from "@/lib/db";

const projectId = process.argv[2];
const LEGACY = process.argv.includes("--legacy");
/** 只收集既有 Job 的结果（不重跑昂贵分析） */
const REPORT_ONLY = process.argv.find((a) => a.startsWith("--report="))?.slice(9) ?? null;
if (!projectId) {
  console.error("usage: t5-seg4-real-e2e.ts <projectId> [--legacy]");
  process.exit(1);
}

function log(msg: string, extra?: unknown) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`, extra === undefined ? "" : JSON.stringify(extra));
}

/** 归一化快照：用于证明 finalize 未改写 canonical 语义 */
function snapshot(summaryJson: unknown, summaryText: string | null) {
  const sj = (summaryJson ?? {}) as Record<string, unknown>;
  return {
    json: JSON.stringify(sj),
    summaryText,
    checklist: JSON.stringify(sj.submissionChecklist ?? null),
    analystSynthesis: JSON.stringify(sj.analystSynthesis ?? null),
    brief: JSON.stringify(sj.brief ?? null),
    criticalFacts: JSON.stringify(sj.criticalFacts ?? null),
    conflicts: JSON.stringify(sj.conflicts ?? null),
    evidenceCoverage: JSON.stringify(sj.evidenceCoverage ?? null),
  };
}

async function canonicalCounts(runId: string) {
  const [facts, requirements, sourceRefs, sections, clarifications, changes, deliverables] =
    await Promise.all([
      db.tenderAnalysisFact.count({ where: { runId } }),
      db.tenderExtractedRequirement.count({ where: { analysisRunId: runId } }),
      db.tenderAnalysisSourceRef.count({ where: { runId } }),
      db.tenderAnalysisSection.count({ where: { runId } }),
      db.tenderClarificationQuestion.count({ where: { analysisRunId: runId } }),
      db.tenderAnalysisChangeCandidate.count({ where: { runId } }),
      db.tenderDeliverable.count({ where: { analysisRunId: runId } }),
    ]);
  return { facts, requirements, sourceRefs, sections, clarifications, changes, deliverables };
}


type DocInfo = { id: string; title: string; contentHash: string | null; pageCount: number | null; parseStatus: string };

async function report(
  jobId: string,
  orgId: string,
  docs: DocInfo[],
  preFinalize: (ReturnType<typeof snapshot> & { status: string }) | null,
  extra?: { slices?: number; terminal?: string; meta?: Record<string, unknown> },
) {
  const job = await db.agentRun.findUniqueOrThrow({ where: { id: jobId } });
  const steps = await db.agentRunStep.findMany({
    where: { runId: jobId },
    orderBy: { createdAt: "asc" },
    select: {
      stepKey: true, status: true, preferredTool: true, attemptCount: true,
      startedAt: true, completedAt: true, errorCode: true, errorMessage: true,
      outputJson: true, inputJson: true,
    },
  });
  const events = await db.agentRunEvent.findMany({
    where: { runId: jobId },
    select: { eventType: true, payload: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const verifications = await db.agentRunVerification.findMany({
    where: { runId: jobId },
    orderBy: { createdAt: "asc" },
    select: {
      attempt: true,
      verdict: true,
      summary: true,
      satisfiedCriteriaJson: true,
      unsatisfiedCriteriaJson: true,
      evidenceReferencesJson: true,
    },
  });

  // canonical 域 run
  const domainRun = await db.tenderAnalysisRun.findFirst({
    where: { orgId, projectId, analysisVersion: "tender-workforce-analysis-v1" },
    orderBy: { createdAt: "desc" },
  });
  const counts = domainRun ? await canonicalCounts(domainRun.id) : null;
  const sj = (domainRun?.summaryJson ?? {}) as Record<string, unknown>;

  const t3 = steps.find((s) => s.stepKey === "t3_analyze_package_v2");
  const t3Duration =
    t3?.startedAt && t3?.completedAt
      ? t3.completedAt.getTime() - t3.startedAt.getTime()
      : null;
  const renewals = events.filter((e) => e.eventType === "job.lease_renewed").length;

  const t3Out = (t3?.outputJson ?? {}) as Record<string, unknown>;
  const deliverables = domainRun
    ? await db.tenderDeliverable.findMany({
        where: { analysisRunId: domainRun.id },
        select: { deliverableKey: true, title: true, mandatory: true, sourcePage: true },
      })
    : [];

  console.log(
    "\nRESULT_JSON " +
      JSON.stringify({
        path: "WORKFORCE_DETERMINISTIC_V2",
        projectId,
        jobId,
        terminal: extra?.terminal ?? job.status,
        jobStatus: job.status,
        jobErrorCode: job.errorCode,
        jobErrorMessage: (job.errorMessage ?? "").slice(0, 300),
        slices: extra?.slices ?? null,
        planSource: (extra?.meta ?? metaOf(job.metadata)).planSource,
        planTaskCount: (extra?.meta ?? metaOf(job.metadata)).planTaskCount,
        plannerLlmCalls: (extra?.meta ?? metaOf(job.metadata)).plannerLlmCalls,
        planContractVersion: (extra?.meta ?? metaOf(job.metadata)).planContractVersion,
        taskContractVersion: (extra?.meta ?? metaOf(job.metadata)).taskContractVersion,
        steps: steps.map((s) => ({
          key: s.stepKey,
          status: s.status,
          tool: s.preferredTool,
          worker: ((s.inputJson ?? {}) as Record<string, unknown>).workerKey ?? null,
          attempts: s.attemptCount,
          durationMs:
            s.startedAt && s.completedAt
              ? s.completedAt.getTime() - s.startedAt.getTime()
              : null,
          errorCode: s.errorCode,
          error: (s.errorMessage ?? "").slice(0, 200),
        })),
        verifications,
        t3DurationMs: t3Duration,
        leaseRenewals: renewals,
        lostLeaseEvents: events.filter((e) =>
          JSON.stringify(e.payload ?? {}).includes("LOST_LEASE"),
        ).length,
        t3Telemetry: {
          llmCalls: t3Out.llmCalls,
          llmFailures: t3Out.llmFailures,
          model: t3Out.model,
          canonicalPersisted: t3Out.canonicalPersisted,
          semanticEngine: t3Out.semanticEngine,
          factCount: t3Out.factCount,
          requirementCount: t3Out.requirementCount,
          clarificationCount: t3Out.clarificationCount,
          sectionCount: t3Out.sectionCount,
        },
        domainRunId: domainRun?.id ?? null,
        domainStatus: domainRun?.status ?? null,
        domainModel: domainRun?.model ?? null,
        checklistState:
          sj.submissionChecklist === undefined
            ? "MISSING"
            : Array.isArray(sj.submissionChecklist)
              ? `[${(sj.submissionChecklist as unknown[]).length}]`
              : "OTHER",
        checklist: Array.isArray(sj.submissionChecklist)
          ? (sj.submissionChecklist as Array<Record<string, unknown>>).map((c) => ({
              requirementId: c.requirementId,
              statement: String(c.statement ?? "").slice(0, 120),
            }))
          : null,
        summaryJsonKeys: Object.keys(sj),
        counts,
        deliverables,
        // §7 finalize 保全实证（before = t9 完成前最后一次快照）
        finalizePreservation: preFinalize
          ? (() => {
              const after = snapshot(domainRun?.summaryJson, domainRun?.summaryText ?? null);
              return {
                beforeStatus: preFinalize.status,
                afterStatus: domainRun?.status ?? null,
                summaryJsonIdentical: preFinalize.json === after.json,
                summaryTextIdentical: preFinalize.summaryText === after.summaryText,
                checklistIdentical: preFinalize.checklist === after.checklist,
                analystSynthesisIdentical:
                  preFinalize.analystSynthesis === after.analystSynthesis,
                briefIdentical: preFinalize.brief === after.brief,
                criticalFactsIdentical: preFinalize.criticalFacts === after.criticalFacts,
                conflictsIdentical: preFinalize.conflicts === after.conflicts,
                evidenceCoverageIdentical:
                  preFinalize.evidenceCoverage === after.evidenceCoverage,
              };
            })()
          : null,
        documents: docs.map((d) => ({ id: d.id, hash: d.contentHash, pages: d.pageCount })),
      }),
  );
}

function metaOf(m: unknown): Record<string, unknown> {
  return (m ?? {}) as Record<string, unknown>;
}

async function main() {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, orgId: true, ownerId: true, workDomain: true },
  });
  const orgId = project.orgId!;
  const owner = await db.user.findUniqueOrThrow({
    where: { id: project.ownerId },
    select: { id: true, role: true, email: true },
  });
  log(`project=${project.name} org=${orgId} owner=${owner.id} domain=${project.workDomain}`);

  const docs = await db.projectDocument.findMany({
    where: { projectId },
    select: { id: true, title: true, contentHash: true, pageCount: true, parseStatus: true },
    orderBy: { createdAt: "asc" },
  });
  const pages = await db.projectDocumentPage.count({
    where: { documentId: { in: docs.map((d) => d.id) } },
  });
  log(`documents=${docs.length} parsedPages=${pages}`);

  /* ══════════════ A 路：legacy full V2 编排 ══════════════ */
  if (LEGACY) {
    // 走 legacy 的真实"重新分析"入口：同一 package（同文档、同 hash），
    // 但强制建立**独立的 legacy run**——enqueue 会按 package fingerprint
    // 幂等复用已存在的分析（实测会直接复用 Workforce 产出的 canonical run），
    // 那样就没有可比对的 A 路了。
    const { reanalyzeTenderPackage } = await import(
      "@/lib/tender-auto-analysis/enqueue-package"
    );
    const enq = await reanalyzeTenderPackage({
      orgId,
      projectId,
      actorUserId: owner.id,
    });
    log("legacy reanalyze", enq);
    const runId = (enq as { newRunId?: string }).newRunId;
    if (!runId) throw new Error(`legacy reanalyze failed: ${JSON.stringify(enq)}`);

    const { processQueuedTenderAnalysisRuns } = await import(
      "@/lib/tender-auto-analysis/worker"
    );
    const started = Date.now();
    for (let i = 0; i < 60; i++) {
      const r = await processQueuedTenderAnalysisRuns(1);
      const row = await db.tenderAnalysisRun.findUniqueOrThrow({
        where: { id: runId },
        select: { status: true, workerStep: true, errorCode: true },
      });
      log(`legacy slice ${i}`, { slice: r, status: row.status, step: row.workerStep });
      if (["REVIEW_REQUIRED", "APPROVED", "FAILED"].includes(row.status)) break;
      if (Date.now() - started > 30 * 60_000) break;
    }
    const run = await db.tenderAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
    const counts = await canonicalCounts(runId);
    const sj = (run.summaryJson ?? {}) as Record<string, unknown>;
    console.log(
      "\nRESULT_JSON " +
        JSON.stringify({
          path: "LEGACY_FULL_V2",
          projectId,
          runId,
          status: run.status,
          model: run.model,
          promptVersion: run.promptVersion,
          analysisVersion: run.analysisVersion,
          errorCode: run.errorCode,
          counts,
          checklistState: sj.submissionChecklist === undefined
            ? "MISSING"
            : Array.isArray(sj.submissionChecklist)
              ? `[${(sj.submissionChecklist as unknown[]).length}]`
              : "OTHER",
          summaryJsonKeys: Object.keys(sj),
          documents: docs.map((d) => ({ id: d.id, hash: d.contentHash, pages: d.pageCount })),
        }),
    );
    await db.$disconnect();
    return;
  }

  /* ══════════════ B 路：确定性 Workforce canonical V2 ══════════════ */
  if (REPORT_ONLY) {
    await report(REPORT_ONLY, orgId, docs, null);
    await db.$disconnect();
    return;
  }

  const { startTenderWorkforceAnalysis } = await import(
    "@/lib/tender-workforce/trigger-service"
  );
  const started = await startTenderWorkforceAnalysis({
    orgId,
    projectId,
    projectName: project.name,
    userId: owner.id,
    role: owner.role,
    requestId: `t5seg4-${Date.now()}`,
    restart: true,
  });
  log("startTenderWorkforceAnalysis", started);
  if (!started.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
  const jobId = started.jobId;

  const jobRow = await db.agentRun.findUniqueOrThrow({
    where: { id: jobId },
    select: { metadata: true, planJson: true },
  });
  const meta = (jobRow.metadata ?? {}) as Record<string, unknown>;
  log("job metadata", {
    planSource: meta.planSource,
    planTaskCount: meta.planTaskCount,
    plannerLlmCalls: meta.plannerLlmCalls,
    workDomain: meta.workDomain,
    planContractVersion: meta.planContractVersion,
  });

  const { processWorkforceJobSlice } = await import(
    "@/lib/workforce-runtime/processor"
  );

  const t0 = Date.now();
  let slices = 0;
  let preFinalize: (ReturnType<typeof snapshot> & { status: string }) | null = null;
  let terminal = "";
  for (let i = 0; i < 60; i++) {
    slices += 1;
    const r = await processWorkforceJobSlice(jobId, { sliceBudgetMs: 240_000, maxRounds: 6 });
    const row = await db.agentRun.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true, errorCode: true, errorMessage: true },
    });
    const steps = await db.agentRunStep.findMany({
      where: { runId: jobId },
      select: { stepKey: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    log(`slice ${i}`, {
      claimed: (r as { claimed: boolean }).claimed,
      sliceStatus: (r as { status?: string }).status,
      run: row.status,
      steps: steps.map((s) => `${s.stepKey}:${s.status}`).join(","),
    });
    // §7：t9 完成之前持续刷新 canonical 快照——最后一次即真实的 "finalize 前" 状态
    const t9done = steps.some(
      (s) => s.stepKey === "t9_finalize_analysis" && s.status === "completed",
    );
    if (!t9done) {
      const dr = await db.tenderAnalysisRun.findFirst({
        where: { orgId, projectId, analysisVersion: "tender-workforce-analysis-v1" },
        orderBy: { createdAt: "desc" },
        select: { summaryJson: true, summaryText: true, status: true },
      });
      if (dr?.summaryJson) {
        preFinalize = { ...snapshot(dr.summaryJson, dr.summaryText), status: dr.status };
      }
    }
    if (["completed", "failed", "cancelled", "needs_human", "awaiting_approval"].includes(row.status)) {
      terminal = row.status;
      break;
    }
    if (Date.now() - t0 > 45 * 60_000) {
      terminal = `TIMEOUT:${row.status}`;
      break;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }

  await report(jobId, orgId, docs, preFinalize, { slices, terminal, meta });
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("E2E_ERROR", e instanceof Error ? e.stack : e);
  await db.$disconnect();
  process.exit(1);
});
