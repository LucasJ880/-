/**
 * Workforce Job Read Model — 服务层契约测试
 *
 * 1. 租户隔离：Org B 用户拿不到 Org A 的 Job（orgId+runId 双条件，
 *    NOT_FOUND 不区分"不存在/无权"）；
 * 2. READ_ONLY 证明：spy Reader 记录全部调用（只允许 findFirst/findMany）
 *    + 源码审计（read-model 全目录零 mutation API、零 Runtime core import、
 *    零顶层 db import）；
 * 3. 每条查询都带调用方 orgId（防"只按 runId 查"回归）；
 * 4. includeInternal 默认关闭。
 *
 * 纯内存 fake Reader，零 DB、零 Prisma。
 * 运行：npx tsx src/lib/workforce-runtime/read-model/__tests__/service-read-only.test.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getWorkforceJobView } from "../service";
import type { WorkforceReadModelReader } from "../service";
import type {
  WorkforceEventSnapshot,
  WorkforcePendingActionSnapshot,
  WorkforceRunSnapshot,
  WorkforceStepSnapshot,
} from "../types";
import {
  at,
  makeEvents,
  makePendingAction,
  makePlan,
  makeRun,
  makeStep,
  workingEventPrefix,
} from "./fixtures";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

function section(name: string): void {
  console.log(`\n━━ ${name}`);
}

/* ------------------------------------------------------------------ */
/* Fake Reader（忠实执行 where 过滤 + 记录全部调用）                     */
/* ------------------------------------------------------------------ */

type RecordedCall = { model: string; method: string; args: unknown };

function makeFakeReader(data: {
  runs: WorkforceRunSnapshot[];
  steps: Array<WorkforceStepSnapshot & { runId: string; orgId: string }>;
  events: Array<WorkforceEventSnapshot & { runId: string; orgId: string }>;
  pendingActions: Array<
    WorkforcePendingActionSnapshot & { agentRunId: string; orgId: string }
  >;
}): { reader: WorkforceReadModelReader; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const reader: WorkforceReadModelReader = {
    agentRun: {
      findFirst: async (args) => {
        calls.push({ model: "agentRun", method: "findFirst", args });
        const { id, orgId, runType } = args.where;
        return (
          data.runs.find(
            (r) => r.id === id && r.orgId === orgId && r.runType === runType,
          ) ?? null
        );
      },
    },
    agentRunStep: {
      findMany: async (args) => {
        calls.push({ model: "agentRunStep", method: "findMany", args });
        return data.steps.filter(
          (s) => s.runId === args.where.runId && s.orgId === args.where.orgId,
        );
      },
    },
    agentRunEvent: {
      findMany: async (args) => {
        calls.push({ model: "agentRunEvent", method: "findMany", args });
        return data.events.filter(
          (e) => e.runId === args.where.runId && e.orgId === args.where.orgId,
        );
      },
    },
    pendingAction: {
      findMany: async (args) => {
        calls.push({ model: "pendingAction", method: "findMany", args });
        return data.pendingActions.filter(
          (a) =>
            a.agentRunId === args.where.agentRunId &&
            a.orgId === args.where.orgId,
        );
      },
    },
  };
  return { reader, calls };
}

function seed() {
  const runA = makeRun({
    id: "run_org_a_job",
    orgId: "org_a",
    status: "awaiting_approval",
    planJson: makePlan(["s1", "s2"]),
    startedAt: at(0, 30),
  });
  const runB = makeRun({
    id: "run_org_b_job",
    orgId: "org_b",
    status: "executing",
    planJson: makePlan(["x1"]),
  });
  const nonWorkforce = makeRun({
    id: "run_org_a_chat",
    orgId: "org_a",
    runType: "conversation",
    status: "running",
  });
  return makeFakeReader({
    runs: [runA, runB, nonWorkforce],
    steps: [
      {
        ...makeStep("s1", "completed", { completedAt: at(3) }),
        runId: runA.id,
        orgId: "org_a",
      },
      {
        ...makeStep("s2", "awaiting_approval", { startedAt: at(4) }),
        runId: runA.id,
        orgId: "org_a",
      },
      { ...makeStep("x1", "running"), runId: runB.id, orgId: "org_b" },
    ],
    events: [
      ...makeEvents([
        ...workingEventPrefix(),
        {
          type: "job.waiting_human",
          visible: true,
          title: "等待审批后继续",
          payload: { humanRequirement: { type: "APPROVAL_REQUIRED" } },
        },
      ]).map((e) => ({ ...e, runId: runA.id, orgId: "org_a" })),
      ...makeEvents([{ type: "job.created", visible: true }]).map((e) => ({
        ...e,
        runId: runB.id,
        orgId: "org_b",
      })),
    ],
    pendingActions: [
      {
        ...makePendingAction("pa_a1", "pending", "发送跟进邮件"),
        agentRunId: runA.id,
        orgId: "org_a",
      },
    ],
  });
}

