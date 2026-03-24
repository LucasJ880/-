/**
 * 阶段推进 — 集成 Smoke Test
 *
 * 运行方式: npx tsx src/lib/tender/__tests__/advance-stage-smoke.test.ts
 *
 * 需要连接真实数据库。会创建测试项目，然后清理。
 *
 * 覆盖场景：
 * 1. 首次推进 initiation → distribution（humanConfirmed）
 * 2. 推进后时间戳 + tenderStatus 已写入
 * 3. 审计日志包含 source / confidence / evidence
 * 4. 重复推进同一目标返回 no_op
 * 5. 连续推进到下一阶段
 * 6. 回退被拒绝
 * 7. 未确认时被拒绝
 * 8. 不存在的项目被拒绝
 * 9. 讨论系统消息写入
 */

import { db } from "@/lib/db";
import {
  advanceProjectStage,
  STAGE_TO_TIMESTAMP,
  STAGE_TO_TENDER_STATUS,
} from "../stage-transition";
import { getProjectStage } from "../stage";

let testProjectId: string | null = null;
let testUserId: string | null = null;
const passed: string[] = [];
const failed: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed.push(name);
    console.log(`  ✅ ${name}`);
  } else {
    failed.push(name);
    console.log(`  ❌ ${name}`);
  }
}

const ACTOR = { id: "", name: "Test User", email: "test@smoke.local" };

// ── Setup / Cleanup ──

async function setup() {
  console.log("\n🔧 Setup...");

  const user = await db.user.findFirst({ where: { role: "super_admin" } });
  if (!user) throw new Error("No super_admin user found — cannot run smoke test");
  testUserId = user.id;
  ACTOR.id = user.id;
  ACTOR.name = user.name || "Test User";
  ACTOR.email = user.email;

  const org = await db.organization.findFirst({ where: { status: "active" } });
  if (!org) throw new Error("No active org found");

  const project = await db.project.create({
    data: {
      name: `__SMOKE_STAGE_${Date.now()}`,
      ownerId: user.id,
      orgId: org.id,
      status: "active",
      // intakeStatus schema 默认 "dispatched"，会让 getProjectStage 返回 "distribution"
      // 显式设为 "pending_dispatch" 以确保从 "initiation" 开始
      intakeStatus: "pending_dispatch",
    },
  });
  testProjectId = project.id;
  console.log(`  Project: ${testProjectId}`);
}

async function cleanup() {
  console.log("\n🧹 Cleanup...");
  if (testProjectId) {
    await db.auditLog.deleteMany({ where: { projectId: testProjectId } });
    await db.projectMessage.deleteMany({ where: { projectId: testProjectId } });
    await db.projectConversation.deleteMany({ where: { projectId: testProjectId } });
    await db.project.delete({ where: { id: testProjectId } }).catch(() => {});
  }
}

// ── Helpers ──

async function freshProject() {
  return db.project.findUniqueOrThrow({ where: { id: testProjectId! } });
}

function toTenderProject(p: Awaited<ReturnType<typeof freshProject>>) {
  return {
    submittedAt: p.submittedAt?.toISOString() ?? null,
    supplierQuotedAt: p.supplierQuotedAt?.toISOString() ?? null,
    supplierInquiredAt: p.supplierInquiredAt?.toISOString() ?? null,
    interpretedAt: p.interpretedAt?.toISOString() ?? null,
    distributedAt: p.distributedAt?.toISOString() ?? null,
    dispatchedAt: p.dispatchedAt?.toISOString() ?? null,
    intakeStatus: p.intakeStatus ?? null,
    tenderStatus: p.tenderStatus ?? null,
    createdAt: p.createdAt?.toISOString() ?? null,
    publicDate: p.publicDate?.toISOString() ?? null,
    questionCloseDate: p.questionCloseDate?.toISOString() ?? null,
    closeDate: p.closeDate?.toISOString() ?? null,
    dueDate: p.dueDate?.toISOString() ?? null,
    awardDate: p.awardDate?.toISOString() ?? null,
  };
}

