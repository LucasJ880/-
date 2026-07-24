/**
 * 只读验证 Agent Runtime 2.0 migration 结构（不修改数据、不 reset）
 *
 * 运行：npx tsx scripts/verify-agent-runtime-v2-migration.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Row = Record<string, unknown>;

async function q<T extends Row>(sql: string): Promise<T[]> {
  return db.$queryRawUnsafe<T[]>(sql);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`VERIFY_FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("▶ verify Agent Runtime V2 migration (read-only)");

  // 环境身份（脱敏）
  const url = process.env.DATABASE_URL ?? "";
  const hostMatch = url.match(/@([^/]+)\//);
  const host = hostMatch?.[1] ?? "(unknown)";
  console.log(`  DB host: ${host}`);
  const looksProdName = /prod|production/i.test(host);
  console.log(
    `  env guess: ${looksProdName ? "POSSIBLE_PRODUCTION_NAME" : "shared/non-prod host pattern"}`,
  );
  assert(
    host.includes("ep-super-field-antfibsl") || host.includes("neon.tech"),
    "connected to expected Neon-family host (shared project pattern)",
  );

  const agentRunCols = await q<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='AgentRun'
      AND column_name IN ('planJson','runtimeVersion')
    ORDER BY column_name
  `);
  assert(
    agentRunCols.some((c) => c.column_name === "planJson" && c.data_type === "jsonb"),
    "AgentRun.planJson is jsonb",
  );
  assert(
    agentRunCols.some(
      (c) => c.column_name === "runtimeVersion" && c.data_type === "text",
    ),
    "AgentRun.runtimeVersion is text",
  );

  const stepCols = await q<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='AgentRunStep'
  `);
  const stepNames = new Set(stepCols.map((c) => c.column_name));
  for (const col of [
    "id",
    "orgId",
    "runId",
    "stepKey",
    "title",
    "status",
    "dependsOnJson",
    "preferredTool",
    "executionMode",
    "riskLevel",
    "requiresApproval",
    "attemptCount",
    "maxAttempts",
    "inputJson",
    "outputJson",
    "evidenceJson",
    "pendingActionId",
    "idempotencyKey",
    "errorCode",
    "errorMessage",
    "startedAt",
    "completedAt",
    "createdAt",
    "updatedAt",
  ]) {
    assert(stepNames.has(col), `AgentRunStep.${col} exists`);
  }

  const verCols = await q<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='AgentRunVerification'
  `);
  const verNames = new Set(verCols.map((c) => c.column_name));
  for (const col of [
    "id",
    "orgId",
    "runId",
    "attempt",
    "verdict",
    "summary",
    "satisfiedCriteriaJson",
    "unsatisfiedCriteriaJson",
    "evidenceReferencesJson",
    "repairInstructionsJson",
    "createdAt",
  ]) {
    assert(verNames.has(col), `AgentRunVerification.${col} exists`);
  }

  const indexes = await q<{ indexname: string }>(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public'
      AND tablename IN ('AgentRunStep','AgentRunVerification','AgentRun','PendingAction')
  `);
  const idx = new Set(indexes.map((i) => i.indexname));
  assert(idx.has("AgentRunStep_runId_stepKey_key"), "unique AgentRunStep(runId,stepKey)");
  assert(
    idx.has("AgentRunStep_orgId_idempotencyKey_key"),
    "unique AgentRunStep(orgId,idempotencyKey)",
  );
  assert(
    idx.has("AgentRunVerification_runId_attempt_key"),
    "unique AgentRunVerification(runId,attempt)",
  );
  assert(
    idx.has("AgentRun_orgId_runtimeVersion_status_idx"),
    "index AgentRun(orgId,runtimeVersion,status)",
  );

  const paIdem = await q<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='PendingAction'
      AND column_name='idempotencyKey'
  `);
  assert(paIdem.length === 1, "PendingAction.idempotencyKey exists (forward-fix)");
  assert(
    idx.has("PendingAction_orgId_idempotencyKey_key"),
    "unique PendingAction(orgId,idempotencyKey)",
  );

  const fks = await q<{ conname: string }>(`
    SELECT conname FROM pg_constraint
    WHERE contype='f'
      AND conrelid IN ('"AgentRunStep"'::regclass, '"AgentRunVerification"'::regclass)
  `);
  const fkNames = fks.map((f) => f.conname).join(",");
  assert(fkNames.includes("AgentRunStep_runId_fkey"), "FK AgentRunStep.runId → AgentRun");
  assert(
    fkNames.includes("AgentRunVerification_runId_fkey"),
    "FK AgentRunVerification.runId → AgentRun",
  );

  const migrations = await q<{ migration_name: string }>(`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE migration_name IN (
      '20260724120000_agent_runtime_v2_steps',
      '20260724180000_pending_action_idempotency_key'
    )
    ORDER BY migration_name
  `);
  assert(
    migrations.some((m) => m.migration_name === "20260724120000_agent_runtime_v2_steps"),
    "migration record agent_runtime_v2_steps present",
  );
  // 幂等列 migration 可能尚未 deploy；若列已存在则要求 record 或接受 forward SQL 已执行
  if (paIdem.length === 1) {
    const hasRecord = migrations.some(
      (m) => m.migration_name === "20260724180000_pending_action_idempotency_key",
    );
    if (!hasRecord) {
      console.log(
        "  ⚠ PendingAction.idempotencyKey 存在但 migration record 可能尚未写入；请执行 migrate deploy",
      );
    } else {
      assert(true, "migration record pending_action_idempotency_key present");
    }
  }

  console.log("\nVERIFY_OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
