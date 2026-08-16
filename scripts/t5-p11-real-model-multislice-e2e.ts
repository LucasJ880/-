/**
 * T5-P1.1 §39 — 真实模型 · 多 invocation 可续跑 E2E（隔离实库）
 *
 * 走**生产入口**：processQueuedWorkforceJobs(limit, { executionBudget })，
 * 即 /api/cron/agent-runs 调的同一个函数；预算用**生产值**
 * AGENT_RUNS_INVOCATION_BUDGET_MS = 240s，不为了制造让出而调小。
 *
 * 每轮循环 = 一次独立 serverless invocation：重新计算绝对 deadline，
 * 并等过 CONTINUATION_DELAY_MS 让 job 重新进入可认领窗口（与 cron 节拍等价）。
 *
 * 零 mock：真实模型、真实 canonical 落库、真实投影与终态化。
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     ANTHROPIC_API_KEY=... npx tsx scripts/t5-p11-real-model-multislice-e2e.ts <projectId>
 */

import { db } from "@/lib/db";
import { AGENT_RUNS_INVOCATION_BUDGET_MS } from "@/lib/workforce-runtime/constants";
import { parseV2Cursor } from "@/lib/tender-auto-analysis/v2-cursor";

const projectId = process.argv[2];
if (!projectId) throw new Error("用法：t5-p11-real-model-multislice-e2e.ts <projectId>");

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const log = (m: string, x?: unknown) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}` + (x ? ` ${JSON.stringify(x)}` : ""));

function assertIsolated(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置");
  if (/ep-super-field-antfibsl/.test(url)) throw new Error("拒绝在生产库上运行（fail-closed）");
  if (process.env.DATABASE_ENVIRONMENT !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT 必须为 isolated");
  }
}

async function main() {
  assertIsolated();
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, orgId: true, ownerId: true, workDomain: true },
  });
  const orgId = project.orgId!;
  const owner = await db.user.findUniqueOrThrow({
    where: { id: project.ownerId },
    select: { id: true, role: true },
  });
  const pages = await db.projectDocumentPage.count({
    where: { document: { projectId } },
  });
  log(`project=${project.name} domain=${project.workDomain} pages=${pages}`);
  log(`每次 invocation 预算 = ${AGENT_RUNS_INVOCATION_BUDGET_MS}ms（生产值，未调小）`);

  const { startTenderWorkforceAnalysis } = await import(
    "@/lib/tender-workforce/trigger-service"
  );
  const started = await startTenderWorkforceAnalysis({
    orgId, projectId, projectName: project.name, userId: owner.id,
    role: owner.role, requestId: `t5p11-${Date.now()}`, restart: true,
  });
  if (!started.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
  const jobId = started.jobId;
  log("job started", { jobId });

  const { processQueuedWorkforceJobs } = await import(
    "@/lib/workforce-runtime/processor"
  );

  const t0 = Date.now();
  let invocations = 0;
  let terminal = "";
  const t3StepStates: string[] = [];

  for (let i = 0; i < 30; i++) {
    invocations += 1;
    // ── 一次独立的 serverless invocation：绝对 deadline 从"请求起点"算 ──
    const requestStartedAt = Date.now();
    const executionBudget = {
      deadlineAt: requestStartedAt + AGENT_RUNS_INVOCATION_BUDGET_MS,
      tickBudgetMs: AGENT_RUNS_INVOCATION_BUDGET_MS,
    };
    const r = await processQueuedWorkforceJobs(2, { executionBudget });

    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true, attempts: true, errorCode: true },
    });
    const t3 = await db.agentRunStep.findFirst({
      where: { runId: jobId, stepKey: { contains: "analyze_package_v2" } },
      select: { stepKey: true, status: true, attemptCount: true },
    });
    if (t3) t3StepStates.push(`${t3.status}/${t3.attemptCount}`);

    const domainRun = await db.tenderAnalysisRun.findFirst({
      where: { orgId, projectId, analysisVersion: "tender-workforce-analysis-v1" },
      orderBy: { createdAt: "desc" },
      select: { workerCursor: true, status: true },
    });
    const cur = domainRun?.workerCursor as { phase?: string; ticks?: number } | null;

    log(`invocation ${i} (${Math.round((Date.now() - requestStartedAt) / 1000)}s)`, {
      processed: r.processed, run: run.status, attempts: run.attempts,
      t3: t3 ? `${t3.status}/att=${t3.attemptCount}` : null,
      cursor: cur ? `${cur.phase}#${cur.ticks}` : null,
      domain: domainRun?.status,
    });

    if (["completed", "failed", "cancelled", "needs_human", "awaiting_approval"].includes(run.status)) {
      terminal = run.status;
      break;
    }
    if (Date.now() - t0 > 60 * 60_000) { terminal = `TIMEOUT:${run.status}`; break; }
    await new Promise((res) => setTimeout(res, 3_000)); // > CONTINUATION_DELAY_MS
  }

  /* ─────────────────────────── 判定 ─────────────────────────── */
  console.log("");
  const events = await db.agentRunEvent.findMany({
    where: { runId: jobId },
    select: { eventType: true, payload: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const yieldEvents = events.filter((e) => e.eventType === "tool.yielded");
  const t3Yields = yieldEvents.filter((e) => {
    const p = (e.payload ?? {}) as { stepKey?: string };
    return (p.stepKey ?? "").includes("analyze_package_v2");
  });

  ok(
    t3Yields.length >= 2,
    `P39-01: 真实模型下 t3 让出 ${t3Yields.length} 次 ≥ 2（生产预算 240s 下确实跨 invocation）`,
    yieldEvents.map((e) => (e.payload as Record<string, unknown>)?.stepKey),
  );
  ok(
    invocations >= 3,
    `P39-02: 总 invocation 数 = ${invocations} ≥ 3（t3 让出 + 后续步骤）`,
  );
  ok(terminal === "completed", `P39-03: Job 终态 = completed（实得 ${terminal}）`);

  const steps = await db.agentRunStep.findMany({
    where: { runId: jobId },
    select: { stepKey: true, status: true, attemptCount: true, errorCode: true },
    orderBy: { createdAt: "asc" },
  });
  const t3 = steps.find((s) => s.stepKey.includes("analyze_package_v2"));
  ok(t3?.status === "completed", `P39-04: t3 最终 completed（实得 ${t3?.status}）`);
  ok(
    (t3?.attemptCount ?? 99) <= 1,
    `P39-05: t3 attemptCount = ${t3?.attemptCount} ≤ 1（${t3Yields.length} 次让出未消耗重试预算）`,
    t3StepStates,
  );
  ok(
    steps.every((s) => s.status === "completed" || s.status === "skipped"),
    "P39-06: 全部步骤 completed/skipped（无残留 failed）",
    steps.map((s) => `${s.stepKey}:${s.status}${s.errorCode ? `(${s.errorCode})` : ""}`),
  );

  const domainRun = await db.tenderAnalysisRun.findFirstOrThrow({
    where: { orgId, projectId, analysisVersion: "tender-workforce-analysis-v1" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, model: true, workerCursor: true,
      summaryJson: true, sourceHashFingerprint: true,
    },
  });
  const counts = await db.$transaction([
    db.tenderAnalysisFact.count({ where: { runId: domainRun.id } }),
    db.tenderExtractedRequirement.count({ where: { analysisRunId: domainRun.id } }),
    db.tenderAnalysisSection.count({ where: { analysisRunId: domainRun.id } }),
  ]);
  ok(
    counts[1] > 0 && counts[2] > 0,
    `P39-07: canonical 已落库（facts=${counts[0]} requirements=${counts[1]} sections=${counts[2]}）`,
  );
  ok(
    domainRun.status === "REVIEW_REQUIRED",
    `P39-08: 域终态 = REVIEW_REQUIRED（实得 ${domainRun.status}）`,
  );
  ok(
    domainRun.model !== null && !/scripted|mock|fake/i.test(domainRun.model),
    `P39-09: 真实模型（model=${domainRun.model}）`,
  );

  /* ── 关键反例：跨 invocation 有没有重算已完成的窗口 ── */
  const cursor = parseV2Cursor(domainRun.workerCursor, domainRun.sourceHashFingerprint ?? "");
  const raw = domainRun.workerCursor as {
    windows?: { outputs?: Record<string, unknown>; failures?: Record<string, unknown> };
    logs?: { promptName: string; ok: boolean }[];
    clarify?: { resolutions?: Record<string, unknown> };
  } | null;
  const windowCount = Object.keys(raw?.windows?.outputs ?? {}).length;
  const failureCount = Object.keys(raw?.windows?.failures ?? {}).length;
  const resolutionCount = Object.keys(raw?.clarify?.resolutions ?? {}).length;
  const logs = raw?.logs ?? [];
  const extractOk = logs.filter((l) => l.promptName.includes("extract") && l.ok).length;
  const extractFail = logs.filter((l) => l.promptName.includes("extract") && !l.ok).length;

  ok(
    cursor !== null,
    `P39-10: 终局 cursor 仍可解析（指纹一致，phase=${raw && (raw as { phase?: string }).phase}）`,
  );
  ok(
    extractOk === windowCount && failureCount === 0,
    `P39-11: DUPLICATE_SUCCESSFUL_WINDOW_LLM_CALLS = 0` +
      `（成功抽取调用 ${extractOk} = 窗口数 ${windowCount}，失败 ${extractFail}，永久排除 ${failureCount}）`,
  );
  ok(
    (raw as { analyst?: { passAAttempts?: number; passBAttempts?: number } } | null)?.analyst
      ?.passAAttempts === 1,
    `P39-12: Analyst PASS A 尝试 1 次（跨 invocation 未重跑长调用）`,
    (raw as { analyst?: unknown } | null)?.analyst,
  );

  const sj = (domainRun.summaryJson ?? {}) as Record<string, unknown>;
  ok(
    sj.analystSynthesis != null,
    "P39-13: Analyst 中文综合层已落 summaryJson（跨切片后语义未丢）",
  );

  console.log(
    "\nRESULT_JSON " +
      JSON.stringify({
        gate: "T5-P1.1-§39",
        projectId, jobId, invocations, terminal,
        t3Yields: t3Yields.length,
        t3AttemptCount: t3?.attemptCount,
        windowCount, extractOk, extractFail, failureCount, resolutionCount,
        counts: { facts: counts[0], requirements: counts[1], sections: counts[2] },
        model: domainRun.model,
        domainStatus: domainRun.status,
        elapsedS: Math.round((Date.now() - t0) / 1000),
      }),
  );
  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("E2E_ERROR", e instanceof Error ? e.stack : e);
  await db.$disconnect();
  process.exit(1);
});
