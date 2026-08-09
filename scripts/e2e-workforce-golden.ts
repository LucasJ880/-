/**
 * Workforce Phase 2A — Golden Scenario（§26）
 *
 * 在隔离 Neon 测试分支上端到端跑一次真实低风险任务：
 * "帮我检查最近需要跟进的销售客户，整理优先顺序和下一步建议。"
 *
 * createWorkforceJob → durable queue → claim → plan → AgentRunSteps →
 * 只读执行/分析 → 写操作全部经 PendingAction 审批 → verification →
 * completed → final report。
 *
 * 安全：
 * - 强制 NODE_ENV=test + 显式 DATABASE_URL（隔离分支），拒绝其它环境
 * - 无任何真实外发：客户不带 email（Gmail 步骤 skipped）；
 *   calendar/followup 写操作只落隔离测试库
 * - LLM：需要 OPENAI_API_KEY（graders / verifier 真实调用）
 *
 * 运行：
 *   DATABASE_URL=<隔离分支> DIRECT_URL=<隔离分支> NODE_ENV=test \
 *   OPENAI_API_KEY=<模型key> npx tsx scripts/e2e-workforce-golden.ts
 */

if (process.env.NODE_ENV !== "test") {
  console.log("⏭  Golden Scenario 只允许在 NODE_ENV=test + 隔离测试库上运行");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.log("⏭  缺少 DATABASE_URL（隔离 Neon 分支）");
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("✗ Golden Scenario 需要 OPENAI_API_KEY（仅模型 key，不取生产 DATABASE_URL）");
  process.exit(1);
}

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import(
    "@/lib/workforce-runtime/job"
  );
  const { processQueuedWorkforceJobs } = await import(
    "@/lib/workforce-runtime/processor"
  );
  const { approveApprovalItem } = await import("@/lib/approval/port");

  const tag = `golden_${Date.now()}`;
  console.log(`\n═══ Workforce Golden Scenario (${tag}) ═══\n`);

  // ── Seed：org / Owner / Approver / 客户与逾期商机（无 email → 零外发） ──
  const owner = await db.user.create({
    data: {
      email: `wf_g_owner_${tag}@test.qingyan.local`,
      name: "黄金场景 Owner",
      role: "sales",
      status: "active",
    },
  });
  const approver = await db.user.create({
    data: {
      email: `wf_g_approver_${tag}@test.qingyan.local`,
      name: "黄金场景 Approver",
      role: "admin",
      status: "active",
    },
  });
  const org = await db.organization.create({
    data: {
      name: `Golden Org ${tag}`,
      code: `g_${tag}`,
      ownerId: approver.id,
      status: "active",
    },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: org.id, userId: owner.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: approver.id, role: "org_admin", status: "active" },
    ],
  });

  const overdue = new Date(Date.now() - 10 * 86400000);
  for (const [i, name] of ["李女士（客厅斑马帘）", "王先生（整屋遮光帘）", "陈太太（办公室卷帘）"].entries()) {
    const customer = await db.salesCustomer.create({
      data: {
        orgId: org.id,
        name,
        createdById: owner.id,
        status: "active",
        // 故意不填 email：Gmail 草稿步骤应 skipped，保证零外发
      },
    });
    await db.salesOpportunity.create({
      data: {
        orgId: org.id,
        customerId: customer.id,
        title: `${name} 报价跟进`,
        stage: i === 0 ? "quoted" : "measured",
        estimatedValue: 1800 + i * 700,
        nextFollowupAt: overdue,
        createdById: owner.id,
      },
    });
  }
  console.log("✓ Seed 完成：3 位客户 + 3 个逾期商机（无 email）");

  // ── Feature flag：仅 allowlist 用户可创建 ──
  process.env.WORKFORCE_RUNTIME_ENABLED = "1";
  process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST = owner.id;
  process.env.WORKFORCE_RUNTIME_ORG_ALLOWLIST = "";
  process.env.WORKFORCE_RUNTIME_ROLE_ALLOWLIST = "";

  // ── 创建 Job ──
  const job = await createWorkforceJob({
    orgId: org.id,
    userId: owner.id,
    role: "sales",
    goal: "帮我检查最近需要跟进的销售客户，整理优先顺序和下一步建议。",
    channel: "workforce_golden",
  });
  if (!job.ok) {
    console.error("✗ createWorkforceJob 失败:", job.error);
    process.exit(1);
  }
  console.log(`✓ Job 创建：jobId=${job.jobId} traceId=${job.traceId}`);

  const status = async () =>
    db.agentRun.findUniqueOrThrow({
      where: { id: job.runId },
      select: { status: true, attempts: true, metadata: true, traceId: true },
    });

  let approvedRound = 0;
  for (let tick = 0; tick < 40; tick++) {
    const before = await status();
    if (["completed", "partially_executed", "failed", "cancelled", "needs_human"].includes(before.status)) {
      break;
    }

    if (before.status === "awaiting_approval") {
      // Human intervention：Approver（UserB, admin）批准全部待确认动作。
      // 动作类型均为内部低风险（calendar.create_event / sales.update_followup），
      // 只写隔离测试库；审批人仅记录，续跑主体仍为 Owner。
      const pendings = await db.pendingAction.findMany({
        where: { agentRunId: job.runId, status: "pending" },
        select: { id: true, type: true, title: true },
      });
      if (pendings.length === 0) {
        console.error("✗ awaiting_approval 但无 pending 动作");
        break;
      }
      approvedRound++;
      for (const pa of pendings) {
        console.log(`  ▶ 审批（UserB/admin）：[${pa.type}] ${pa.title}`);
        const decision = await approveApprovalItem("pending_action", pa.id, {
          userId: approver.id,
          role: "admin",
          orgId: org.id,
        });
        console.log(
          `    → ok=${decision.ok} status=${decision.status ?? "-"}${decision.error ? ` error=${decision.error}` : ""}`,
        );
      }
      continue;
    }

    // 模拟 cron tick（缩短等待：把未来的 nextAttemptAt 拉到现在）
    await db.agentRun.updateMany({
      where: { id: job.runId, status: "queued", nextAttemptAt: { gt: new Date() } },
      data: { nextAttemptAt: new Date() },
    });
    const consumed = await processQueuedWorkforceJobs(2);
    console.log(
      `tick#${tick}: status=${before.status} → processed=${consumed.processed}`,
    );
  }

  // ── 结果与断言 ──
  const finalRun = await db.agentRun.findUniqueOrThrow({
    where: { id: job.runId },
    include: {
      steps: { orderBy: { createdAt: "asc" } },
      verifications: { orderBy: { attempt: "asc" } },
      events: { orderBy: { sequence: "asc" } },
    },
  });
  const meta = (finalRun.metadata ?? {}) as Record<string, unknown>;

  console.log(`\n─── 步骤 ───`);
  for (const s of finalRun.steps) {
    console.log(
      `  ${s.stepKey.padEnd(22)} ${s.status.padEnd(18)} attempts=${s.attemptCount}`,
    );
  }
  console.log(`\n─── 验证 ───`);
  for (const v of finalRun.verifications) {
    console.log(`  attempt=${v.attempt} verdict=${v.verdict} ${v.summary}`);
  }
  console.log(`\n─── Job 生命周期事件 ───`);
  for (const e of finalRun.events.filter((e) => e.eventType.startsWith("job."))) {
    console.log(`  #${e.sequence} ${e.eventType} ${e.title ?? ""}`);
  }

  const { buildFinalReport } = await import("@/lib/agent-runtime-v2/process");
  const report = await buildFinalReport(org.id, job.runId);
  console.log(`\n─── Final Report（交给 Owner） ───\n${report}\n`);

  const checks: Array<[string, boolean]> = [
    ["Job 终态 completed", finalRun.status === "completed"],
    [
      "身份不漂移：owner/jobId/rootRunId/traceId",
      meta.ownerId === owner.id &&
        meta.jobId === job.runId &&
        meta.rootRunId === job.runId &&
        finalRun.traceId === job.traceId,
    ],
    [
      "审批人已记录且 ≠ 执行主体",
      meta.approvalActorUserId === approver.id &&
        meta.initiatedByUserId === owner.id,
    ],
    [
      "验证 PASS",
      finalRun.verifications.some((v) => v.verdict === "PASS"),
    ],
    [
      "生命周期事件齐全",
      ["job.created", "job.queued", "job.claimed", "job.lease_renewed", "job.resumed", "job.waiting_human", "job.completed"].every(
        (t) => finalRun.events.some((e) => e.eventType === t),
      ),
    ],
    [
      "零外发：Gmail 步骤未真实执行",
      finalRun.steps.every(
        (s) => s.stepKey !== "s8_gmail_drafts" || s.status !== "completed" ||
          ((s.outputJson ?? {}) as Record<string, unknown>).skipped === true,
      ),
    ],
  ];
  let failed = 0;
  console.log("─── 断言 ───");
  for (const [name, cond] of checks) {
    console.log(`  ${cond ? "✓" : "✗"} ${name}`);
    if (!cond) failed++;
  }
  console.log(
    `\nGolden Scenario ${failed === 0 ? "✅ PASS" : `❌ FAIL (${failed})`}（审批轮次=${approvedRound}）`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
