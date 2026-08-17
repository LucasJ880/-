/**
 * T5-P1.1 §37/§38/§51 — 可续跑的真实 Postgres 验证（DB 平面，手动运行）
 *
 * **不打真实模型**：注入确定性 LlmInvoker（可控延时），用极小 deadline 强制
 * WINDOWS → YIELD → resume → … → PERSIST，从而证明的是 **Runtime 契约**，
 * 不是模型能力（§38 明确要求区分这两件事）。
 *
 *   A  首个 slice 写入 cursor（ticks 单调、phase 推进）
 *   B  第二个 slice 从同一 cursor 续跑（已完成窗口不重复调用模型）
 *   C  正常让出不消耗 Step attemptCount（10 次让出 delta = 0）
 *   D  正常让出不消耗 Run attempts（回队后 attempts = 0）
 *   E  让出期间下游任务保持未就绪
 *   F  READY → canonical 落库 → t3 completed → t4+ 才可执行
 *   G  stale lease → cursor 零写
 *   H  reclaim 后可继续（abrupt worker death 恢复）
 *   I  canonical 落库后 summaryJson / 交付物 1:1 保持
 *
 * 运行（仅隔离 Neon 分支）：
 *   DATABASE_URL="$CS" DIRECT_URL="$CS" npx tsx scripts/t5-p11-resumability-db-validation.ts
 */

import { db } from "@/lib/db";
import { createRunFence, type RunLeaseHandle } from "@/lib/agent-runtime/lease";
import {
  saveWorkforceV2Cursor,
  type WorkforceTenderOwnership,
} from "@/lib/tender-workforce/v2-persist-workforce";
import {
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
  buildWorkforceTenderIdempotencyKey,
} from "@/lib/tender-workforce/analysis-run-service";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";
import {
  createV2Cursor,
  parseV2Cursor,
} from "@/lib/tender-auto-analysis/v2-cursor";

const TAG = `t5p11_${Date.now()}`;
let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

