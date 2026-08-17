/**
 * Phase 2C-1 — Expiry 竞态确定性测试（BLOCKER A/B/C）
 *
 * 核心不变量：EXACTLY_ONE_OUTCOME_WINS —— 对同一 PendingAction，
 * approve / reject / execute / expire 恰好一个结果获胜；expiry 侧只对
 * 逐行 CAS（pending→failed）实际转移成功的 winner 做 reconcile，
 * 绝不信任 candidate 旧快照。
 *
 * EXP1：expiry CAS 先赢 → 之后 approve 只能命中幂等分支，不得覆盖
 *       needs_human(approval_expired)。
 * EXP2：approve/execute 先赢（action 已 executed 且 expiresAt 已过）→
 *       expiry winner set 排除该 action，run/step 不标 approval_expired。
 * EXP3：reject 先赢 → 同上，expiry 不得改标。
 * EXP4：stale candidate snapshot 中 action 实为 executed → 直接把旧快照
 *       喂给 reconcile，step 不得被降级为 failed，run 不得转 needs_human。
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  cleanupWorkforceFixture,
  assertNoLeakedWorkforceJobs,
  ok,
  finish,
  GOLDEN_GOAL,
} from "./helpers";

requireIsolatedTestDb();

type Fx = Awaited<ReturnType<typeof seedWorkforceFixture>>;

/** 与 phase2c1-pause-resume 相同的确定性构造：job 卡在 awaiting_approval */
async function buildAwaitingApprovalJob(
  fx: Fx,
  key: string,
): Promise<{ runId: string; paId: string }> {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { processWorkforceJobSlice } = await import("../processor");
  const { createDraft } = await import("@/lib/pending-actions/drafts");

  const job = await createWorkforceJob({
    workDomain: "sales",
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job.ok) throw new Error("createWorkforceJob failed");
  const runId = job.runId;
  await processWorkforceJobSlice(runId, { maxRounds: 1 });

  const done = { degraded: false, evidenceQuality: "FULL" };
  const stepOutputs: Record<string, unknown> = {
    s1_pipeline: { opportunityCount: 0, byStage: {}, sample: [] },
    s2_opportunities: { opportunities: [] },
    s3_followup_analysis: { grader: "customer_followup", result: {}, ...done },
    s4_quote_risk: { grader: "quote_risk", result: {}, ...done },
    s5_prioritize: {
      prioritized: [{ customerId: `cust_${key}`, customerName: `客户${key}` }],
    },
  };
  for (const [stepKey, outputJson] of Object.entries(stepOutputs)) {
    await db.agentRunStep.updateMany({
      where: { runId, stepKey },
      data: {
        status: "completed",
        attemptCount: 1,
        completedAt: new Date(),
        outputJson: JSON.parse(JSON.stringify(outputJson)),
      },
    });
  }

  const draft = await createDraft({
    type: "calendar.create_event",
    title: `跟进提醒：客户${key}`,
    preview: "Phase 2C-1 expiry race 测试",
    payload: {
      title: `跟进客户${key}`,
      description: `2C-1 race ${key}`,
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 86400000 + 1800000).toISOString(),
      metadata: { orgId: fx.orgId, source: "workforce_phase2c1_race_test" },
    },
    userId: fx.ownerUserId,
    orgId: fx.orgId,
    agentRunId: runId,
    idempotencyKey: `wf_2c1_race_${key}_${fx.tag}`,
  });
  const paId = (draft.data as { actionId?: string } | undefined)?.actionId;
  if (typeof paId !== "string") throw new Error("createDraft failed");

  await db.agentRunStep.updateMany({
    where: { runId, stepKey: "s6_followup_tasks" },
    data: {
      status: "awaiting_approval",
      pendingActionId: paId,
      evidenceJson: { pendingActionIds: [paId] },
    },
  });
  await db.agentRun.update({
    where: { id: runId },
    data: {
      status: "awaiting_approval",
      leaseExpiresAt: null,
      nextAttemptAt: null,
      attempts: 0,
    },
  });
  return { runId, paId };
}

