/**
 * CHAIN-0c 招标分析失败立刻告诉人——真实 DB（隔离库）端到端
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；不调模型、不发邮件。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-0c 失败提示 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-0c job failure surfacing DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { seedWorkforceFixture } = await import("@/lib/workforce-runtime/__tests__/helpers");
  const { createWorkforceJob } = await import("@/lib/workforce-runtime/job");
  const { processWorkforceJobSlice, processQueuedWorkforceJobs, WORKFORCE_MAX_ATTEMPTS } = await import("@/lib/workforce-runtime/processor");
  const { onWorkforceJobStopped } = await import("@/lib/workforce-runtime/domain-hooks");
  const { TENDER_JOB_FAILED_SURFACED_AUDIT_ACTION } = await import("../job-failure-surfacing");
  const { buildWorkforceTenderIdempotencyKey, TENDER_WORKFORCE_ANALYSIS_VERSION } = await import("../analysis-run-service");
  const { getTenderWorkforceAnalysisStatus } = await import("../trigger-service");
  const { getWorkforceJobView } = await import("@/lib/workforce-runtime/read-model/service");

  console.log("CHAIN-0c job failure surfacing — isolated DB");
  const fx = await seedWorkforceFixture("cf");
  const ORG = fx.orgId;
  const OWNER = fx.ownerUserId; // 发起人
  const LEAD = fx.approverUserId; // 项目负责人（不同的人：两人各收一条通知）
  process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = "1";

  const projectIds: string[] = [];
  const jobIds: string[] = [];
  let seq = 0;
  async function mkProject() {
    seq += 1;
    const p = await db.project.create({ data: { name: `Fixture Tender ${fx.tag}-${seq}`, orgId: ORG, ownerId: LEAD, workDomain: "tender", intakeStatus: "dispatched" }, select: { id: true } });
    projectIds.push(p.id);
    return p.id;
  }
  async function mkJob(projectId: string | null, opts: { tender?: boolean } = {}) {
    const created = await createWorkforceJob({
      orgId: ORG, userId: OWNER, role: "sales", goal: "分析这份招标文件", channel: "workforce", projectId,
      workDomain: opts.tender === false ? ("general" as const) : ("tender" as const),
    } as Parameters<typeof createWorkforceJob>[0]);
    if (!created.ok) throw new Error(`createWorkforceJob failed: ${JSON.stringify(created)}`);
    jobIds.push(created.jobId);
    return created.jobId;
  }
  async function mkRun(projectId: string, jobId: string, status = "AGENT_ANALYZING") {
    return db.tenderAnalysisRun.create({
      data: {
        orgId: ORG, projectId, status, idempotencyKey: buildWorkforceTenderIdempotencyKey(jobId), sourceHashFingerprint: "fixture",
        createdById: OWNER, analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      },
      select: { id: true },
    });
  }
  const runOf = (id: string) => db.tenderAnalysisRun.findUniqueOrThrow({ where: { id }, select: { status: true, errorCode: true, errorMessageSanitized: true } });
  const notesOf = (runId: string) => db.notification.findMany({ where: { orgId: ORG, entityType: "tender_analysis_run", entityId: runId }, select: { userId: true, summary: true } });
  const auditsOf = (jobId: string) => db.auditLog.count({ where: { orgId: ORG, action: TENDER_JOB_FAILED_SURFACED_AUDIT_ACTION, targetId: jobId } });
  async function mkSteps(jobId: string, steps: Array<{ title: string; status: string; errorCode?: string; errorMessage?: string }>) {
    for (const [i, s] of steps.entries()) {
      await db.agentRunStep.create({
        data: { orgId: ORG, runId: jobId, stepKey: `step_${i + 1}`, title: s.title, status: s.status, errorCode: s.errorCode ?? null, errorMessage: s.errorMessage ?? null, createdAt: new Date(Date.now() - (10 - i) * 1000) },
      });
    }
  }

  try {
    // —— 1. 真处理器：发起人身份失效 → needs_human → 收尾 ——
    const p1 = await mkProject();
    const j1 = await mkJob(p1);
    const r1 = await mkRun(p1, j1);
    await db.organizationMember.updateMany({ where: { orgId: ORG, userId: OWNER }, data: { status: "inactive" } });
    const s1 = await processWorkforceJobSlice(j1);
    await db.organizationMember.updateMany({ where: { orgId: ORG, userId: OWNER }, data: { status: "active" } });
    const run1 = await runOf(r1.id);
    ok(s1.claimed && "status" in s1 && s1.status === "needs_human", "处理器把招投标 Job 写成需要人工处理", s1);
    ok(run1.status === "AGENT_FAILED" && run1.errorMessageSanitized === "系统未记录原因", "需要人工处理 → 分析记录「AI 分析未完成」，还没有步骤时原因写「系统未记录原因」", run1);
    ok((await auditsOf(j1)) === 1, "写一条审计 tender.workforce.failed_surfaced");

    // —— 2. 真处理器：没有 goal → failed → 收尾 ——
    const p2 = await mkProject();
    const j2 = await mkJob(p2);
    const r2 = await mkRun(p2, j2);
    const meta2 = (await db.agentRun.findUniqueOrThrow({ where: { id: j2 }, select: { metadata: true } })).metadata as Record<string, unknown>;
    await db.agentRun.update({ where: { id: j2 }, data: { metadata: { ...meta2, goal: "" } } });
    const s2 = await processWorkforceJobSlice(j2);
    const run2 = await runOf(r2.id);
    ok(s2.claimed && "status" in s2 && s2.status === "failed", "处理器把招投标 Job 写成失败", s2);
    ok(run2.status === "AGENT_FAILED", "失败 → 分析记录「AI 分析未完成」", run2);

    // —— 3. 第 3 步失败的原因、两人各一条通知、重放不重复 ——
    const p3 = await mkProject();
    const j3 = await mkJob(p3);
    const r3 = await mkRun(p3, j3);
    await mkSteps(j3, [
      { title: "校验输入", status: "completed" },
      { title: "解析投标文件", status: "completed" },
      { title: "Canonical V2 包级分析", status: "failed", errorCode: "tool_failed", errorMessage: "ANALYSIS_EMPTY: 本次分析零成功模型调用（12/12 次调用失败）" },
      { title: "要求抽取", status: "pending" },
    ]);
    await db.agentRun.update({ where: { id: j3 }, data: { status: "failed", errorCode: "model_failed", errorMessage: "Error: boom\n    at x (/var/task/a.js:1:1)" } });
    await onWorkforceJobStopped({ runId: j3 });
    const run3 = await runOf(r3.id);
    const expected = "卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析";
    ok(run3.status === "AGENT_FAILED" && run3.errorMessageSanitized === expected, "原因：卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析", run3);
    const n3 = await notesOf(r3.id);
    ok(n3.length === 2 && [OWNER, LEAD].every((u) => n3.some((n) => n.userId === u)), "发起人与项目负责人各收到一条失败通知", n3.map((n) => n.userId));
    ok(n3.every((n) => (n.summary ?? "").includes("卡在第 3 步") && (n.summary ?? "").includes("重新发起分析") && !(n.summary ?? "").includes("ANALYSIS_EMPTY") && !(n.summary ?? "").includes("/var/task")), "通知摘要写明卡在第 3 步与重新发起，不含原始错误文本", n3.map((n) => n.summary));
    await onWorkforceJobStopped({ runId: j3 });
    ok((await auditsOf(j3)) === 1 && (await notesOf(r3.id)).length === 2, "重放收尾：审计仍一条、通知仍各一条");

    // —— 4. 已待审阅的不改 ——
    const p4 = await mkProject();
    const j4 = await mkJob(p4);
    const r4 = await mkRun(p4, j4, "REVIEW_REQUIRED");
    await db.agentRun.update({ where: { id: j4 }, data: { status: "failed" } });
    await onWorkforceJobStopped({ runId: j4 });
    ok((await runOf(r4.id)).status === "REVIEW_REQUIRED" && (await notesOf(r4.id)).length === 0 && (await auditsOf(j4)) === 0, "分析记录已是待审阅：不改、不通知、不写审计");

    // —— 5. 非招投标 Job 不触发 ——
    const j5 = await mkJob(null, { tender: false });
    await db.agentRun.update({ where: { id: j5 }, data: { status: "failed" } });
    const n5Before = await db.notification.count({ where: { orgId: ORG, type: "runtime_failed" } });
    await onWorkforceJobStopped({ runId: j5 });
    const n5 = (await db.notification.count({ where: { orgId: ORG, type: "runtime_failed" } })) - n5Before;
    ok((await auditsOf(j5)) === 0 && n5 === 0, "非招投标（general 域）Job 失败：没有审计、没有招投标失败通知");

    // —— 5b. 发起人为空：审计主体用项目负责人 ——
    const p5 = await mkProject();
    const j5b = await mkJob(p5);
    const r5b = await mkRun(p5, j5b);
    await db.tenderAnalysisRun.update({ where: { id: r5b.id }, data: { createdById: null } });
    await db.agentRun.update({ where: { id: j5b }, data: { status: "failed" } });
    await onWorkforceJobStopped({ runId: j5b });
    const a5b = await db.auditLog.findFirst({ where: { orgId: ORG, action: TENDER_JOB_FAILED_SURFACED_AUDIT_ACTION, targetId: j5b }, select: { userId: true } });
    ok((await runOf(r5b.id)).status === "AGENT_FAILED" && a5b?.userId === LEAD, "发起人为空：照样收尾，审计记在项目负责人名下", a5b);

    // —— 6. 清扫：租约过期且重试耗尽 → failed → 收尾 ——
    const p6 = await mkProject();
    const j6 = await mkJob(p6);
    const r6 = await mkRun(p6, j6);
    await db.agentRun.update({ where: { id: j6 }, data: { status: "running", attempts: WORKFORCE_MAX_ATTEMPTS, leaseExpiresAt: new Date(Date.now() - 60_000) } });
    await processQueuedWorkforceJobs(1);
    const job6 = await db.agentRun.findUniqueOrThrow({ where: { id: j6 }, select: { status: true } });
    const run6 = await runOf(r6.id);
    ok(job6.status === "failed" && run6.status === "AGENT_FAILED" && (await auditsOf(j6)) === 1, "清扫写成 failed 的 Job 也收尾", { job6, run6 });

    // —— 7. 项目卡片接口带原因 ——
    const status3 = await getTenderWorkforceAnalysisStatus({ orgId: ORG, projectId: p3 });
    ok(status3.latestAnalysisRun?.status === "AGENT_FAILED" && status3.latestAnalysisRun.failureReason === expected, "项目卡片接口：最近分析带原因", status3.latestAnalysisRun);
    const p7 = await mkProject();
    const j7 = await mkJob(p7);
    const r7 = await mkRun(p7, j7);
    await db.tenderAnalysisRun.update({ where: { id: r7.id }, data: { status: "AGENT_FAILED", errorCode: "cancelled", errorMessageSanitized: "用户重新发起" } });
    const status7 = await getTenderWorkforceAnalysisStatus({ orgId: ORG, projectId: p7 });
    ok(status7.latestAnalysisRun?.failureReason === undefined, "用户主动取消的分析不给原因");

    // —— 8. FIX-20：第 3 步余额不足、Job 被写成 needs_human / blocked_graph → 错误码取那一步的，三处一字不差 ——
    const p8 = await mkProject();
    const j8 = await mkJob(p8);
    const r8 = await mkRun(p8, j8);
    await mkSteps(j8, [
      { title: "校验输入", status: "completed" },
      { title: "解析投标文件", status: "completed" },
      { title: "Canonical V2 包级分析", status: "failed", errorCode: "model_quota_exhausted", errorMessage: "TOOL_FAILED: 429 You exceeded your current quota, please check your plan and billing details" },
      { title: "要求抽取", status: "pending" },
    ]);
    await db.agentRun.update({ where: { id: j8 }, data: { status: "needs_human", errorCode: "blocked_graph", errorMessage: "步骤依赖无法推进" } });
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); origLog(...args); };
    try {
      await onWorkforceJobStopped({ runId: j8 });
    } finally {
      console.log = origLog;
    }
    const expected8 = "卡在第 3 步〈Canonical V2 包级分析〉：AI 账户余额不足，请联系平台管理员充值";
    const run8 = await runOf(r8.id);
    ok(run8.status === "AGENT_FAILED" && run8.errorCode === "model_quota_exhausted" && run8.errorMessageSanitized === expected8, "分析记录：错误码取第 3 步的 model_quota_exhausted，原因写余额不足", run8);
    ok(logged.some((l) => l.includes(`[tender-alert] run=${r8.id}`) && l.includes("code=model_quota_exhausted")), "[tender-alert] 日志写 code=model_quota_exhausted", logged.filter((l) => l.includes("tender-alert")));
    const n8 = await db.notification.findMany({ where: { orgId: ORG, entityType: "tender_analysis_run", entityId: r8.id }, select: { summary: true, metadata: true } });
    // Notification.metadata 存的是 JSON 字符串
    const meta8 = (m: unknown) => (typeof m === "string" ? (JSON.parse(m) as { errorCode?: string }) : (m as { errorCode?: string } | null));
    ok(n8.length === 2 && n8.every((n) => meta8(n.metadata)?.errorCode === "model_quota_exhausted"), "失败通知元数据里的错误码相同", n8.map((n) => n.metadata));
    ok(n8.every((n) => (n.summary ?? "").includes(expected8) && !(n.summary ?? "").includes("quota") && !(n.summary ?? "").includes("前置步骤没有完成")), "通知摘要写那一步自己的原因，不含 quota 与「前置步骤没有完成」", n8.map((n) => n.summary));
    const view8 = await getWorkforceJobView({ orgId: ORG, jobId: j8 });
    const card8 = await getTenderWorkforceAnalysisStatus({ orgId: ORG, projectId: p8 });
    ok(view8.ok && view8.view.stopReason?.sentenceZh === expected8 && card8.latestAnalysisRun?.failureReason === expected8, "三处一字不差：作业详情视图的停止原因 = 项目卡片接口的原因 = 通知摘要里的原因", { view: view8.ok ? view8.view.stopReason : null, card: card8.latestAnalysisRun?.failureReason });
  } finally {
    await db.organizationMember.updateMany({ where: { orgId: ORG, userId: OWNER }, data: { status: "active" } }).catch(() => undefined);
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: ORG } });
    await db.agentRunEvent.deleteMany({ where: { runId: { in: jobIds } } }).catch(() => undefined);
    await db.agentRunStep.deleteMany({ where: { runId: { in: jobIds } } }).catch(() => undefined);
    await db.agentRun.deleteMany({ where: { id: { in: jobIds } } }).catch(() => undefined);
    await db.agentSession.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: ORG } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [OWNER, LEAD] } } }).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(`CHAIN-0c job failure surfacing DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
