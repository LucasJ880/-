/**
 * T5-P1.1 §40–§50 — **真实 Vercel Preview serverless** 跨 invocation 可续跑 E2E
 *
 * 这是 P1.1 最重要的一道门：本地循环再多次也只是同一个进程，证明不了
 * 「serverless 硬杀之后还能续」。这里每一次推进都是一次**真实 HTTP invocation**：
 *   GET {preview}/api/cron/agent-runs  （Bearer CRON_SECRET，生产同一路由）
 * 进程在两次 tick 之间彻底结束——续跑信息只能来自 DB 里的 workerCursor。
 *
 * 前置（Preview 作用域，绝不改生产）：
 *   - Preview DATABASE_URL/DIRECT_URL → 隔离 Neon 分支（与本脚本同一个库）
 *   - Preview flags：WORKFORCE_RUNTIME_ENABLED / 允许名单 /
 *     TENDER_WORKFORCE_ANALYSIS_ENABLED / TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED /
 *     AGENT_RUNTIME_V2_MAX_STEPS≥9
 *   - Preview 模型凭证（OPENAI_*）
 *
 * 用法：
 *   DATABASE_URL=<隔离分支> DIRECT_URL=<同上> DATABASE_ENVIRONMENT=isolated \
 *   CRON_SECRET=... npx tsx scripts/t5-p11-preview-serverless-e2e.ts <projectId> --base=https://<preview>
 */

import { db } from "@/lib/db";

const projectId = process.argv[2];
const base = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
const secret = process.env.CRON_SECRET;
if (!projectId || !base) {
  throw new Error("用法：t5-p11-preview-serverless-e2e.ts <projectId> --base=<previewUrl>");
}
if (!secret) throw new Error("CRON_SECRET 未设置");

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

type Tick = {
  i: number;
  httpStatus: number;
  elapsedMs: number;
  body: string;
  cursorPhase: string | null;
  cursorTicks: number | null;
  runStatus: string;
  t3: string | null;
};