async function main() {
  console.log("Phase 2C-1 — Expiry 竞态确定性测试（EXP1–EXP4）");
  const { db } = await import("@/lib/db");
  const { expireOverdueApprovals, approveApprovalItem } = await import(
    "@/lib/approval/port"
  );
  const { reconcileWorkforceRunsAfterApprovalExpiry } = await import(
    "../resume"
  );
  const fx = await seedWorkforceFixture("phase2c1race");

  // ── EXP1：expiry 先赢 → approve 不能覆盖 ──
  {
    const { runId, paId } = await buildAwaitingApprovalJob(fx, "exp1");
    await db.pendingAction.update({
      where: { id: paId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expireOverdueApprovals();
    const mid = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    ok(
      mid.status === "needs_human" && mid.errorCode === "approval_expired",
      "EXP1: expiry CAS 获胜 → run needs_human(approval_expired)",
      { status: mid.status },
    );

    // 迟到的 approve：只能命中幂等分支，不得执行、不得覆盖过期结果
    const decision = await approveApprovalItem("pending_action", paId, {
      userId: fx.approverUserId,
      role: "admin",
      orgId: fx.orgId,
    });
    const pa = await db.pendingAction.findUniqueOrThrow({ where: { id: paId } });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const s6 = await db.agentRunStep.findFirst({
      where: { runId, stepKey: "s6_followup_tasks" },
    });
    const resumedEv = await db.agentRunEvent.count({
      where: { runId, eventType: "job.resumed" },
    });
    ok(
      decision.ok === false &&
        decision.duplicate === true &&
        pa.status === "failed" &&
        pa.failureReason === "已过期",
      "EXP1: 迟到 approve 命中幂等分支（不执行、不翻转 action）",
      { ok: decision.ok, duplicate: decision.duplicate, pa: pa.status },
    );
    ok(
      run.status === "needs_human" &&
        run.errorCode === "approval_expired" &&
        s6?.status === "failed" &&
        s6.errorCode === "approval_expired" &&
        resumedEv === 0,
      "EXP1: EXACTLY_ONE_OUTCOME_WINS——expiry 结果不被迟到 approve 覆盖",
      { run: run.status, step: s6?.status },
    );
  }

  // ── EXP2：approve/execute 先赢 → expiry winner set 排除 ──
  {
    const { runId, paId } = await buildAwaitingApprovalJob(fx, "exp2");
    // approve 先赢：action 已 executed；expiresAt 随后才被 cron 观察到已过期
    await db.pendingAction.update({
      where: { id: paId },
      data: { status: "executed", expiresAt: new Date(Date.now() - 60_000) },
    });
    await expireOverdueApprovals();
    const pa = await db.pendingAction.findUniqueOrThrow({ where: { id: paId } });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const s6 = await db.agentRunStep.findFirst({
      where: { runId, stepKey: "s6_followup_tasks" },
    });
    ok(
      pa.status === "executed" &&
        run.status === "awaiting_approval" &&
        run.errorCode !== "approval_expired" &&
        s6?.status === "awaiting_approval",
      "EXP2: executed 先赢 → expiry winner set 排除，run/step 不标 approval_expired",
      { pa: pa.status, run: run.status, step: s6?.status },
    );
  }

  // ── EXP3：reject 先赢 → expiry 不得改标 ──
  {
    const { runId, paId } = await buildAwaitingApprovalJob(fx, "exp3");
    await db.pendingAction.update({
      where: { id: paId },
      data: { status: "rejected", expiresAt: new Date(Date.now() - 60_000) },
    });
    await expireOverdueApprovals();
    const pa = await db.pendingAction.findUniqueOrThrow({ where: { id: paId } });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const s6 = await db.agentRunStep.findFirst({
      where: { runId, stepKey: "s6_followup_tasks" },
    });
    ok(
      pa.status === "rejected" &&
        run.errorCode !== "approval_expired" &&
        s6?.errorCode !== "approval_expired",
      "EXP3: rejected 先赢 → expiry 不改标 approval_expired（拒绝语义保留）",
      { pa: pa.status, run: run.status, step: s6?.status },
    );
  }

  // ── EXP4：stale candidate snapshot（action 实为 executed）→ 不降级 ──
  {
    const { runId, paId } = await buildAwaitingApprovalJob(fx, "exp4");
    await db.pendingAction.update({
      where: { id: paId },
      data: { status: "executed" },
    });
    // 模拟竞态窗口：把包含该 action 的旧快照直接喂给 reconcile
    const res = await reconcileWorkforceRunsAfterApprovalExpiry([
      { id: paId, orgId: fx.orgId, agentRunId: runId },
    ]);
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const s6 = await db.agentRunStep.findFirst({
      where: { runId, stepKey: "s6_followup_tasks" },
    });
    ok(
      s6?.status === "awaiting_approval" &&
        s6.errorCode !== "approval_expired" &&
        run.status === "awaiting_approval" &&
        res.reconciledRuns === 0,
      "EXP4: stale snapshot 中已 executed 的 action → step 不被降级 failed、run 不转 needs_human",
      { step: s6?.status, run: run.status, reconciled: res.reconciledRuns },
    );
  }

  console.log("\nEXACTLY_ONE_OUTCOME_WINS = YES");
  // Lane B §5/§7：fixture ownership cleanup —— 只删本 suite 自己的数据，
  // 不给后续 suite 留任何 eligible workforce job
  const cleanedFx = await cleanupWorkforceFixture(fx);
  ok(
    await assertNoLeakedWorkforceJobs(fx),
    "CLEANUP: 本 suite 无 workforce job 泄漏",
    cleanedFx.residue,
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
