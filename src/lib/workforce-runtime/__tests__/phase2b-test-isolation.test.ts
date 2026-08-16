/**
 * Workforce Test Isolation Hardening — 隔离契约专项验证（Lane B）
 *
 * IS1  fixture 唯一性：org / users / tag / 幂等键前缀互不碰撞
 * IS2  外部积压免疫：他 org 的更老 eligible queued jobs 存在时，
 *      run-scoped sweep 断言仍然成立（§6/§11）
 * IS3  fixture ownership cleanup：只删自己（他 org 行数不变），
 *      自己名下 workforce job 清零（§5）
 * IS4  cleanup 后共享库不残留本 suite 的任何 eligible job（§4"不依赖
 *      database currently empty"的对偶：也不制造非空污染）
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *       npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  cleanupWorkforceFixture,
  assertNoLeakedWorkforceJobs,
  seedForeignQueuedBacklog,
  sweepUntilRunProcessed,
  fixtureIdempotencyKey,
  ok,
  finish,
  GOLDEN_GOAL,
} from "./helpers";

requireIsolatedTestDb();

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");

  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_EMAIL_CLIENT_ID;

  console.log("Workforce Test Isolation Hardening — 契约验证");

  // ── IS1：fixture 唯一性 ──
  console.log("\n[IS1 fixture uniqueness]");
  const fxA = await seedWorkforceFixture("isoA");
  const fxB = await seedWorkforceFixture("isoB");
  ok(
    fxA.orgId !== fxB.orgId &&
      fxA.ownerUserId !== fxB.ownerUserId &&
      fxA.approverUserId !== fxB.approverUserId &&
      fxA.tag !== fxB.tag,
    "IS1: 每个 fixture 独立 org / users / tag（unique org per suite）",
  );
  ok(
    fixtureIdempotencyKey(fxA, "x") !== fixtureIdempotencyKey(fxB, "x"),
    "IS1: 幂等键按 fixture tag 前缀隔离（unique idempotency scope）",
  );

  // ── IS2：外部积压免疫（他 org 更老的 eligible queued jobs 先占窗口）──
  console.log("\n[IS2 foreign backlog immunity]");
  const foreign = await seedForeignQueuedBacklog(6);
  // foreign backlog 创建在前（createdAt 更老），必然占满单次 take-5 窗口
  const mine = await createWorkforceJob({
    workDomain: "sales",
    orgId: fxA.orgId,
    userId: fxA.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!mine.ok) throw new Error("createWorkforceJob failed");
  const singleSweep = await import("../processor").then((m) =>
    m.processQueuedWorkforceJobs(5),
  );
  ok(
    !singleSweep.runIds.includes(mine.runId),
    "IS2-前提: 单次全局 take-5 确实被更老的 foreign backlog 占据（复现旧 KS7 的污染形态）",
    { picked: singleSweep.runIds.length },
  );
  const swept = await sweepUntilRunProcessed(mine.runId, { maxRounds: 12 });
  ok(
    swept.swept,
    "IS2: run-scoped 轮询断言在 foreign backlog 下仍成立（其他 org 的 queued job 不影响本 suite 判定）",
    swept,
  );

  // ── IS3：ownership cleanup 只删自己 ──
  console.log("\n[IS3 ownership cleanup]");
  const foreignOrgIds = foreign.fixtures.map((f) => f.orgId);
  const foreignRunsBefore = await db.agentRun.count({
    where: { orgId: { in: foreignOrgIds } },
  });
  const cleanedA = await cleanupWorkforceFixture(fxA);
  const foreignRunsAfter = await db.agentRun.count({
    where: { orgId: { in: foreignOrgIds } },
  });
  ok(
    foreignRunsAfter === foreignRunsBefore,
    "IS3: cleanup(fxA) 未触碰他 org 数据（禁止 DELETE all 语义成立）",
    { before: foreignRunsBefore, after: foreignRunsAfter },
  );
  ok(
    await assertNoLeakedWorkforceJobs(fxA),
    "IS3: fxA 名下 workforce job 清零",
    cleanedA.residue,
  );
  const fxARows = await db.pendingAction.count({ where: { orgId: fxA.orgId } });
  ok(fxARows === 0, "IS3: fxA 名下 PendingAction 清零");

  // ── IS4：全部 fixture 清理后无残留 eligible job ──
  console.log("\n[IS4 no eligible residue]");
  const cleanedB = await cleanupWorkforceFixture(fxB);
  let allForeignClean = true;
  for (const f of foreign.fixtures) {
    await cleanupWorkforceFixture(f);
    if (!(await assertNoLeakedWorkforceJobs(f))) allForeignClean = false;
  }
  ok(
    (await assertNoLeakedWorkforceJobs(fxB)) && allForeignClean,
    "IS4: 全部 fixture cleanup 后无 workforce job 泄漏",
    { b: cleanedB.residue },
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