// ── Test 1: 首次推进 initiation → distribution ──

async function test1_firstAdvance() {
  console.log("\n📌 Test 1: 首次推进 initiation → distribution");

  const before = await freshProject();
  assert(before.distributedAt === null, "初始 distributedAt 为 null");
  assert(getProjectStage(toTenderProject(before)) === "initiation", "初始阶段为 initiation");

  const result = await advanceProjectStage({
    projectId: testProjectId!,
    targetStage: "distribution",
    reason: "Smoke test advance",
    source: "manual",
    actor: ACTOR,
    humanConfirmed: true,
    confidence: 0.95,
    evidence: ["smoke-test-evidence-1"],
  });

  assert(result.success === true, "推进成功");
  assert(
    result.decision === "require_human_review",
    `decision 为 require_human_review (got ${result.decision})`
  );

  const after = await freshProject();
  assert(after.distributedAt !== null, "distributedAt 已写入");
  assert(
    after.tenderStatus === STAGE_TO_TENDER_STATUS["distribution"],
    `tenderStatus 为 ${STAGE_TO_TENDER_STATUS["distribution"]} (got ${after.tenderStatus})`
  );
  assert(
    getProjectStage(toTenderProject(after)) === "distribution",
    "推导阶段变为 distribution"
  );
}

// ── Test 2: 审计日志验证 ──

async function test2_auditLog() {
  console.log("\n📌 Test 2: 审计日志包含 source / confidence / evidence");

  const audit = await db.auditLog.findFirst({
    where: {
      projectId: testProjectId!,
      action: "status_change",
    },
    orderBy: { createdAt: "desc" },
  });

  assert(audit !== null, "审计日志存在");
  if (audit) {
    const afterData = audit.afterData as Record<string, unknown> | null;
    assert(afterData?.source === "manual", "afterData.source = manual");
    assert(afterData?.confidence === 0.95, "afterData.confidence = 0.95");
    assert(
      Array.isArray(afterData?.evidence) &&
        (afterData.evidence as string[]).includes("smoke-test-evidence-1"),
      "afterData.evidence 包含 smoke-test-evidence-1"
    );
    assert(afterData?.humanConfirmed === true, "afterData.humanConfirmed = true");
    assert(afterData?.stage === "distribution", "afterData.stage = distribution");
  }
}

// ── Test 3: 重复推进返回 no_op ──

async function test3_duplicateNoOp() {
  console.log("\n📌 Test 3: 重复推进返回 no_op");

  const result = await advanceProjectStage({
    projectId: testProjectId!,
    targetStage: "distribution",
    reason: "repeat",
    source: "manual",
    actor: ACTOR,
    humanConfirmed: true,
  });

  assert(result.success === true, "重复推进 success = true");
  assert(result.decision === "no_op", `decision 为 no_op (got ${result.decision})`);
}

// ── Test 4: 连续推进 distribution → interpretation ──

async function test4_nextStep() {
  console.log("\n📌 Test 4: 连续推进 distribution → interpretation");

  const result = await advanceProjectStage({
    projectId: testProjectId!,
    targetStage: "interpretation",
    reason: "Continue to interpretation",
    source: "ai_suggestion",
    actor: ACTOR,
    humanConfirmed: true,
    confidence: 0.85,
    evidence: ["文件审阅完成", "资质已核实"],
  });

  assert(result.success === true, "推进成功");

  const after = await freshProject();
  assert(after.interpretedAt !== null, "interpretedAt 已写入");
  assert(
    after.tenderStatus === STAGE_TO_TENDER_STATUS["interpretation"],
    `tenderStatus 为 ${STAGE_TO_TENDER_STATUS["interpretation"]} (got ${after.tenderStatus})`
  );
}

// ── Test 5: 回退被拒绝 ──

