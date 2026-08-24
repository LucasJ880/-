/**
 * B2 — 审批 CAS / 重复副作用并发矩阵（真实 DB；真实执行器路径）。
 * 运行（隔离库）：
 *   DATABASE_URL=postgres://... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/pending-actions/__tests__/b2-approval-cas.isolated.test.ts
 * 无隔离库时自动跳过（与 agent-run-event-sequence-deadlock.isolated.test.ts 同一约定）。
 *
 * 副作用探针：grader.internal_note → CUSTOMER 会真实 create CustomerInteraction 行，
 * 行数 == 执行器副作用调用次数（确定性计数）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 B2 审批 CAS 并发矩阵（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
  skip("需 DATABASE_ENVIRONMENT=isolated");
}
assertSafeTestDatabase({ scriptName: "B2 approval CAS concurrency matrix" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { executePendingAction, rejectPendingAction, __setToolPolicyLoaderForTest, B2_DUPLICATE_ERROR_CODES } =
    await import("../executor");
  const { approveApprovalItem } = await import("@/lib/approval/port");

  const stamp = Date.now().toString(36);
  const ORG = `b2org_${stamp}`;
  const A = `b2userA_${stamp}`;
  const B = `b2userB_${stamp}`;
  const CUST = `b2cust_${stamp}`;

  // OrgRule 依赖用既有测试注入座（不触 org-rules 表）
  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  await db.user.create({ data: { id: A, email: `${A}@fixture.test`, name: "Approver A", role: "admin" } });
  await db.user.create({ data: { id: B, email: `${B}@fixture.test`, name: "Approver B", role: "admin" } });
  await db.organization.create({ data: { id: ORG, name: "B2 Fixture Org", code: `b2-${stamp}`, ownerId: A } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: B, role: "org_admin", status: "active" } });
  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "B2 Fixture Customer", createdById: A } });

  const ctxA = { userId: A, role: "admin", orgId: ORG };
  const ctxB = { userId: B, role: "admin", orgId: ORG };

  function notePayload() {
    return {
      targetType: "CUSTOMER",
      targetId: CUST,
      note: "B2 并发测试备注",
      source: "GRADER",
      metadata: { orgId: ORG },
    };
  }
  async function makeAction(over?: Record<string, unknown>) {
    return db.pendingAction.create({
      data: {
        type: "grader.internal_note",
        title: "B2 测试动作",
        preview: "B2 测试动作",
        payload: notePayload(),
        createdById: A,
        orgId: ORG,
        status: "pending",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ...over,
      },
    });
  }
  const interactionCount = () =>
    db.customerInteraction.count({ where: { orgId: ORG, customerId: CUST, channel: "ai_grader" } });

  // ── 1) 并发双批准：恰一个执行权赢家，恰一次副作用 ────────────────
  {
    const action = await makeAction();
    const before = await interactionCount();
    const [ra, rb] = await Promise.all([
      executePendingAction(action.id, ctxA),
      executePendingAction(action.id, ctxB),
    ]);
    const after = await interactionCount();
    const winners = [ra, rb].filter((r) => r.ok && !r.errorCode);
    const losers = [ra, rb].filter((r) => r.errorCode);
    ok(after - before === 1, "并发双批准 → 副作用恰好 1 次（executorInvocationCount===1）", { delta: after - before, ra, rb });
    ok(winners.length === 1, "恰一个 CAS 赢家（无 errorCode 的真实执行结果）", { ra, rb });
    ok(
      losers.length === 1 &&
        [B2_DUPLICATE_ERROR_CODES.inProgress, B2_DUPLICATE_ERROR_CODES.alreadyExecuted].includes(
          losers[0].errorCode as never,
        ),
      "失败方拿到确定性重复结果（IN_PROGRESS 或 ALREADY_EXECUTED），未触发执行器",
      losers,
    );
    const row = await db.pendingAction.findUniqueOrThrow({ where: { id: action.id } });
    ok(row.status === "executed" && !!row.resultRef, "终态 executed + resultRef 落库");
    ok(row.decidedById === A || row.decidedById === B, "执行权归属其中一位审批人（attribution 保留）");
    // 失败方不得覆盖赢家的 decidedById（终态后再次调用也不改写）
    const decidedBy = row.decidedById;
    const loserCtx = decidedBy === A ? ctxB : ctxA;
    await executePendingAction(action.id, loserCtx);
    const row2 = await db.pendingAction.findUniqueOrThrow({ where: { id: action.id } });
    ok(row2.decidedById === decidedBy, "重复请求不改写赢家 attribution（无 last-write-wins）");
  }

  // ── 2) 顺序重复请求：返回既有结果，不再执行 ─────────────────────
  {
    const action = await makeAction();
    const r1 = await executePendingAction(action.id, ctxA);
    const before = await interactionCount();
    const r2 = await executePendingAction(action.id, ctxA);
    const after = await interactionCount();
    ok(r1.ok && !!r1.resultRef, "首次执行成功");
    ok(r2.ok && r2.errorCode === B2_DUPLICATE_ERROR_CODES.alreadyExecuted && r2.resultRef === r1.resultRef, "重复请求 → ALREADY_EXECUTED + 既有 resultRef", r2);
    ok(after === before, "重复请求零副作用");
  }

  // ── 3) 崩溃窗口残留（approved）不可重放 ────────────────────────
  {
    const action = await makeAction();
    await db.pendingAction.update({ where: { id: action.id }, data: { status: "approved", decidedById: A, decidedAt: new Date() } });
    const before = await interactionCount();
    const r = await executePendingAction(action.id, ctxB);
    const after = await interactionCount();
    ok(!r.ok && r.errorCode === B2_DUPLICATE_ERROR_CODES.inProgress, "approved（执行中/崩溃残留）→ EXECUTION_IN_PROGRESS，不重放", r);
    ok(after === before, "approved 重入零副作用（Gmail 类外部副作用重放通道关闭）");
    const row = await db.pendingAction.findUniqueOrThrow({ where: { id: action.id } });
    ok(row.status === "approved" && row.decidedById === A, "残留行状态与归属未被改写（人工处置可见）");
  }

  // ── 4) 终态矩阵：executed/rejected/failed/expired 永不执行 ───────
  {
    for (const status of ["executed", "rejected", "failed"] as const) {
      const action = await makeAction({ status });
      const before = await interactionCount();
      const r = await executePendingAction(action.id, ctxA);
      const after = await interactionCount();
      ok(!(!r.errorCode && r.ok) || status === "executed" ? after === before : false || after === before, `终态 ${status} → 零副作用`);
      ok(status === "executed" ? r.errorCode === B2_DUPLICATE_ERROR_CODES.alreadyExecuted : !r.ok, `终态 ${status} → 确定性拒绝/重复响应`, r);
    }
    const expired = await makeAction({ expiresAt: new Date(Date.now() - 1000) });
    const before = await interactionCount();
    const r = await executePendingAction(expired.id, ctxA);
    const after = await interactionCount();
    const row = await db.pendingAction.findUniqueOrThrow({ where: { id: expired.id } });
    ok(!r.ok && after === before && row.status === "failed", "过期草稿 → failed，零副作用");
  }

  // ── 5) 批准 vs 拒绝竞态：结果一致（绝无 executed+rejected 混合态）──
  {
    const action = await makeAction();
    const before = await interactionCount();
    const [ex, rj] = await Promise.all([
      executePendingAction(action.id, ctxA),
      rejectPendingAction(action.id, ctxB, "并发拒绝"),
    ]);
    const after = await interactionCount();
    const row = await db.pendingAction.findUniqueOrThrow({ where: { id: action.id } });
    if (row.status === "executed") {
      ok(after - before === 1 && ex.ok, "approve 赢 → 恰一次副作用 + executed", { ex, rj });
      ok(!!rj.errorCode, "reject 失败方拿到确定性 code", rj);
    } else {
      ok(row.status === "rejected" && after === before, "reject 赢 → 零副作用 + rejected", { ex, rj });
      ok(ex.errorCode === B2_DUPLICATE_ERROR_CODES.alreadyRejected || ex.errorCode === "EXPIRED", "approve 失败方拿到确定性 code", ex);
    }
  }

  // ── 6) Port 层顺序重复（approveApprovalItem）───────────────────
  {
    const action = await makeAction();
    const r1 = await approveApprovalItem("pending_action", action.id, { userId: A, role: "admin", orgId: ORG });
    const before = await interactionCount();
    const r2 = await approveApprovalItem("pending_action", action.id, { userId: B, role: "admin", orgId: ORG });
    const after = await interactionCount();
    ok(r1.ok === true && r1.status === "executed", "port 首次批准执行成功", r1);
    ok(r2.ok === true && r2.duplicate === true && after === before, "port 重复批准 → duplicate:true 且零副作用", r2);
  }

  // ── 清理 ────────────────────────────────────────────────────────
  __setToolPolicyLoaderForTest(null);
  await db.pendingAction.deleteMany({ where: { orgId: ORG } });
  await db.customerInteraction.deleteMany({ where: { orgId: ORG } });
  await db.auditLog.deleteMany({ where: { userId: { in: [A, B] } } });
  await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
  await db.organizationMember.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.user.deleteMany({ where: { id: { in: [A, B] } } });

  console.log("");
  console.log(`B2 审批 CAS 并发矩阵 结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("B2 isolated test crashed:", e);
  process.exit(1);
});