async function main() {
  /* ================================================================ */
  section("TENANT ISOLATION — Org A Job 不被 Org B 读取");
  {
    const { reader } = seed();
    const crossOrg = await getWorkforceJobView(
      { orgId: "org_b", jobId: "run_org_a_job" },
      reader,
    );
    ok(
      !crossOrg.ok && crossOrg.error === "NOT_FOUND",
      "Org B 读 Org A Job → NOT_FOUND",
      crossOrg,
    );

    const sameOrg = await getWorkforceJobView(
      { orgId: "org_a", jobId: "run_org_a_job" },
      reader,
    );
    ok(sameOrg.ok, "Org A 读自己的 Job → ok");
    if (sameOrg.ok) {
      ok(sameOrg.view.jobId === "run_org_a_job", "jobId 正确");
      ok(sameOrg.view.status === "NEEDS_YOU", "投影状态 = NEEDS_YOU");
      ok(
        sameOrg.view.needsYou?.type === "APPROVAL_REQUIRED" &&
          sameOrg.view.needsYou.pendingActionIds?.includes("pa_a1") === true,
        "needsYou 聚合 PendingAction",
        sameOrg.view.needsYou,
      );
    }

    const missing = await getWorkforceJobView(
      { orgId: "org_a", jobId: "run_not_exists" },
      reader,
    );
    ok(
      !missing.ok && missing.error === "NOT_FOUND",
      "不存在的 Job → NOT_FOUND（与越权同型，不可区分）",
    );

    const nonWorkforce = await getWorkforceJobView(
      { orgId: "org_a", jobId: "run_org_a_chat" },
      reader,
    );
    ok(
      !nonWorkforce.ok && nonWorkforce.error === "NOT_FOUND",
      "非 workforce_job run → NOT_FOUND（runType 断言）",
    );

    const emptyOrg = await getWorkforceJobView(
      { orgId: "", jobId: "run_org_a_job" },
      reader,
    );
    ok(!emptyOrg.ok, "空 orgId fail-closed → NOT_FOUND");
  }

  /* ================================================================ */
  section("每条查询强制 orgId（防『只按 runId 查』回归）");
  {
    const { reader, calls } = seed();
    await getWorkforceJobView({ orgId: "org_a", jobId: "run_org_a_job" }, reader);
    ok(calls.length === 4, "恰好 4 条查询（run/steps/events/actions）", calls.length);
    const allScoped = calls.every((c) => {
      const where = (c.args as { where?: Record<string, unknown> }).where;
      return where?.orgId === "org_a";
    });
    ok(allScoped, "全部查询 where.orgId = 调用方 orgId", calls);
    const runCall = calls.find((c) => c.model === "agentRun");
    ok(
      (runCall?.args as { where?: Record<string, unknown> }).where?.runType ===
        "workforce_job",
      "run 查询带 runType=workforce_job",
    );
  }

  /* ================================================================ */
  section("READ_ONLY — spy 证明");
  {
    const { reader, calls } = seed();
    await getWorkforceJobView({ orgId: "org_a", jobId: "run_org_a_job" }, reader);
    await getWorkforceJobView({ orgId: "org_b", jobId: "run_org_b_job" }, reader);
    ok(
      calls.every((c) => c.method === "findFirst" || c.method === "findMany"),
      "全部调用 ∈ {findFirst, findMany}（零 mutation 调用）",
      calls.map((c) => `${c.model}.${c.method}`),
    );
  }

  /* ================================================================ */
  section("READ_ONLY — 源码审计（read-model 全目录）");
  {
    const dir = join(__dirname, "..");
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));
    ok(sources.length >= 4, `审计 ${sources.length} 个源文件`, sources.map((s) => s.file));

    const mutationMarkers = [
      ".create(",
      ".createMany(",
      ".update(",
      ".updateMany(",
      ".upsert(",
      ".delete(",
      ".deleteMany(",
      "$executeRaw",
      "$queryRaw",
      "$transaction",
    ];
    for (const { file, text } of sources) {
      const hits = mutationMarkers.filter((m) => text.includes(m));
      ok(hits.length === 0, `${file} 零 mutation API`, hits);
    }

    // Runtime core 硬边界：read-model 不 import 执行内核
    const forbiddenImports = [
      "workforce-runtime/processor",
      "agent-runtime-v2/executor",
      "agent-runtime-v2/persist",
      "workforce-runtime/resume",
      'from "../processor"',
      'from "../resume"',
      'from "../job"',
      "appendAgentRunEvent",
    ];
    for (const { file, text } of sources) {
      const hits = forbiddenImports.filter((m) => text.includes(m));
      ok(hits.length === 0, `${file} 零 Runtime core 依赖`, hits);
    }

    // db 只允许懒加载（顶层 import 会在纯测试进程实例化 Prisma）
    for (const { file, text } of sources) {
      const topLevelDbImport = /^import\s[^;]*from\s+"@\/lib\/db"/m.test(text);
      ok(!topLevelDbImport, `${file} 无顶层 @/lib/db import`, file);
    }
  }

  /* ================================================================ */
  section("includeInternal 默认关闭");
  {
    const { reader } = seed();
    const normal = await getWorkforceJobView(
      { orgId: "org_a", jobId: "run_org_a_job" },
      reader,
    );
    ok(
      normal.ok && normal.view.internalTimeline === undefined,
      "默认无 internalTimeline",
    );
    const admin = await getWorkforceJobView(
      { orgId: "org_a", jobId: "run_org_a_job", includeInternal: true },
      reader,
    );
    ok(
      admin.ok &&
        Array.isArray(admin.view.internalTimeline) &&
        admin.view.internalTimeline.length > 0,
      "includeInternal=true 才产出 internalTimeline",
    );
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("测试执行异常", error);
  process.exit(1);
});