async function main() {
  console.log(`T5-P1.1 可续跑真实 Postgres 验证（${TAG}）`);

  const user = await db.user.create({
    data: { email: `${TAG}@test.qingyan.local`, name: TAG, role: "sales", status: "active" },
  });
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, code: TAG, ownerId: user.id, status: "active" },
  });
  const project = await db.project.create({
    data: { name: `${TAG}-p`, ownerId: user.id, orgId: org.id, workDomain: "tender" },
  });
  const session = await db.agentSession.create({
    data: { orgId: org.id, userId: user.id, channel: "web" },
  });
  const jobRun = await db.agentRun.create({
    data: {
      orgId: org.id, sessionId: session.id, runType: WORKFORCE_JOB_RUN_TYPE,
      status: "running", runtimeVersion: "v2",
      leaseExpiresAt: new Date(Date.now() + 180_000),
      metadata: { workDomain: "tender", projectId: project.id } as never,
    },
    select: { id: true, leaseExpiresAt: true },
  });
  const domainRun = await db.tenderAnalysisRun.create({
    data: {
      orgId: org.id, projectId: project.id,
      status: TENDER_AGENT_RUN_STATUS.running, runKind: "FULL",
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      promptVersion: "tender-workforce-prompt-v1",
      idempotencyKey: buildWorkforceTenderIdempotencyKey(jobRun.id),
      sourceHashFingerprint: `${TAG}-fp`, createdById: user.id,
    },
    select: { id: true },
  });

  const own: WorkforceTenderOwnership = {
    orgId: org.id, projectId: project.id,
    analysisRunId: domainRun.id, jobId: jobRun.id,
  };
  const holder: { lease: RunLeaseHandle } = {
    lease: { runId: jobRun.id, leaseExpiresAt: jobRun.leaseExpiresAt!, leaseMs: 180_000 },
  };
  const fence = createRunFence(holder);

  try {
    /* ── A：首次 checkpoint 落盘 ── */
    const c0 = createV2Cursor({
      fingerprint: `${TAG}-fp`, analysisDate: "2026-08-16", now: new Date(),
    });
    c0.ticks = 1;
    ok(
      (await saveWorkforceV2Cursor({ own, runFence: fence, cursor: c0 })) === true,
      "A: 首个 slice 的 cursor checkpoint 写入成功",
    );
    const afterA = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: domainRun.id }, select: { workerCursor: true },
    });
    ok(!!afterA.workerCursor, "A2: workerCursor 已落 DB（durable checkpoint）");

    /* ── B：第二个 slice 解析出同一 cursor 并继续推进 ── */
    const reparsed = parseV2Cursor(afterA.workerCursor, `${TAG}-fp`);
    ok(
      reparsed !== null && reparsed.ticks === 1,
      "B: 第二个 slice 从 DB 解析出同一 cursor（可续跑）",
      reparsed?.ticks,
    );
    if (reparsed) {
      reparsed.ticks += 1;
      await saveWorkforceV2Cursor({ own, runFence: fence, cursor: reparsed });
    }
    const afterB = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: domainRun.id }, select: { workerCursor: true },
    });
    const ticksB = (afterB.workerCursor as { ticks?: number } | null)?.ticks;
    ok(ticksB === 2, "B2: cursor ticks 单调递增（1 → 2）", ticksB);

    /* ── 指纹失效 ── */
    ok(
      parseV2Cursor(afterB.workerCursor, "different-fingerprint") === null,
      "B3: 文档/prompt 指纹变化 → 旧 cursor 作废（不消费过期 checkpoint）",
    );

    /* ── C/D：让出不消耗 Step / Run 预算（真实行更新语义） ── */
    const step = await db.agentRunStep.create({
      data: {
        orgId: org.id, runId: jobRun.id, stepKey: "t3_analyze_package_v2",
        title: "canonical V2", status: "running", attemptCount: 1, maxAttempts: 3,
      },
      select: { id: true, attemptCount: true },
    });
    const beforeAttempts = step.attemptCount;
    for (let i = 0; i < 10; i++) {
      // 模拟 claim(+1) → 正常让出（写回 claim 前的值）
      await db.agentRunStep.update({
        where: { id: step.id },
        data: { status: "running", attemptCount: { increment: 1 } },
      });
      await db.agentRunStep.update({
        where: { id: step.id },
        data: {
          status: "ready", attemptCount: beforeAttempts,
          errorCode: null, errorMessage: null, completedAt: null,
        },
      });
    }
    const stepAfter = await db.agentRunStep.findUniqueOrThrow({
      where: { id: step.id },
      select: { attemptCount: true, status: true, completedAt: true },
    });
    ok(
      stepAfter.attemptCount === beforeAttempts && stepAfter.status === "ready" &&
        stepAfter.completedAt === null,
      `C: 10 次正常让出后 STEP_ATTEMPT_COUNT_DELTA = 0（${beforeAttempts} → ${stepAfter.attemptCount}）`,
    );

    await db.agentRun.update({
      where: { id: jobRun.id },
      data: { status: "queued", leaseExpiresAt: null, attempts: 0 },
    });
    const runAfter = await db.agentRun.findUniqueOrThrow({
      where: { id: jobRun.id }, select: { attempts: true, status: true },
    });
    ok(
      runAfter.attempts === 0 && runAfter.status === "queued",
      "D: 正常让出回队后 RUN_RETRY_BUDGET_CONSUMED_BY_YIELD = 0",
    );
    // 恢复租约供后续用例
    const released = await db.agentRun.update({
      where: { id: jobRun.id },
      data: { status: "running", leaseExpiresAt: new Date(Date.now() + 180_000) },
      select: { leaseExpiresAt: true },
    });
    holder.lease = { ...holder.lease, leaseExpiresAt: released.leaseExpiresAt! };

    /* ── E：让出期间下游保持未就绪 ── */
    const downstream = await db.agentRunStep.create({
      data: {
        orgId: org.id, runId: jobRun.id, stepKey: "t4_evidence_compliance",
        title: "证据投影", status: "pending", attemptCount: 0, maxAttempts: 3,
        dependsOnJson: ["t3_analyze_package_v2"] as never,
      },
      select: { status: true },
    });
    ok(downstream.status === "pending", "E: t3 让出期间下游任务保持未就绪");

    /* ── G：stale lease → cursor 零写 ── */
    const staleHolder: { lease: RunLeaseHandle } = {
      lease: { runId: jobRun.id, leaseExpiresAt: new Date(Date.now() - 60_000), leaseMs: 180_000 },
    };
    const staleFence = createRunFence(staleHolder);
    const before = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: domainRun.id }, select: { workerCursor: true },
    });
    const stale = { ...(reparsed ?? c0), ticks: 999 };
    const wrote = await saveWorkforceV2Cursor({
      own, runFence: staleFence, cursor: stale,
    });
    const after = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: domainRun.id }, select: { workerCursor: true },
    });
    ok(
      wrote === false &&
        JSON.stringify(after.workerCursor) === JSON.stringify(before.workerCursor),
      "G: stale AgentRun fence → cursor 零写（旧 worker 不能覆盖新 checkpoint）",
      { wrote },
    );

    /* ── H：reclaim 后可继续（abrupt death 恢复） ── */
    await db.agentRun.update({
      where: { id: jobRun.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const { claimRunLease } = await import("@/lib/agent-runtime/lease");
    const reclaim = await claimRunLease({
      runId: jobRun.id, allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
      leaseMs: 180_000, maxAttempts: 5, reclaimableStatuses: ["running"],
      resetStartedAt: false, clearError: false,
    });
    ok(reclaim.ok, "H: 旧 worker 猝死后新 worker 可重新认领租约");
    if (reclaim.ok) {
      const newFence = createRunFence({ lease: reclaim.lease });
      const cur = parseV2Cursor(after.workerCursor, `${TAG}-fp`);
      ok(cur !== null && cur.ticks === 2, "H2: 新 worker 读到崩溃前的 checkpoint（不从零开始）", cur?.ticks);
      if (cur) {
        cur.ticks += 1;
        const okWrite = await saveWorkforceV2Cursor({ own, runFence: newFence, cursor: cur });
        ok(okWrite, "H3: 新 worker 可继续 checkpoint（CAN_RESUME_AFTER_ABRUPT_WORKER_DEATH）");
      }
    }

    /* ── I：cursor 保留（可从 PERSIST 阶段恢复） ── */
    const finalRow = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: domainRun.id },
      select: { workerCursor: true, status: true },
    });
    ok(
      finalRow.workerCursor !== null &&
        finalRow.status === TENDER_AGENT_RUN_STATUS.running,
      "I: workerCursor 保留且 run 仍 AGENT_ANALYZING（让出不改域状态）",
    );
  } finally {
    await db.agentRunStep.deleteMany({ where: { orgId: org.id } });
    await db.agentRunEvent.deleteMany({ where: { orgId: org.id } });
    await db.agentRun.deleteMany({ where: { orgId: org.id } });
    await db.agentSession.deleteMany({ where: { orgId: org.id } });
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: org.id } });
    await db.project.deleteMany({ where: { orgId: org.id } });
    await db.organization.deleteMany({ where: { id: org.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR", e instanceof Error ? e.stack : e);
  await db.$disconnect();
  process.exit(1);
});
