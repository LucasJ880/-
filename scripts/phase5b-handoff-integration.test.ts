/**
 * Phase 5B：隔离库 Handoff 并发 + 故障注入 + 响应丢失重试
 *
 * 要求：
 *   DATABASE_URL / DIRECT_URL 指向隔离 Neon（禁止生产）
 *   ALLOW_HANDOFF_INTEGRATION_TEST=true
 *
 * 运行：
 *   ALLOW_HANDOFF_INTEGRATION_TEST=true npx tsx scripts/phase5b-handoff-integration.test.ts
 */

import { PrismaClient } from "@prisma/client";
import { ensureTestUserOrg, cleanupTestUserOrg } from "../src/lib/test-fixtures/org-user";
import { executeAwardHandoff, HandoffError } from "../src/lib/projects/handoff/execute";
import type { HandoffFaultPoint } from "../src/lib/projects/handoff/fault-injection";

import { assertSafeTestDatabase } from "../src/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "scripts/phase5b-handoff-integration.test.ts" });

const db = new PrismaClient();
let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

function assertSafeHost(url: string) {
  const host = new URL(url.replace(/^postgresql:/i, "http:")).hostname.toLowerCase();
  if (
    host.includes("ep-super-field") ||
    host.includes("ep-raspy-credit") ||
    host.includes("prod")
  ) {
    throw new Error(`拒绝在受保护主机上跑集成测试: ${host}`);
  }
  console.log(`[phase5b-handoff] host=${host}`);
}

async function seedTender(stamp: string) {
  const userId = `p5b_user_${stamp}`;
  const orgId = `p5b_org_${stamp}`;
  await ensureTestUserOrg(db, {
    userId,
    orgId,
    email: `p5b_${stamp}@test.local`,
    orgCode: `p5b_${stamp}`,
  });
  const tender = await db.project.create({
    data: {
      name: `P5B Tender ${stamp}`,
      orgId,
      ownerId: userId,
      workDomain: "tender",
      tenderStatus: "won",
      winningBidPrice: 12000,
      currency: "CAD",
      status: "active",
      projectTypes: ["install"],
    },
  });
  return { userId, orgId, tenderId: tender.id };
}

async function cleanupSeed(input: {
  userId: string;
  orgId: string;
  tenderId: string;
}) {
  const handoffs = await db.projectHandoff.findMany({
    where: { orgId: input.orgId },
    select: { id: true, targetDeliveryProjectId: true },
  });
  const deliveryIds = handoffs
    .map((h) => h.targetDeliveryProjectId)
    .filter((id): id is string => Boolean(id));
  const handoffIds = handoffs.map((h) => h.id);

  if (handoffIds.length) {
    await db.task.deleteMany({
      where: { sourceId: { in: handoffIds } },
    });
  }
  if (deliveryIds.length) {
    await db.task.deleteMany({ where: { projectId: { in: deliveryIds } } });
    await db.projectMember.deleteMany({
      where: { projectId: { in: deliveryIds } },
    });
    await db.projectMessage
      .deleteMany({ where: { projectId: { in: deliveryIds } } })
      .catch(() => undefined);
    await db.projectConversation
      .deleteMany({ where: { projectId: { in: deliveryIds } } })
      .catch(() => undefined);
    await db.environment
      .deleteMany({ where: { projectId: { in: deliveryIds } } })
      .catch(() => undefined);
    await db.projectHandoff.updateMany({
      where: { orgId: input.orgId },
      data: { targetDeliveryProjectId: null },
    });
    await db.project.deleteMany({ where: { id: { in: deliveryIds } } });
  }
  await db.projectHandoff.deleteMany({ where: { orgId: input.orgId } });
  await db.auditLog.deleteMany({ where: { orgId: input.orgId } }).catch(() => undefined);
  await db.task.deleteMany({ where: { projectId: input.tenderId } });
  await db.project.deleteMany({ where: { id: input.tenderId } });
  await cleanupTestUserOrg(db, {
    userIds: [input.userId],
    orgIds: [input.orgId],
  });
}

async function countArtifacts(orgId: string, tenderId: string) {
  const handoffs = await db.projectHandoff.findMany({ where: { orgId } });
  const deliveries = await db.project.findMany({
    where: { orgId, workDomain: "delivery", sourceTenderProjectId: tenderId },
  });
  const handoffIds = handoffs.map((h) => h.id);
  const tasks = handoffIds.length
    ? await db.task.findMany({
        where: { sourceType: "project_handoff", sourceId: { in: handoffIds } },
      })
    : [];
  const templateKeys = tasks.map((t) => t.sourceTemplateKey);
  const uniqueTemplates = new Set(templateKeys);
  return {
    handoffs,
    deliveries,
    tasks,
    templateDup: templateKeys.length !== uniqueTemplates.size,
  };
}

