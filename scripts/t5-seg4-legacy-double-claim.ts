/**
 * T5-P1 Segment 4 §11 — legacy 队列双认领实证（隔离分支）
 *
 * 在一个 Workforce 拥有的 TenderAnalysisRun **正处于 AGENT_ANALYZING**（t3 长推理中）时，
 * 反复触发 legacy tender-auto-analysis 的队列消费，验证 legacy 永远不会：
 *   - 认领该 run（leaseOwner 保持 null）
 *   - 改其状态 / workerStep / workerCursor / attemptCount
 *
 * 运行：DATABASE_URL=... DIRECT_URL=... npx tsx scripts/t5-seg4-legacy-double-claim.ts <projectId>
 */

import { db } from "@/lib/db";

const projectId = process.argv[2];
if (!projectId) {
  console.error("usage: t5-seg4-legacy-double-claim.ts <projectId>");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    console.error(`  ✗ ${n}`, d ?? "");
  }
};

async function main() {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, orgId: true, ownerId: true },
  });
  const owner = await db.user.findUniqueOrThrow({
    where: { id: project.ownerId },
    select: { id: true, role: true },
  });

  const { startTenderWorkforceAnalysis } = await import(
    "@/lib/tender-workforce/trigger-service"
  );
  const { processWorkforceJobSlice } = await import(
    "@/lib/workforce-runtime/processor"
  );
  const { processQueuedTenderAnalysisRuns } = await import(
    "@/lib/tender-auto-analysis/worker"
  );

  const started = await startTenderWorkforceAnalysis({
    orgId: project.orgId!,
    projectId,
    projectName: project.name,
    userId: owner.id,
    role: owner.role,
    requestId: `t5seg4-doubleclaim-${Date.now()}`,
    restart: true,
  });
  if (!started.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
  console.log(`workforce job = ${started.jobId}`);

  // 后台推进 Workforce slice（t3 期间 domain run 处于 AGENT_ANALYZING）
  const slicePromise = (async () => {
    for (let i = 0; i < 20; i++) {
      const r = await processWorkforceJobSlice(started.jobId, {
        sliceBudgetMs: 240_000,
        maxRounds: 6,
      });
      const row = await db.agentRun.findUniqueOrThrow({
        where: { id: started.jobId },
        select: { status: true },
      });
      if (["completed", "failed", "cancelled", "needs_human"].includes(row.status)) return row.status;
      void r;
      await new Promise((res) => setTimeout(res, 1000));
    }
    return "TIMEOUT";
  })();

  // 等 domain run 进入 AGENT_ANALYZING
  let domainRunId = "";
  for (let i = 0; i < 120; i++) {
    const dr = await db.tenderAnalysisRun.findFirst({
      where: {
        orgId: project.orgId!,
        projectId,
        analysisVersion: "tender-workforce-analysis-v1",
        status: "AGENT_ANALYZING",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (dr) {
      domainRunId = dr.id;
      break;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  ok(!!domainRunId, "domain run 已进入 AGENT_ANALYZING（可开始 legacy 冲撞）");
  if (!domainRunId) {
    await slicePromise;
    await db.$disconnect();
    process.exit(1);
  }

  const before = await db.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: domainRunId },
    select: {
      status: true, leaseOwner: true, leaseExpiresAt: true,
      workerStep: true, workerCursor: true, attemptCount: true, nextAttemptAt: true,
    },
  });

  // —— 在 t3 推理期间反复触发 legacy 队列消费 —— //
  let sweeps = 0;
  let legacyTouched = 0;
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    const cur = await db.tenderAnalysisRun.findUnique({
      where: { id: domainRunId },
      select: { status: true },
    });
    if (cur?.status !== "AGENT_ANALYZING") break;
    const swept = await processQueuedTenderAnalysisRuns(3);
    sweeps += 1;
    if (swept.runIds.includes(domainRunId)) legacyTouched += 1;
    const now = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: domainRunId },
      select: {
        status: true, leaseOwner: true, workerStep: true,
        workerCursor: true, attemptCount: true,
      },
    });
    if (
      now.leaseOwner !== before.leaseOwner ||
      now.workerStep !== before.workerStep ||
      JSON.stringify(now.workerCursor) !== JSON.stringify(before.workerCursor) ||
      now.attemptCount !== before.attemptCount
    ) {
      legacyTouched += 1;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }

  const after = await db.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: domainRunId },
    select: {
      status: true, leaseOwner: true, workerStep: true,
      workerCursor: true, attemptCount: true, nextAttemptAt: true,
    },
  });

  console.log(`legacy sweeps during AGENT_ANALYZING = ${sweeps}`);
  ok(sweeps >= 3, "确实在 t3 推理窗口内多次触发 legacy 队列消费", sweeps);
  ok(legacyTouched === 0, "LEGACY_QUEUE_DOUBLE_CLAIM = 0（legacy 从未认领该 run）", legacyTouched);
  ok(
    after.leaseOwner === before.leaseOwner && after.leaseOwner === null,
    "leaseOwner 保持为空（legacy lease 未介入）",
    { before: before.leaseOwner, after: after.leaseOwner },
  );
  ok(
    after.workerStep === before.workerStep &&
      JSON.stringify(after.workerCursor) === JSON.stringify(before.workerCursor) &&
      after.attemptCount === before.attemptCount,
    "legacy cursor / step / attempts 全部未被改动",
    { before, after },
  );

  const terminal = await slicePromise;
  const final = await db.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: domainRunId },
    select: { status: true },
  });
  ok(
    terminal === "completed" && final.status === "REVIEW_REQUIRED",
    "冲撞期间 Workforce 仍正常跑完（job completed / run REVIEW_REQUIRED）",
    { terminal, domain: final.status },
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR", e instanceof Error ? e.stack : e);
  await db.$disconnect();
  process.exit(1);
});
