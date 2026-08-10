/**
 * Phase 2C-1 — Pause / Resume Reconciliation（设计 §8E / §17 / §18）
 *
 * Case M：过期 PendingAction reconcile —— run 不再永久卡 awaiting_approval：
 *   过期 → PA failed + step failed(approval_expired) + run needs_human +
 *   job.waiting_human(APPROVAL_REQUIRED/expired)；过期 ≠ 自动重新申请；
 *   幂等；自愈兜底（前轮 reconcile 崩溃后仍收敛）；needs_human 可人工恢复。
 *
 * Case N：resumeWorkforceJob() 统一入口契约 ——
 *   cancelled 优先拒绝（resume_blocked）；已入队幂等短路；pending PA 未决
 *   保持等待；principal 失效 → park PERMISSION_CHANGED；并发触发 CAS 去重
 *   （恰一个 requeued、恰一条 job.resumed）；attempts 不惩罚。
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  ok,
  finish,
  metaOf,
  GOLDEN_GOAL,
} from "./helpers";

requireIsolatedTestDb();

type Fx = Awaited<ReturnType<typeof seedWorkforceFixture>>;

/** 构造一个卡在 awaiting_approval 的 workforce job（复用 Case H 的确定性构造） */
async function buildAwaitingApprovalJob(
  fx: Fx,
  key: string,
): Promise<{ runId: string; paId: string }> {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { processWorkforceJobSlice } = await import("../processor");
  const { createDraft } = await import("@/lib/pending-actions/drafts");

  const job = await createWorkforceJob({
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
    preview: "Phase 2C-1 pause/resume 测试",
    payload: {
      title: `跟进客户${key}`,
      description: `2C-1 ${key}`,
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 86400000 + 1800000).toISOString(),
      metadata: { orgId: fx.orgId, source: "workforce_phase2c1_test" },
    },
    userId: fx.ownerUserId,
    orgId: fx.orgId,
    agentRunId: runId,
    idempotencyKey: `wf_2c1_${key}_${fx.tag}`,
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

async function caseM(fx: Fx) {
  const { db } = await import("@/lib/db");
  const { expireOverdueApprovals } = await import("@/lib/approval/port");
  const { resumeWorkforceJob } = await import("../resume");

  console.log("\nCase M — 过期 PendingAction reconcile（§8E）");
  const { runId, paId } = await buildAwaitingApprovalJob(fx, "m1");

  const paCountBefore = await db.pendingAction.count({
    where: { agentRunId: runId },
  });

  // 审批悬置超时：expiresAt 回拨到过去
  await db.pendingAction.update({
    where: { id: paId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  const r1 = await expireOverdueApprovals();
  ok(
    r1.expiredPendingActions >= 1 && r1.reconciledWorkforceRuns >= 1,
    "M: expireOverdueApprovals 标记过期并 reconcile 关联 workforce run",
    r1,
  );

  const pa = await db.pendingAction.findUniqueOrThrow({ where: { id: paId } });
  ok(
    pa.status === "failed" && pa.failureReason === "已过期",
    "M: PendingAction → failed(已过期)（既有语义不变）",
  );

  const s6 = await db.agentRunStep.findFirst({
    where: { runId, stepKey: "s6_followup_tasks" },
  });
  ok(
    s6?.status === "failed" && s6.errorCode === "approval_expired",
    "M: awaiting 步骤 → failed(errorCode=approval_expired)",
    { status: s6?.status, errorCode: s6?.errorCode },
  );

  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  ok(
    run.status === "needs_human" &&
      run.errorCode === "approval_expired" &&
      run.attempts === 0 &&
      run.leaseExpiresAt === null,
    "M: run 不再卡 awaiting_approval → needs_human（attempts 不惩罚、无租约）",
    { status: run.status, errorCode: run.errorCode, attempts: run.attempts },
  );

  const waitingEvents = await db.agentRunEvent.findMany({
    where: { runId, eventType: "job.waiting_human" },
    orderBy: { sequence: "asc" },
  });
  const lastWaiting = metaOf(waitingEvents[waitingEvents.length - 1]?.payload);
  const req = metaOf(lastWaiting.humanRequirement);
  ok(
    req.type === "APPROVAL_REQUIRED" && req.detail === "expired",
    "M: job.waiting_human 事件带 humanRequirement=APPROVAL_REQUIRED/expired",
    lastWaiting,
  );

  const paCountAfter = await db.pendingAction.count({
    where: { agentRunId: runId },
  });
  ok(
    paCountAfter === paCountBefore,
    "M: 过期 ≠ 自动重新申请（无新 PendingAction 被创建）",
    { before: paCountBefore, after: paCountAfter },
  );

  // 幂等：重复跑不产生新状态变化 / 新事件
  const eventsBefore = await db.agentRunEvent.count({ where: { runId } });
  const r2 = await expireOverdueApprovals();
  const runAfter2 = await db.agentRun.findUniqueOrThrow({
    where: { id: runId },
  });
  const eventsAfter = await db.agentRunEvent.count({ where: { runId } });
  ok(
    runAfter2.status === "needs_human" && eventsAfter === eventsBefore,
    "M: 重复 expire 幂等（状态/事件不重复）",
    { reconciled: r2.reconciledWorkforceRuns },
  );

  // BLOCKER D：approval_expired park 后 manual 触发不构成新审批/replan——
  // 必须保持 needs_human（REQUIRES_NEW_APPROVAL_OR_REPLAN），真正恢复归 2C-3
  const resumed = await resumeWorkforceJob({
    orgId: fx.orgId,
    runId,
    trigger: "manual",
    humanActorUserId: fx.ownerUserId,
  });
  const runResumed = await db.agentRun.findUniqueOrThrow({
    where: { id: runId },
  });
  ok(
    !resumed.ok &&
      resumed.status === "waiting_human" &&
      resumed.reason === "REQUIRES_NEW_APPROVAL_OR_REPLAN" &&
      runResumed.status === "needs_human" &&
      runResumed.errorCode === "approval_expired",
    "M: approval_expired 后 manual resume fail-closed（保持 needs_human，归 2C-3）",
    { resumed, run: runResumed.status },
  );
  const resumedEvents = await db.agentRunEvent.count({
    where: { runId, eventType: "job.resumed" },
  });
  ok(
    resumedEvents === 0,
    "M: fail-closed 路径不产生 job.resumed 事件（无伪装恢复）",
  );

  // 自愈兜底：模拟"前轮 reconcile 崩溃"——PA 已 failed(已过期) 但 run 仍卡
  const { runId: runId2, paId: paId2 } = await buildAwaitingApprovalJob(
    fx,
    "m2",
  );
  await db.pendingAction.update({
    where: { id: paId2 },
    data: { status: "failed", failureReason: "已过期" },
  });
  const r3 = await expireOverdueApprovals(); // 本轮无新过期行，仅靠自愈扫描
  const run2 = await db.agentRun.findUniqueOrThrow({ where: { id: runId2 } });
  ok(
    r3.reconciledWorkforceRuns >= 1 && run2.status === "needs_human",
    "M: 自愈兜底——前轮 reconcile 中断后，下轮 cron 仍收敛卡死 run",
    { reconciled: r3.reconciledWorkforceRuns, run: run2.status },
  );
}

async function caseN(fx: Fx) {
  const { db } = await import("@/lib/db");
  const { resumeWorkforceJob } = await import("../resume");

  console.log("\nCase N — resumeWorkforceJob 统一入口契约（§17）");

  // N1: cancelled 优先拒绝
  const j1 = await buildAwaitingApprovalJob(fx, "n1");
  await db.agentRun.update({
    where: { id: j1.runId },
    data: { status: "cancelled" },
  });
  const r1 = await resumeWorkforceJob({
    orgId: fx.orgId,
    runId: j1.runId,
    trigger: "manual",
  });
  const run1 = await db.agentRun.findUniqueOrThrow({ where: { id: j1.runId } });
  const blocked1 = await db.agentRunEvent.count({
    where: { runId: j1.runId, eventType: "job.resume_blocked" },
  });
  ok(
    !r1.ok &&
      r1.status === "not_resumable" &&
      r1.reason === "TERMINAL_STATE:cancelled" &&
      run1.status === "cancelled" &&
      blocked1 === 1,
    "N1: cancelled 拒绝恢复（状态不动 + job.resume_blocked 审计）",
    r1,
  );

  // N2: 已入队 → 幂等短路（无事件副作用）
  const j2 = await buildAwaitingApprovalJob(fx, "n2");
  await db.agentRun.update({
    where: { id: j2.runId },
    data: { status: "queued", nextAttemptAt: new Date() },
  });
  const r2 = await resumeWorkforceJob({
    orgId: fx.orgId,
    runId: j2.runId,
    trigger: "manual",
  });
  const resumedEv2 = await db.agentRunEvent.count({
    where: { runId: j2.runId, eventType: "job.resumed" },
  });
  ok(
    r2.ok && r2.status === "already_active" && resumedEv2 === 0,
    "N2: 已 queued 的 run 幂等短路（不重复写 job.resumed）",
    r2,
  );

  // N3: pending PendingAction 未决 → 保持等待（human requirement 未满足）
  const j3 = await buildAwaitingApprovalJob(fx, "n3");
  const r3 = await resumeWorkforceJob({
    orgId: fx.orgId,
    runId: j3.runId,
    trigger: "manual",
  });
  const run3 = await db.agentRun.findUniqueOrThrow({ where: { id: j3.runId } });
  ok(
    !r3.ok &&
      r3.status === "waiting_human" &&
      r3.reason.startsWith("PENDING_ACTIONS") &&
      run3.status === "awaiting_approval",
    "N3: 关联 PendingAction 仍 pending → 保持等待（不越过审批恢复）",
    r3,
  );

  // N4: principal 失效 → blocked + park PERMISSION_CHANGED；恢复后可 resume
  const j4 = await buildAwaitingApprovalJob(fx, "n4");
  await db.pendingAction.update({
    where: { id: j4.paId },
    data: { status: "rejected" },
  });
  await db.agentRunStep.updateMany({
    where: { runId: j4.runId, stepKey: "s6_followup_tasks" },
    data: { status: "skipped" },
  });
  await db.user.update({
    where: { id: fx.ownerUserId },
    data: { status: "inactive" },
  });
  const r4 = await resumeWorkforceJob({
    orgId: fx.orgId,
    runId: j4.runId,
    trigger: "approval_decided",
    humanActorUserId: fx.approverUserId,
  });
  const run4 = await db.agentRun.findUniqueOrThrow({ where: { id: j4.runId } });
  const blocked4 = await db.agentRunEvent.findMany({
    where: { runId: j4.runId, eventType: "job.resume_blocked" },
  });
  const blocked4Payload = metaOf(blocked4[0]?.payload);
  const waiting4 = await db.agentRunEvent.findMany({
    where: { runId: j4.runId, eventType: "job.waiting_human" },
    orderBy: { sequence: "desc" },
    take: 1,
  });
  const waiting4Req = metaOf(metaOf(waiting4[0]?.payload).humanRequirement);
  ok(
    !r4.ok &&
      r4.status === "blocked" &&
      r4.blockedBy === "principal" &&
      r4.reason === "USER_INACTIVE" &&
      run4.status === "needs_human" &&
      run4.errorCode === "USER_INACTIVE" &&
      run4.attempts === 0,
    "N4: principal 失效 → 拦截并 park needs_human(PERMISSION_CHANGED)",
    { r4, run: run4.status, errorCode: run4.errorCode },
  );
  ok(
    blocked4Payload.blockedBy === "principal" &&
      blocked4Payload.detail === "USER_INACTIVE" &&
      waiting4Req.type === "PERMISSION_CHANGED",
    "N4: job.resume_blocked + job.waiting_human(PERMISSION_CHANGED) 审计完整",
    { blocked: blocked4Payload, waiting: waiting4Req },
  );

  await db.user.update({
    where: { id: fx.ownerUserId },
    data: { status: "active" },
  });
  const r4b = await resumeWorkforceJob({
    orgId: fx.orgId,
    runId: j4.runId,
    trigger: "manual",
  });
  const run4b = await db.agentRun.findUniqueOrThrow({
    where: { id: j4.runId },
  });
  ok(
    r4b.ok && r4b.status === "requeued" && run4b.status === "queued",
    "N4b: 人修复身份后同一 Job 可恢复（needs_human → queued）",
    r4b,
  );

  // N5: 并发 resume → CAS 去重，恰一个 requeued、恰一条 job.resumed
  const j5 = await buildAwaitingApprovalJob(fx, "n5");
  await db.pendingAction.update({
    where: { id: j5.paId },
    data: { status: "rejected" },
  });
  await db.agentRunStep.updateMany({
    where: { runId: j5.runId, stepKey: "s6_followup_tasks" },
    data: { status: "skipped" },
  });
  const [c1, c2] = await Promise.all([
    resumeWorkforceJob({ orgId: fx.orgId, runId: j5.runId, trigger: "manual" }),
    resumeWorkforceJob({
      orgId: fx.orgId,
      runId: j5.runId,
      trigger: "approval_decided",
      humanActorUserId: fx.approverUserId,
    }),
  ]);
  const statuses = [c1.status, c2.status].sort();
  const resumedEv5 = await db.agentRunEvent.count({
    where: { runId: j5.runId, eventType: "job.resumed" },
  });
  const run5 = await db.agentRun.findUniqueOrThrow({ where: { id: j5.runId } });
  ok(
    statuses.join(",") === "already_active,requeued" &&
      resumedEv5 === 1 &&
      run5.status === "queued",
    "N5: 并发 resume CAS 去重——恰一个 requeued、恰一条 job.resumed",
    { statuses, events: resumedEv5 },
  );

  // N6（BLOCKER D）: 2C-1 未实现的 trigger 不得仅凭字符串 requeue
  // （复用 j3：awaiting_approval + PA pending——trigger gate 必须在
  //   pending 检查之前 fail-closed，org 配额也不允许再建新 job）
  const j6 = j3;
  const triggers = [
    "clarification_answered",
    "auth_completed",
    "scheduled",
  ] as const;
  const results6 = [];
  for (const t of triggers) {
    results6.push(
      await resumeWorkforceJob({ orgId: fx.orgId, runId: j6.runId, trigger: t }),
    );
  }
  const run6 = await db.agentRun.findUniqueOrThrow({ where: { id: j6.runId } });
  const resumedEv6 = await db.agentRunEvent.count({
    where: { runId: j6.runId, eventType: "job.resumed" },
  });
  ok(
    results6.every(
      (r) =>
        !r.ok &&
        r.status === "waiting_human" &&
        r.reason.startsWith("NOT_IMPLEMENTED_FOR_2C1"),
    ) &&
      run6.status === "awaiting_approval" &&
      resumedEv6 === 0,
    "N6: clarification/auth/scheduled trigger fail-closed（不伪装已解决）",
    { results: results6.map((r) => r.status), run: run6.status },
  );
}

async function main() {
  console.log("Phase 2C-1 — Pause / Resume Reconciliation（Case M / N）");
  const fx = await seedWorkforceFixture("phase2c1");
  await caseM(fx);
  await caseN(fx);
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
