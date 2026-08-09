/**
 * Phase 1.1 Final Gate A — Run Tree DB E2E（真实数据库写入 + 读回验证）
 *
 * 结构：ROOT(RUN-A) → CHILD(RUN-B) → GRANDCHILD(RUN-C)
 * 验证：parentRunId 列、traceId 列、metadata.rootRunId/jobId/taskId/actor/agent/owner
 * 全部持久化正确，且 grandchild 的 rootRunId 不漂移为 parentRunId。
 *
 * 安全：fail-closed —— DATABASE_URL 指向生产 Neon 主机时立即拒绝运行。
 * 只允许在隔离分支 / Preview / 本地数据库执行。
 *
 * 运行：DATABASE_URL=<isolated-branch-url> npx tsx scripts/phase1-1-gate-a-run-tree-e2e.ts
 */

const PRODUCTION_NEON_HOST_PREFIX = "ep-super-field-antfibsl";

function assertIsolatedDatabase(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.trim()) {
    console.error("GATE_A = BLOCKED_BY_DATABASE_ISOLATION（DATABASE_URL 缺失）");
    process.exit(2);
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    console.error("GATE_A = BLOCKED_BY_DATABASE_ISOLATION（DATABASE_URL 无法解析）");
    process.exit(2);
  }
  if (host.startsWith(PRODUCTION_NEON_HOST_PREFIX)) {
    console.error(
      "GATE_A = BLOCKED_BY_DATABASE_ISOLATION（拒绝在生产同源数据库写测试数据）",
    );
    process.exit(2);
  }
  return host;
}

const dbHost = assertIsolatedDatabase();

import { db } from "@/lib/db";
import { createAgentRun } from "@/lib/agent-runtime/run";
import {
  deriveChildRunContext,
  normalizeRuntimeContext,
  readRootRunIdFromUnknown,
  type AIRuntimeContext,
} from "@/lib/ai/runtime-context";

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "scripts/phase1-1-gate-a-run-tree-e2e.ts" });

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function meta(run: { metadata: unknown }): Record<string, unknown> {
  return (run.metadata ?? {}) as Record<string, unknown>;
}