async function test5_regressDenied() {
  console.log("\n📌 Test 5: 回退 interpretation → initiation 被拒绝");

  const result = await advanceProjectStage({
    projectId: testProjectId!,
    targetStage: "initiation",
    reason: "try regress",
    source: "manual",
    actor: ACTOR,
    humanConfirmed: true,
  });

  assert(result.success === false, "回退 success = false");
  assert(result.decision === "deny", `decision 为 deny (got ${result.decision})`);
}

// ── Test 6: 未确认时被拒绝 ──

async function test6_unconfirmedRejected() {
  console.log("\n📌 Test 6: humanConfirmed=false 被拒绝");

  const result = await advanceProjectStage({
    projectId: testProjectId!,
    targetStage: "supplier_inquiry",
    reason: "advance without confirm",
    source: "ai_suggestion",
    actor: ACTOR,
    humanConfirmed: false,
  });

  assert(result.success === false, "未确认 success = false");
  assert(
    result.decision === "require_human_review",
    `decision 为 require_human_review (got ${result.decision})`
  );

  // 确认没有写入
  const p = await freshProject();
  assert(p.supplierInquiredAt === null, "supplierInquiredAt 仍为 null（未写入）");
}

// ── Test 7: 不存在的项目 ──

async function test7_projectNotFound() {
  console.log("\n📌 Test 7: 不存在的项目被拒绝");

  const result = await advanceProjectStage({
    projectId: "nonexistent-id-12345",
    targetStage: "distribution",
    reason: "test",
    source: "manual",
    actor: ACTOR,
    humanConfirmed: true,
  });

  assert(result.success === false, "不存在项目 success = false");
  assert(result.decision === "deny", `decision 为 deny (got ${result.decision})`);
}

// ── Test 8: 讨论系统消息写入 ──

async function test8_discussionSystemMessage() {
  console.log("\n📌 Test 8: 推进后讨论系统消息写入");

  const sysMsg = await db.projectMessage.findFirst({
    where: {
      projectId: testProjectId!,
      type: "SYSTEM",
    },
    orderBy: { createdAt: "desc" },
  });

  assert(sysMsg !== null, "存在系统消息");
  if (sysMsg) {
    assert(sysMsg.body.length > 0, "系统消息 body 非空");
  }
}

// ── Test 9: 时间戳字段与映射一致 ──

async function test9_timestampConsistency() {
  console.log("\n📌 Test 9: 所有已推进阶段的时间戳与 tenderStatus 一致");

  const p = await freshProject();

  const tsField = STAGE_TO_TIMESTAMP["distribution"]!;
  assert(
    p[tsField as keyof typeof p] !== null,
    `${tsField} 有值`
  );

  const tsField2 = STAGE_TO_TIMESTAMP["interpretation"]!;
  assert(
    p[tsField2 as keyof typeof p] !== null,
    `${tsField2} 有值`
  );

  // 未推进的阶段仍为 null
  assert(p.supplierInquiredAt === null, "supplierInquiredAt 仍为 null");
  assert(p.supplierQuotedAt === null, "supplierQuotedAt 仍为 null");
  assert(p.submittedAt === null, "submittedAt 仍为 null");
}

// ── Run ──

async function main() {
  console.log("=== 阶段推进 Smoke Test（集成） ===");

  try {
    await setup();
    await test1_firstAdvance();
    await test2_auditLog();
    await test3_duplicateNoOp();
    await test4_nextStep();
    await test5_regressDenied();
    await test6_unconfirmedRejected();
    await test7_projectNotFound();
    await test8_discussionSystemMessage();
    await test9_timestampConsistency();
  } catch (err) {
    console.error("\n💥 Unexpected error:", err);
    failed.push(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await cleanup();
  }

  console.log(`\n通过: ${passed.length}  失败: ${failed.length}`);
  if (failed.length > 0) {
    console.error("\n失败用例:");
    for (const f of failed) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log("全部通过 ✓");
  }

  await db.$disconnect();
}

main();