async function testConcurrency() {
  console.log("\n== concurrency ==");
  const stamp = `c_${Date.now()}`;
  const seed = await seedTender(stamp);
  try {
    const payload = {
      deliveryOwnerId: seed.userId,
      deliveryName: `Delivery ${stamp}`,
      overrideReason: "phase5b isolation concurrency",
      conditionalFlags: { installation: true },
    };
    const input = {
      sourceProjectId: seed.tenderId,
      orgId: seed.orgId,
      actorUserId: seed.userId,
      actorName: "P5B",
      canOverride: true,
      payload,
    };

    const settled = await Promise.allSettled([
      executeAwardHandoff(input),
      executeAwardHandoff(input),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled") as Array<
      PromiseFulfilledResult<Awaited<ReturnType<typeof executeAwardHandoff>>>
    >;
    const rejected = settled.filter((s) => s.status === "rejected") as Array<
      PromiseRejectedResult
    >;

    ok(fulfilled.length >= 1, "至少一路成功");
    const targets = new Set(
      fulfilled
        .map((f) => f.value.targetDeliveryProjectId)
        .filter(Boolean) as string[],
    );
    ok(targets.size <= 1, "成功响应最多一个 target");

    for (const r of rejected) {
      const err = r.reason;
      const msg = err instanceof Error ? err.message : String(err);
      ok(!/P2002/i.test(msg), "拒绝路径不暴露 P2002");
      ok(!/Unique constraint/i.test(msg), "拒绝路径不暴露唯一约束原文");
      ok(
        err instanceof HandoffError &&
          (err.code === "IN_PROGRESS" || err.code === "INTERNAL" || err.code === "ALREADY_COMPLETED"),
        `拒绝为结构化 HandoffError（${err instanceof HandoffError ? err.code : "n/a"}）`,
      );
    }

    // 若一路 processing，短等后重试应收敛
    if (fulfilled.length === 0 || (fulfilled[0] && !fulfilled[0].value.targetDeliveryProjectId)) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const retry = await executeAwardHandoff(input);
    ok(retry.status === "completed" && !!retry.targetDeliveryProjectId, "收敛后可拿到 completed target");

    const art = await countArtifacts(seed.orgId, seed.tenderId);
    ok(art.handoffs.filter((h) => h.status === "completed").length === 1, "仅一条 completed handoff");
    ok(art.deliveries.length === 1, "仅一个 delivery Project");
    ok(art.tasks.length >= 1, "有交接任务");
    ok(!art.templateDup, "sourceTemplateKey 无重复");
    ok(
      art.tasks.every((t) => t.projectId === art.deliveries[0]?.id),
      "Task 挂在唯一 delivery 上",
    );
  } finally {
    await cleanupSeed(seed);
  }
}

async function runWithFault(point: HandoffFaultPoint, stamp: string) {
  process.env.ALLOW_HANDOFF_FAULT_INJECTION = "true";
  process.env.HANDOFF_FAULT_POINT = point;
  const seed = await seedTender(stamp);
  const input = {
    sourceProjectId: seed.tenderId,
    orgId: seed.orgId,
    actorUserId: seed.userId,
    actorName: "P5B",
    canOverride: true,
    payload: {
      deliveryOwnerId: seed.userId,
      deliveryName: `Fault ${stamp}`,
      overrideReason: "phase5b fault injection",
    },
  };
  let error: unknown = null;
  let result: Awaited<ReturnType<typeof executeAwardHandoff>> | null = null;
  try {
    result = await executeAwardHandoff(input);
  } catch (e) {
    error = e;
  }
  delete process.env.HANDOFF_FAULT_POINT;
  delete process.env.ALLOW_HANDOFF_FAULT_INJECTION;
  return { seed, input, error, result };
}

async function testFaultInjection() {
  console.log("\n== fault injection ==");
  const inTxPoints: HandoffFaultPoint[] = [
    "before_processing",
    "after_delivery_created",
    "after_source_link",
    "after_first_task",
    "after_all_tasks",
    "on_audit_log",
    "before_completed_update",
  ];

  for (const point of inTxPoints) {
    const stamp = `f_${point}_${Date.now()}`;
    const { seed, input, error, result } = await runWithFault(point, stamp);
    try {
      if (point === "before_processing") {
        ok(error instanceof HandoffError || error instanceof Error, `${point}: 抛错`);
        const art = await countArtifacts(seed.orgId, seed.tenderId);
        ok(art.deliveries.length === 0, `${point}: 无 delivery`);
        ok(art.tasks.length === 0, `${point}: 无 task`);
        ok(
          art.handoffs.every((h) => h.status !== "completed"),
          `${point}: 无 completed`,
        );
      } else if (point === "after_completed_before_response") {
        // handled below
      } else {
        ok(error instanceof HandoffError, `${point}: HandoffError`);
        const msg = error instanceof Error ? error.message : "";
        ok(!/P2002|Unique constraint/i.test(msg), `${point}: 无 DB 原文`);
        const art = await countArtifacts(seed.orgId, seed.tenderId);
        ok(art.deliveries.length === 0, `${point}: 事务回滚无 delivery`);
        ok(art.tasks.length === 0, `${point}: 事务回滚无 task`);
        ok(
          !art.handoffs.some((h) => h.status === "completed"),
          `${point}: 无 completed`,
        );
        // 安全重试（关闭故障）
        const retry = await executeAwardHandoff(input);
        ok(retry.status === "completed" && !!retry.targetDeliveryProjectId, `${point}: 可安全重试`);
        const art2 = await countArtifacts(seed.orgId, seed.tenderId);
        ok(art2.deliveries.length === 1, `${point}: 重试后仅 1 delivery`);
      }
      void result;
    } finally {
      await cleanupSeed(seed);
    }
  }

  // after_completed_before_response：库已完成，catch 应返回既有 target 或可重试
  {
    const point: HandoffFaultPoint = "after_completed_before_response";
    const stamp = `f_${point}_${Date.now()}`;
    const { seed, input, error, result } = await runWithFault(point, stamp);
    try {
      const art = await countArtifacts(seed.orgId, seed.tenderId);
      ok(art.handoffs.some((h) => h.status === "completed"), `${point}: DB 已 completed`);
      ok(art.deliveries.length === 1, `${point}: 有且仅有 1 delivery`);
      // 当前实现 catch 会恢复为成功返回
      ok(
        (result?.status === "completed" && !!result.targetDeliveryProjectId) ||
          error instanceof HandoffError,
        `${point}: 响应为 completed 恢复或结构化错误`,
      );
      const retry = await executeAwardHandoff(input);
      ok(
        retry.status === "completed" &&
          retry.targetDeliveryProjectId === art.deliveries[0]?.id,
        `${point}: 重试返回原 target`,
      );
      const art2 = await countArtifacts(seed.orgId, seed.tenderId);
      ok(art2.deliveries.length === 1, `${point}: 重试不创建第二项目`);
      ok(!art2.templateDup, `${point}: 重试不重复任务模板`);
    } finally {
      await cleanupSeed(seed);
    }
  }
}

async function testResponseLossRetry() {
  console.log("\n== response loss retry ==");
  const stamp = `rl_${Date.now()}`;
  const seed = await seedTender(stamp);
  try {
    const input = {
      sourceProjectId: seed.tenderId,
      orgId: seed.orgId,
      actorUserId: seed.userId,
      actorName: "P5B",
      canOverride: true,
      payload: {
        deliveryOwnerId: seed.userId,
        overrideReason: "phase5b response loss",
      },
    };
    const first = await executeAwardHandoff(input);
    ok(first.status === "completed" && !!first.targetDeliveryProjectId, "首次完成");
    const second = await executeAwardHandoff(input);
    ok(second.status === "completed", "重试仍 completed");
    ok(
      second.targetDeliveryProjectId === first.targetDeliveryProjectId,
      "重试同一 target",
    );
    ok(second.created === false, "重试 created=false");
    const art = await countArtifacts(seed.orgId, seed.tenderId);
    ok(art.deliveries.length === 1, "无第二 delivery");
    ok(!art.templateDup, "无重复模板任务");
  } finally {
    await cleanupSeed(seed);
  }
}

async function main() {
  if (process.env.ALLOW_HANDOFF_INTEGRATION_TEST !== "true") {
    console.error("需要 ALLOW_HANDOFF_INTEGRATION_TEST=true");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!url) throw new Error("缺少 DATABASE_URL");
  assertSafeHost(url);

  await testConcurrency();
  await testFaultInjection();
  await testResponseLossRetry();

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  await db.$disconnect();
  if (failed) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