async function main() {
  console.log(`Gate A — isolated DB host: ${dbHost.split(".")[0]}...`);

  const stamp = Date.now();
  const owner = await db.user.create({
    data: {
      email: `gate-a-e2e-${stamp}@test.invalid`,
      name: `GateA-Owner-${stamp}`,
      role: "user",
    },
  });
  const org = await db.organization.create({
    data: {
      name: `GateA-E2E-${stamp}`,
      code: `GATEA${stamp}`,
      owner: { connect: { id: owner.id } },
    },
  });
  const session = await db.agentSession.create({
    data: {
      orgId: org.id,
      channel: "gate-a-e2e",
      status: "active",
    },
  });
  console.log("fixtures created (temp org + session on isolated branch)");

  const TRACE = `tr_gatea_${stamp}`;
  const JOB = "JOB-GATE-A";
  const TASK = "TASK-COMPLIANCE-REVIEW";
  const PROJECT = `proj-gate-a-${stamp}`;

  const rootRuntime: AIRuntimeContext = normalizeRuntimeContext({
    orgId: org.id,
    traceId: TRACE,
    jobId: JOB,
    taskId: TASK,
    projectId: PROJECT,
    actor: { type: "USER", id: "lucas", userId: "lucas" },
    agent: { id: "qingyan-operator", role: "operator" },
    owner: { type: "USER", id: "lucas" },
    source: "gate-a-e2e",
  })!;

  // ── ROOT RUN-A ──
  const { run: runA } = await createAgentRun({
    orgId: org.id,
    sessionId: session.id,
    runType: "gate_a_e2e",
    traceId: TRACE,
    projectId: PROJECT,
    runtime: rootRuntime,
  });

  // ── CHILD RUN-B（模拟子 Agent 执行；仅 correlation，无 delegation）──
  const childRuntime = deriveChildRunContext(
    { ...rootRuntime, runId: runA.id, rootRunId: runA.id },
    {
      runId: "placeholder", // DB 侧 runId 由 createAgentRun 生成；此处仅派生 correlation
      actor: { type: "AGENT", id: "requirement-agent", userId: "lucas" },
      agent: { id: "requirement-agent", role: "requirement" },
    },
  );
  const { run: runB } = await createAgentRun({
    orgId: org.id,
    sessionId: session.id,
    runType: "gate_a_e2e",
    traceId: TRACE,
    parentRunId: runA.id,
    projectId: PROJECT,
    runtime: { ...childRuntime, runId: undefined, parentRunId: undefined, rootRunId: undefined },
    skipUserMessageIdempotency: true,
  });

  // ── GRANDCHILD RUN-C：故意不传 rootRunId，验证从父 Run（RUN-B）推导出原始 root（RUN-A）──
  const grandchildRuntime = deriveChildRunContext(
    { ...childRuntime, runId: runB.id, rootRunId: readRootRunIdFromUnknown(runB.metadata) ?? undefined },
    {
      runId: "placeholder",
      agent: { id: "compliance-agent", role: "tender-compliance" },
    },
  );
  const { run: runC } = await createAgentRun({
    orgId: org.id,
    sessionId: session.id,
    runType: "gate_a_e2e",
    traceId: TRACE,
    parentRunId: runB.id,
    projectId: PROJECT,
    runtime: { ...grandchildRuntime, runId: undefined, parentRunId: undefined, rootRunId: undefined },
    skipUserMessageIdempotency: true,
  });

  // ── 从数据库重新读取（不依赖内存返回值）──
  const [dbA, dbB, dbC] = await Promise.all([
    db.agentRun.findUniqueOrThrow({ where: { id: runA.id } }),
    db.agentRun.findUniqueOrThrow({ where: { id: runB.id } }),
    db.agentRun.findUniqueOrThrow({ where: { id: runC.id } }),
  ]);

  console.log("── ROOT RUN-A ──");
  ok(dbA.parentRunId === null, "parentRunId = null");
  ok(dbA.traceId === TRACE, "traceId 列持久化");
  ok(meta(dbA).rootRunId === dbA.id, "metadata.rootRunId = 自身 runId");
  ok(meta(dbA).jobId === JOB && meta(dbA).taskId === TASK, "metadata.jobId/taskId");
  ok(meta(dbA).actorType === "USER" && meta(dbA).actorId === "lucas", "metadata.actor");
  ok(meta(dbA).agentId === "qingyan-operator", "metadata.agent");
  ok(meta(dbA).ownerType === "USER" && meta(dbA).ownerId === "lucas", "metadata.owner");
  ok(meta(dbA).projectId === PROJECT, "metadata.projectId（TraceContext）");
  ok(meta(dbA).runId === dbA.id, "metadata.runId 回写");

  console.log("── CHILD RUN-B ──");
  ok(dbB.parentRunId === dbA.id, "parentRunId = RUN-A");
  ok(dbB.traceId === TRACE, "traceId 继承");
  ok(meta(dbB).rootRunId === dbA.id, "rootRunId = RUN-A（父即 root）");
  ok(meta(dbB).jobId === JOB && meta(dbB).taskId === TASK, "job/task 继承");
  ok(meta(dbB).actorType === "AGENT" && meta(dbB).actorId === "requirement-agent", "actor = AGENT（与 RUN-A 的 USER 区分）");
  ok(meta(dbB).agentId === "requirement-agent", "agent 身份");
  ok(meta(dbB).ownerId === "lucas", "owner 继承");

  console.log("── GRANDCHILD RUN-C ──");
  ok(dbC.parentRunId === dbB.id, "parentRunId = RUN-B");
  ok(dbC.traceId === TRACE, "traceId 全链继承");
  ok(
    meta(dbC).rootRunId === dbA.id,
    "rootRunId = RUN-A（原始 root，未漂移）",
    `实际: ${String(meta(dbC).rootRunId)} 期望: ${dbA.id}`,
  );
  ok(meta(dbC).rootRunId !== dbB.id, "rootRunId ≠ parentRunId（无 root 漂移）");
  ok(meta(dbC).agentId === "compliance-agent", "grandchild agent 覆盖");
  ok(meta(dbC).jobId === JOB && meta(dbC).taskId === TASK, "job/task 全链保留");

  console.log("── deriveChildRunContext（内存派生 vs DB 推导一致）──");
  ok(grandchildRuntime.rootRunId === dbA.id, "派生 grandchild.rootRunId = original root");
  ok(grandchildRuntime.parentRunId === runB.id, "派生 grandchild.parentRunId = RUN-B");
  ok(grandchildRuntime.traceId === TRACE, "派生 traceId 继承");

  console.log("── metadata 序列化稳定性（二次读回相等）──");
  const reRead = await db.agentRun.findUniqueOrThrow({ where: { id: runC.id } });
  ok(
    JSON.stringify(reRead.metadata) === JSON.stringify(dbC.metadata),
    "两次读回 metadata 字节级一致",
  );

  console.log(`\nRUN-A=${runA.id}\nRUN-B=${runB.id}\nRUN-C=${runC.id}`);
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  console.log(fail === 0 ? "GATE_A = PASS" : "GATE_A = FAIL");
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("GATE_A = FAIL（执行异常）", err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