async function main() {
  assertIsolated();
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, orgId: true, ownerId: true },
  });
  const orgId = project.orgId!;
  const owner = await db.user.findUniqueOrThrow({
    where: { id: project.ownerId }, select: { id: true, role: true },
  });
  log(`preview=${base} project=${project.name}`);

  // Job 由同一份代码、同一个隔离库创建；**推进全部**交给真实 serverless invocation。
  const { startTenderWorkforceAnalysis } = await import(
    "@/lib/tender-workforce/trigger-service"
  );
  const started = await startTenderWorkforceAnalysis({
    orgId, projectId, projectName: project.name, userId: owner.id,
    role: owner.role, requestId: `t5p11-preview-${Date.now()}`, restart: true,
  });
  if (!started.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
  const jobId = started.jobId;
  log("job started", { jobId });

  const ticks: Tick[] = [];
  let terminal = "";
  const t0 = Date.now();

  for (let i = 0; i < 40; i++) {
    const at = Date.now();
    let httpStatus = 0;
    let body = "";
    try {
      const res = await fetch(`${base}/api/cron/agent-runs`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      httpStatus = res.status;
      body = (await res.text()).slice(0, 400);
    } catch (e) {
      body = `FETCH_ERROR:${e instanceof Error ? e.message : String(e)}`;
    }
    const elapsedMs = Date.now() - at;

    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: jobId }, select: { status: true, attempts: true },
    });
    const t3 = await db.agentRunStep.findFirst({
      where: { runId: jobId, stepKey: { contains: "analyze_package_v2" } },
      select: { status: true, attemptCount: true },
    });
    const domainRun = await db.tenderAnalysisRun.findFirst({
      where: { orgId, projectId, analysisVersion: "tender-workforce-analysis-v1" },
      orderBy: { createdAt: "desc" },
      select: { workerCursor: true },
    });
    const cur = domainRun?.workerCursor as { phase?: string; ticks?: number } | null;

    const tick: Tick = {
      i, httpStatus, elapsedMs, body,
      cursorPhase: cur?.phase ?? null,
      cursorTicks: cur?.ticks ?? null,
      runStatus: run.status,
      t3: t3 ? `${t3.status}/att=${t3.attemptCount}` : null,
    };
    ticks.push(tick);
    log(`tick ${i} http=${httpStatus} ${Math.round(elapsedMs / 1000)}s`, {
      run: run.status, t3: tick.t3, cursor: `${tick.cursorPhase}#${tick.cursorTicks}`,
    });

    if (["completed", "failed", "cancelled", "needs_human", "awaiting_approval"].includes(run.status)) {
      terminal = run.status;
      break;
    }
    if (Date.now() - t0 > 60 * 60_000) { terminal = `TIMEOUT:${run.status}`; break; }
    await new Promise((r) => setTimeout(r, 4_000));
  }

  /* ─────────────────────────── 判定 ─────────────────────────── */
  console.log("");
  const events = await db.agentRunEvent.findMany({
    where: { runId: jobId },
    select: { eventType: true, payload: true },
    orderBy: { createdAt: "asc" },
  });
  const t3Yields = events.filter(
    (e) =>
      e.eventType === "tool.yielded" &&
      ((e.payload ?? {}) as { stepKey?: string }).stepKey?.includes("analyze_package_v2"),
  );
  // t3 真正被推进过的 HTTP invocation 数 = 让出次数 + 最终完成的那一次
  const t3HttpInvocations = t3Yields.length + 1;

  ok(
    ticks.every((t) => t.httpStatus === 200),
    "P40-01: 全部 cron tick HTTP 200（无 504 / FUNCTION_INVOCATION_TIMEOUT）",
    ticks.filter((t) => t.httpStatus !== 200).map((t) => `${t.i}:${t.httpStatus}:${t.body}`),
  );
  ok(
    ticks.every((t) => t.elapsedMs < 300_000),
    `P40-02: 每次 invocation 均在 maxDuration=300s 内返回（最长 ${Math.max(...ticks.map((t) => Math.round(t.elapsedMs / 1000)))}s）`,
  );
  ok(
    t3HttpInvocations >= 2,
    `P40-03: T3_HTTP_INVOCATIONS = ${t3HttpInvocations} ≥ 2（t3 真的跨越了独立 serverless invocation）`,
  );
  ok(terminal === "completed", `P40-04: Job 终态 = completed（实得 ${terminal}）`);

  const cursorTicks = ticks.map((t) => t.cursorTicks).filter((x): x is number => x !== null);
  ok(
    cursorTicks.every((v, i) => i === 0 || v >= cursorTicks[i - 1]!),
    `P40-05: cursor ticks 跨 invocation 单调不减 [${cursorTicks.join(",")}]`,
  );
  const phases = ticks.map((t) => t.cursorPhase).filter(Boolean);
  ok(
    new Set(phases).size >= 2,
    `P40-06: cursor phase 跨 invocation 推进 [${Array.from(new Set(phases)).join(" → ")}]`,
  );

  const steps = await db.agentRunStep.findMany({
    where: { runId: jobId },
    select: { stepKey: true, status: true, attemptCount: true, errorCode: true },
    orderBy: { createdAt: "asc" },
  });
  const t3 = steps.find((s) => s.stepKey.includes("analyze_package_v2"));
  ok(
    (t3?.attemptCount ?? 99) <= 1,
    `P40-07: t3 attemptCount = ${t3?.attemptCount} ≤ 1（${t3Yields.length} 次让出未消耗重试预算）`,
  );
  ok(
    steps.every((s) => s.status === "completed" || s.status === "skipped"),
    "P40-08: 全部步骤 completed/skipped",
    steps.map((s) => `${s.stepKey}:${s.status}${s.errorCode ? `(${s.errorCode})` : ""}`),
  );

  const domainRun = await db.tenderAnalysisRun.findFirstOrThrow({
    where: { orgId, projectId, analysisVersion: "tender-workforce-analysis-v1" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, model: true, workerCursor: true, summaryJson: true },
  });
  const counts = await db.$transaction([
    db.tenderAnalysisFact.count({ where: { runId: domainRun.id } }),
    db.tenderExtractedRequirement.count({ where: { analysisRunId: domainRun.id } }),
    db.tenderAnalysisSection.count({ where: { runId: domainRun.id } }),
  ]);
  ok(
    counts[1] > 0 && counts[2] > 0,
    `P40-09: canonical 已落库（facts=${counts[0]} requirements=${counts[1]} sections=${counts[2]}）`,
  );
  ok(
    domainRun.status === "REVIEW_REQUIRED",
    `P40-10: 域终态 = REVIEW_REQUIRED（实得 ${domainRun.status}）`,
  );

  const raw = domainRun.workerCursor as {
    windows?: { outputs?: Record<string, unknown>; failures?: Record<string, unknown> };
    logs?: { promptName: string; ok: boolean }[];
    analyst?: { passAAttempts?: number; passBAttempts?: number };
  } | null;
  const windowCount = Object.keys(raw?.windows?.outputs ?? {}).length;
  const extractOk = (raw?.logs ?? []).filter((l) => l.promptName.includes("extract") && l.ok).length;
  const failureCount = Object.keys(raw?.windows?.failures ?? {}).length;
  ok(
    extractOk === windowCount && failureCount === 0,
    `P40-11: DUPLICATE_SUCCESSFUL_WINDOW_LLM_CALLS = 0（成功抽取 ${extractOk} = 窗口数 ${windowCount}）`,
  );
  ok(
    raw?.analyst?.passAAttempts === 1,
    `P40-12: Analyst PASS A 跨 invocation 仅 1 次（实得 ${raw?.analyst?.passAAttempts}）`,
  );
  ok(
    ((domainRun.summaryJson ?? {}) as Record<string, unknown>).analystSynthesis != null,
    "P40-13: Analyst 中文综合层已落 summaryJson",
  );

  console.log(
    "\nRESULT_JSON " +
      JSON.stringify({
        gate: "T5-P1.1-§40",
        preview: base, projectId, jobId,
        httpTicks: ticks.length,
        t3HttpInvocations, t3Yields: t3Yields.length,
        maxInvocationS: Math.max(...ticks.map((t) => Math.round(t.elapsedMs / 1000))),
        terminal, windowCount, extractOk, failureCount,
        counts: { facts: counts[0], requirements: counts[1], sections: counts[2] },
        model: domainRun.model, domainStatus: domainRun.status,
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
