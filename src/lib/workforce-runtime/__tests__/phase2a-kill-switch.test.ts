/**
 * Workforce Kill-Switch — WORKFORCE_RUNTIME_ENABLED 运行时开关
 *
 * KS0  flag 纯逻辑（processing gate 不看 allowlist）
 * KS1-6 flag off：批量消费与单 slice 均不 claim、不写任何状态、
 *       exhausted 清扫暂停，已排队 job 保持 queued 原状
 * KS7-10 flag on：恢复正常消费（拾取 queued、exhausted 清扫恢复）
 *
 * 运行：DATABASE_URL=<隔离分支> NODE_ENV=test npx tsx <本文件>
 */

import {
  requireIsolatedTestDb,
  seedWorkforceFixture,
  ok,
  finish,
  GOLDEN_GOAL,
} from "./helpers";

requireIsolatedTestDb();

async function main() {
  const { db } = await import("@/lib/db");
  const { createWorkforceJob } = await import("../job");
  const {
    processWorkforceJobSlice,
    processQueuedWorkforceJobs,
    WORKFORCE_MAX_ATTEMPTS,
  } = await import("../processor");
  const { isWorkforceProcessingEnabledWithEnv } = await import("../flags");

  console.log("Workforce Kill-Switch — processing gate");

  // ── KS0：flag 纯逻辑 ──
  ok(
    isWorkforceProcessingEnabledWithEnv({ WORKFORCE_RUNTIME_ENABLED: "1" }),
    "KS0a: ENABLED=1 → processing on",
  );
  ok(
    isWorkforceProcessingEnabledWithEnv({ WORKFORCE_RUNTIME_ENABLED: "true" }),
    "KS0b: ENABLED=true → processing on",
  );
  ok(
    !isWorkforceProcessingEnabledWithEnv({ WORKFORCE_RUNTIME_ENABLED: "0" }),
    "KS0c: ENABLED=0 → processing off",
  );
  ok(
    !isWorkforceProcessingEnabledWithEnv({}),
    "KS0d: 未配置 → processing off（fail-closed）",
  );
  ok(
    isWorkforceProcessingEnabledWithEnv({
      WORKFORCE_RUNTIME_ENABLED: "1",
      WORKFORCE_RUNTIME_USER_ALLOWLIST: "someone_else",
    }),
    "KS0e: allowlist 不影响 processing gate（只约束创建）",
  );

  const fx = await seedWorkforceFixture("killswitch");

  // job1：正常 queued job（黄金模板目标，恢复后可确定性规划）
  const job1 = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job1.ok) throw new Error("createWorkforceJob job1 failed");

  // job2：模拟 exhausted（attempts 达上限 + 租约已过期）用于验证清扫也被暂停
  const job2 = await createWorkforceJob({
    orgId: fx.orgId,
    userId: fx.ownerUserId,
    role: "sales",
    goal: GOLDEN_GOAL,
  });
  if (!job2.ok) throw new Error("createWorkforceJob job2 failed");
  await db.agentRun.update({
    where: { id: job2.runId },
    data: {
      status: "executing",
      attempts: WORKFORCE_MAX_ATTEMPTS,
      leaseExpiresAt: new Date(Date.now() - 5_000),
      nextAttemptAt: null,
    },
  });

  const row1Before = await db.agentRun.findUniqueOrThrow({
    where: { id: job1.runId },
  });
  const events1Before = await db.agentRunEvent.count({
    where: { runId: job1.runId },
  });

  // ── flag OFF ──
  process.env.WORKFORCE_RUNTIME_ENABLED = "0";

  const sweepOff = await processQueuedWorkforceJobs(5);
  ok(
    sweepOff.processed === 0 &&
      sweepOff.runIds.length === 0 &&
      sweepOff.exhaustedFailed === 0,
    "KS1: off 时批量消费完全跳过（0 claim / 0 清扫）",
    sweepOff,
  );

  const sliceOff = await processWorkforceJobSlice(job1.runId);
  ok(sliceOff.claimed === false, "KS2: off 时单 slice 不 claim", sliceOff);

  const row1Off = await db.agentRun.findUniqueOrThrow({
    where: { id: job1.runId },
  });
  ok(
    row1Off.status === "queued" &&
      row1Off.leaseExpiresAt === null &&
      row1Off.planJson === null &&
      row1Off.attempts === row1Before.attempts,
    "KS3: job1 保持 queued 原状（无 lease、无 plan、attempts 不变）",
    {
      status: row1Off.status,
      attempts: row1Off.attempts,
      leaseExpiresAt: row1Off.leaseExpiresAt,
    },
  );
  const steps1Off = await db.agentRunStep.count({
    where: { runId: job1.runId },
  });
  ok(steps1Off === 0, "KS4: off 期间未创建任何 step");
  const events1Off = await db.agentRunEvent.count({
    where: { runId: job1.runId },
  });
  ok(events1Off === events1Before, "KS5: off 期间未写任何新事件");

  const row2Off = await db.agentRun.findUniqueOrThrow({
    where: { id: job2.runId },
  });
  ok(
    row2Off.status === "executing",
    "KS6: off 时 exhausted 清扫同样暂停（不判 failed）",
    { status: row2Off.status },
  );

  // ── flag ON：恢复 ──
  process.env.WORKFORCE_RUNTIME_ENABLED = "1";

  const sweepOn = await processQueuedWorkforceJobs(5);
  ok(
    sweepOn.runIds.includes(job1.runId) && sweepOn.processed >= 1,
    "KS7: 开关恢复后重新拾取并处理 queued job",
    sweepOn,
  );
  ok(
    sweepOn.exhaustedFailed >= 1,
    "KS8: 恢复后 exhausted 清扫恢复",
    sweepOn.exhaustedFailed,
  );

  const row1On = await db.agentRun.findUniqueOrThrow({
    where: { id: job1.runId },
  });
  ok(
    row1On.planJson !== null,
    "KS9: 恢复后 job1 正常规划推进（planJson 已持久化）",
    { status: row1On.status },
  );
  const row2On = await db.agentRun.findUniqueOrThrow({
    where: { id: job2.runId },
  });
  ok(
    row2On.status === "failed",
    "KS10: 恢复后 job2 被 exhausted 清扫判 failed",
    { status: row2On.status },
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
