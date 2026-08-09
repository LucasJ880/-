/**
 * Phase 2A — Case H：Approval Pause/Resume Identity
 * owner=UserA 创建 Job → 暂停等审批 → UserB(Admin) 批准 →
 * resume 后 execution principal=UserA、owner=UserA、jobId/traceId 不变。
 * 核心不变量：Approver ≠ execution principal（审批人只记录，不执行）。
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

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const { processWorkforceJobSlice } = await import("../processor");
  const { resumeRuntimeV2AfterApproval } = await import(
    "@/lib/agent-runtime-v2/process"
  );
  const { resolveRuntimeV2Principal } = await import(
    "@/lib/agent-runtime-v2/principal"
  );
  const { createDraft } = await import("@/lib/pending-actions/drafts");

  console.log("Phase 2A Case H — Approval Pause/Resume Identity");
  const fx = await seedWorkforceFixture("approval");

  const job = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job.ok) throw new Error("createWorkforceJob failed");
  const runId = job.runId;

  // slice 1：生成计划（golden 模板，确定性）
  await processWorkforceJobSlice(runId, { maxRounds: 1 });

  const before = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const traceBefore = before.traceId;
  const metaBefore = metaOf(before.metadata);
  ok(metaBefore.ownerId === fx.ownerUserId, "H: 暂停前 owner=UserA");

  // 构造等待审批状态：s1..s5 完成（合成只读证据），s6 挂 PendingAction
  const done = { degraded: false, evidenceQuality: "FULL" };
  const stepOutputs: Record<string, unknown> = {
    s1_pipeline: { opportunityCount: 0, byStage: {}, sample: [] },
    s2_opportunities: { opportunities: [] },
    s3_followup_analysis: { grader: "customer_followup", result: {}, ...done },
    s4_quote_risk: { grader: "quote_risk", result: {}, ...done },
    s5_prioritize: {
      prioritized: [{ customerId: "cust_h", customerName: "客户H" }],
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
    title: "跟进提醒：客户H",
    preview: "Case H 审批身份测试",
    payload: {
      title: "跟进客户H",
      description: "Case H",
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 86400000 + 1800000).toISOString(),
      metadata: { orgId: fx.orgId, source: "workforce_phase2a_test" },
    },
    userId: fx.ownerUserId,
    orgId: fx.orgId,
    agentRunId: runId,
    idempotencyKey: `wf_h_${fx.tag}`,
  });
  const paId = (draft.data as { actionId?: string } | undefined)?.actionId;
  ok(typeof paId === "string", "H: PendingAction 草稿创建成功");
  if (!paId) return finish();

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
    data: { status: "awaiting_approval", leaseExpiresAt: null, nextAttemptAt: null },
  });

  // ……数小时后：UserB(Admin) 批准（此处模拟 PendingAction 已由审批流执行）
  await db.pendingAction.update({
    where: { id: paId },
    data: { status: "executed" },
  });
  const resumed = await resumeRuntimeV2AfterApproval({
    orgId: fx.orgId,
    runId,
    approvalActorUserId: fx.approverUserId,
  });
  ok(
    resumed.status === "queued",
    "H: workforce_job 审批后回到 durable 队列（不 inline 以审批人执行）",
    resumed.status,
  );

  const after = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const metaAfter = metaOf(after.metadata);
  ok(
    metaAfter.approvalActorUserId === fx.approverUserId,
    "H: 审批人已记录（approvalActorUserId=UserB）",
  );
  ok(
    metaAfter.initiatedByUserId === fx.ownerUserId &&
      metaAfter.ownerId === fx.ownerUserId &&
      metaAfter.ownerType === "USER",
    "H: owner/initiator 仍=UserA（审批人未篡位）",
  );
  ok(
    metaAfter.jobId === runId && after.traceId === traceBefore,
    "H: jobId/traceId 完整不变",
  );

  const s6 = await db.agentRunStep.findFirst({
    where: { runId, stepKey: "s6_followup_tasks" },
  });
  const s6Out = metaOf(s6?.outputJson);
  ok(s6?.status === "completed", "H: 审批步骤 reconcile 为 completed");
  ok(
    s6Out.executionPrincipalUserId === fx.ownerUserId &&
      s6Out.approvalActorUserId === fx.approverUserId,
    "H: Approver ≠ execution principal（步骤级留痕）",
    s6Out,
  );

  const resumeEvents = await db.agentRunEvent.findMany({
    where: { runId, eventType: "job.resumed" },
  });
  const evPayload = metaOf(resumeEvents[0]?.payload);
  ok(
    resumeEvents.length === 1 &&
      evPayload.executionPrincipalUserId === fx.ownerUserId &&
      evPayload.approvalActorUserId === fx.approverUserId,
    "H: job.resumed 事件记录 执行主体=UserA / 审批人=UserB",
    evPayload,
  );

  // resume 后的执行主体解析必须重新校验并返回 UserA
  const principal = await resolveRuntimeV2Principal({ orgId: fx.orgId, runId });
  ok(
    principal.ok && principal.userId === fx.ownerUserId,
    "H: resume 后 execution principal=UserA（重新校验当前 membership）",
  );

  // 续跑至终态：s7 无商机→skipped；s8 Gmail 未配置→失败但不阻断验证
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_EMAIL_CLIENT_ID;
  const finalSlice = await processWorkforceJobSlice(runId, { maxRounds: 6 });
  const finalRun = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  ok(
    finalSlice.claimed &&
      ["completed", "partially_executed"].includes(finalRun.status),
    "H: 恢复后 Job 以发起人身份续跑至完成",
    { slice: finalSlice.status, run: finalRun.status },
  );
  const metaFinal = metaOf(finalRun.metadata);
  ok(
    metaFinal.ownerId === fx.ownerUserId &&
      metaFinal.jobId === runId &&
      finalRun.traceId === traceBefore,
    "H: 完成后 owner/jobId/traceId 全程未漂移",
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
