/**
 * Workforce Job Read Model — 列表服务契约测试（2D-1 / L1-L9）
 *
 * 1. 状态过滤词汇 → internal status 集合（DB 层过滤，分页安全）；
 * 2. updatedAt DESC, id DESC 确定性排序 + keyset 游标分页（含篡改拒绝）；
 * 3. 租户隔离（D9）：org 条件强制、跨 org 不可见、空 orgId fail-closed；
 * 4. READ_ONLY：spy Reader 全调用 ∈ {findMany}；
 * 5. Lite 契约：列表项不含 timeline / tasks / internalTimeline；
 * 6. finalSummary 投影（结构化 job.completed payload.summary 唯一来源；
 *    job.failed payload.report 结构性排除）。
 *
 * 纯内存 fake Reader（忠实执行 where/orderBy/take 语义），零 DB、零 Prisma。
 * 运行：npx tsx src/lib/workforce-runtime/read-model/__tests__/list-service.test.ts
 */

import {
  decodeWorkforceJobsCursor,
  encodeWorkforceJobsCursor,
  isWorkforceJobStatusFilter,
  listWorkforceJobViews,
} from "../list-service";
import type { WorkforceListReader } from "../list-service";
import { buildWorkforceJobViewModel } from "../projection";
import type {
  WorkforceEventSnapshot,
  WorkforcePendingActionSnapshot,
  WorkforceRunSnapshot,
  WorkforceStepSnapshot,
} from "../types";
import { at, makeEvents, makePlan, makeRun, makeStep } from "./fixtures";

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
/* Fake List Reader（忠实执行 where / orderBy / take）                   */
/* ------------------------------------------------------------------ */

type RecordedCall = { model: string; method: string; args: unknown };

type SeedData = {
  runs: WorkforceRunSnapshot[];
  steps: Array<WorkforceStepSnapshot & { runId: string; orgId: string }>;
  events: Array<WorkforceEventSnapshot & { runId: string; orgId: string }>;
  pendingActions: Array<
    WorkforcePendingActionSnapshot & { agentRunId: string; orgId: string }
  >;
};

function makeListFakeReader(data: SeedData): {
  reader: WorkforceListReader;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const reader: WorkforceListReader = {
    agentRun: {
      findMany: async (args) => {
        calls.push({ model: "agentRun", method: "findMany", args });
        const { orgId, runType, status, OR } = args.where;
        let rows = data.runs.filter(
          (r) => r.orgId === orgId && r.runType === runType,
        );
        if (status) rows = rows.filter((r) => status.in.includes(r.status));
        if (OR) {
          rows = rows.filter((r) =>
            OR.some((cond) => {
              if ("AND" in cond) {
                return (
                  r.updatedAt.getTime() === cond.AND[0].updatedAt.getTime() &&
                  r.id < cond.AND[1].id.lt
                );
              }
              return r.updatedAt.getTime() < cond.updatedAt.lt.getTime();
            }),
          );
        }
        rows = [...rows].sort((a, b) => {
          const t = b.updatedAt.getTime() - a.updatedAt.getTime();
          if (t !== 0) return t;
          return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        });
        return rows.slice(0, args.take);
      },
    },
    agentRunStep: {
      findMany: async (args) => {
        calls.push({ model: "agentRunStep", method: "findMany", args });
        return data.steps.filter(
          (s) =>
            args.where.runId.in.includes(s.runId) &&
            s.orgId === args.where.orgId,
        );
      },
    },
    agentRunEvent: {
      findMany: async (args) => {
        calls.push({ model: "agentRunEvent", method: "findMany", args });
        return data.events.filter(
          (e) =>
            args.where.runId.in.includes(e.runId) &&
            e.orgId === args.where.orgId &&
            e.eventType === args.where.eventType &&
            e.visibleToUser === args.where.visibleToUser,
        );
      },
    },
    pendingAction: {
      findMany: async (args) => {
        calls.push({ model: "pendingAction", method: "findMany", args });
        return data.pendingActions.filter(
          (a) =>
            args.where.agentRunId.in.includes(a.agentRunId) &&
            a.orgId === args.where.orgId,
        );
      },
    },
  };
  return { reader, calls };
}

/* ------------------------------------------------------------------ */
/* Seed：org_a 九种状态 + org_b 干扰行                                   */
/* ------------------------------------------------------------------ */

function seed(): SeedData {
  const mk = (
    id: string,
    status: string,
    updatedMin: number,
    extra: Partial<WorkforceRunSnapshot> = {},
  ): WorkforceRunSnapshot =>
    makeRun({
      id,
      status,
      updatedAt: at(updatedMin),
      planJson: makePlan(["s1", "s2"], `目标 ${id}`),
      ...extra,
    });

  const runs: WorkforceRunSnapshot[] = [
    // working 组
    mk("run_exec", "executing", 90),
    mk("run_queued_fresh", "queued", 80, { planJson: null }),
    mk("run_queued_cont", "queued", 70),
    mk("run_verifying", "verifying", 60),
    // needs_you 组
    mk("run_await", "awaiting_approval", 50),
    mk("run_needs_human", "needs_human", 40, {
      errorCode: "clarification_required",
    }),
    // completed 组
    mk("run_done", "completed", 30, {
      startedAt: at(0),
      completedAt: at(29),
    }),
    mk("run_partial", "partially_executed", 20),
    // failed / cancelled
    mk("run_failed", "failed", 10),
    mk("run_cancelled", "cancelled", 5, { cancelledAt: at(5) }),
    // 未来未知状态（前向兼容 fail-safe）
    mk("run_future", "hyper_executing", 4),
    // 排序 tie-break：与 run_exec 同 updatedAt，id 更小 → 排后
    mk("run_exec_tie", "executing", 90),
    // org_b 干扰（租户隔离）
    makeRun({
      id: "run_org_b",
      orgId: "org_b",
      status: "executing",
      updatedAt: at(999),
    }),
    // 非 workforce runType 干扰
    makeRun({ id: "run_chat", runType: "conversation", status: "running", updatedAt: at(998) }),
  ];

  const steps: SeedData["steps"] = [
    {
      ...makeStep("s1", "completed", { completedAt: at(3) }),
      runId: "run_exec",
      orgId: "org_a",
    },
    {
      // #85 canonical workforce-task/v1 信封（真实 persist 形状）
      ...makeStep("s2", "running", {
        startedAt: at(4),
        inputJson: {
          workforceTask: {
            contractVersion: "workforce-task/v1",
            worker: { workerKey: "tender_worker", role: "tender_specialist" },
            taskKind: "work",
            objective: "提取投标技术要求",
          },
        },
      }),
      runId: "run_exec",
      orgId: "org_a",
    },
    {
      ...makeStep("s1", "completed", { completedAt: at(2) }),
      runId: "run_queued_cont",
      orgId: "org_a",
    },
    {
      ...makeStep("s1", "awaiting_approval", { startedAt: at(6) }),
      runId: "run_await",
      orgId: "org_a",
    },
    {
      ...makeStep("s1", "completed", { completedAt: at(7) }),
      runId: "run_done",
      orgId: "org_a",
    },
    {
      ...makeStep("s2", "completed", { completedAt: at(8) }),
      runId: "run_done",
      orgId: "org_a",
    },
  ];

  const events: SeedData["events"] = [
    ...makeEvents([
      {
        type: "job.waiting_human",
        visible: true,
        title: "等待审批后继续",
        payload: {
          humanRequirement: {
            type: "APPROVAL_REQUIRED",
            refs: { pendingActionIds: ["pa_1"] },
          },
        },
      },
    ]).map((e) => ({ ...e, runId: "run_await", orgId: "org_a" })),
    ...makeEvents([
      {
        type: "job.waiting_human",
        visible: true,
        title: "需要补充信息",
        payload: {
          humanRequirement: {
            type: "CLARIFICATION_REQUIRED",
            detail: "请确认目标客户范围",
          },
        },
      },
    ]).map((e) => ({ ...e, runId: "run_needs_human", orgId: "org_a" })),
  ];

  const pendingActions: SeedData["pendingActions"] = [
    {
      id: "pa_1",
      status: "pending",
      title: "发送跟进邮件",
      createdAt: at(6),
      agentRunId: "run_await",
      orgId: "org_a",
    },
  ];

  return { runs, steps, events, pendingActions };
}

/* ================================================================== */

async function main(): Promise<void> {
  console.log("Workforce Read Model — 列表服务契约测试（2D-1）");

  /* ================================================================ */
  section("L1 状态过滤：working 组（QUEUED + WORKING，continuation 判别下沉投影层）");
  {
    const { reader } = makeListFakeReader(seed());
    const result = await listWorkforceJobViews(
      { orgId: "org_a", status: "working" },
      reader,
    );
    const ids = result.items.map((i) => i.jobId);
    ok(
      ids.length === 5 &&
        ids.includes("run_exec") &&
        ids.includes("run_exec_tie") &&
        ids.includes("run_queued_fresh") &&
        ids.includes("run_queued_cont") &&
        ids.includes("run_verifying"),
      "working 过滤含 executing/queued/verifying 组",
      ids,
    );
    const statuses = new Set(result.items.map((i) => i.status));
    ok(
      [...statuses].every((s) => s === "QUEUED" || s === "WORKING"),
      "working 组用户态 ⊆ {QUEUED, WORKING}",
      [...statuses],
    );
    const fresh = result.items.find((i) => i.jobId === "run_queued_fresh");
    const cont = result.items.find((i) => i.jobId === "run_queued_cont");
    ok(fresh?.status === "QUEUED", "从未开始的 queued → QUEUED");
    ok(cont?.status === "WORKING", "continuation 回队 → WORKING（对用户连续）");
  }

  /* ================================================================ */
  section("L2 状态过滤：needs_you 组（D2 列表面）");
  {
    const { reader } = makeListFakeReader(seed());
    const result = await listWorkforceJobViews(
      { orgId: "org_a", status: "needs_you" },
      reader,
    );
    const ids = result.items.map((i) => i.jobId);
    ok(
      ids.length === 2 && ids.includes("run_await") && ids.includes("run_needs_human"),
      "needs_you = awaiting_approval + needs_human",
      ids,
    );
    ok(
      result.items.every((i) => i.status === "NEEDS_YOU" && i.needsYou !== undefined),
      "每项都带 needsYou 结构化视图",
    );
    const awaitItem = result.items.find((i) => i.jobId === "run_await");
    ok(
      awaitItem?.needsYou?.type === "APPROVAL_REQUIRED" &&
        awaitItem.needsYou.pendingActionIds?.includes("pa_1") === true,
      "审批类 needsYou 关联 PendingAction id",
      awaitItem?.needsYou,
    );
    const clarItem = result.items.find((i) => i.jobId === "run_needs_human");
    ok(
      clarItem?.needsYou?.type === "CLARIFICATION_REQUIRED" &&
        clarItem.needsYou.detail === "请确认目标客户范围",
      "clarification 类 needsYou 带结构化 detail",
      clarItem?.needsYou,
    );
  }

  /* ================================================================ */
  section("L3 状态过滤：completed / failed / cancelled");
  {
    const { reader } = makeListFakeReader(seed());
    const completed = await listWorkforceJobViews(
      { orgId: "org_a", status: "completed" },
      reader,
    );
    ok(
      completed.items.length === 2 &&
        completed.items.some((i) => i.status === "COMPLETED") &&
        completed.items.some((i) => i.status === "PARTIAL"),
      "completed 组 = COMPLETED + PARTIAL",
      completed.items.map((i) => `${i.jobId}:${i.status}`),
    );
    const failed = await listWorkforceJobViews(
      { orgId: "org_a", status: "failed" },
      reader,
    );
    ok(
      failed.items.length === 1 && failed.items[0].status === "FAILED",
      "failed 组只含 FAILED",
    );
    const cancelled = await listWorkforceJobViews(
      { orgId: "org_a", status: "cancelled" },
      reader,
    );
    ok(
      cancelled.items.length === 1 && cancelled.items[0].status === "CANCELLED",
      "cancelled 组只含 CANCELLED",
    );
    ok(
      isWorkforceJobStatusFilter("needs_you") &&
        isWorkforceJobStatusFilter("all") &&
        !isWorkforceJobStatusFilter("NEEDS_YOU") &&
        !isWorkforceJobStatusFilter("running; DROP TABLE"),
      "过滤词汇白名单校验（未知值拒绝）",
    );
  }

  /* ================================================================ */
  section("L4 排序：updatedAt DESC, id DESC tie-break");
  {
    const { reader } = makeListFakeReader(seed());
    const result = await listWorkforceJobViews({ orgId: "org_a" }, reader);
    const ids = result.items.map((i) => i.jobId);
    ok(ids[0] === "run_exec_tie" && ids[1] === "run_exec", "同 updatedAt 时 id DESC", ids.slice(0, 3));
    const times = result.items.map((i) => new Date(i.lastActivityAt).getTime());
    ok(
      times.every((t, idx) => idx === 0 || t <= times[idx - 1]),
      "整页 lastActivityAt 单调不增",
    );
  }

  /* ================================================================ */
  section("L5 分页：keyset 游标 + limit 边界");
  {
    const { reader, calls } = makeListFakeReader(seed());
    const page1 = await listWorkforceJobViews(
      { orgId: "org_a", limit: 5 },
      reader,
    );
    ok(page1.items.length === 5 && page1.nextCursor !== null, "第一页 5 条 + 有下一页");

    const encoded = encodeWorkforceJobsCursor(page1.nextCursor!);
    const decoded = decodeWorkforceJobsCursor(encoded);
    ok(
      decoded !== null &&
        decoded.id === page1.nextCursor!.id &&
        decoded.updatedAt.getTime() === page1.nextCursor!.updatedAt.getTime(),
      "游标 encode/decode 往返一致",
    );

    const page2 = await listWorkforceJobViews(
      { orgId: "org_a", limit: 5, cursor: decoded },
      reader,
    );
    const overlap = page2.items.filter((i) =>
      page1.items.some((p) => p.jobId === i.jobId),
    );
    ok(page2.items.length === 5 && overlap.length === 0, "第二页无重叠", {
      page2: page2.items.map((i) => i.jobId),
    });

    const page3 = await listWorkforceJobViews(
      { orgId: "org_a", limit: 5, cursor: page2.nextCursor },
      reader,
    );
    ok(
      page3.items.length === 2 && page3.nextCursor === null,
      "末页 2 条 + nextCursor=null（org_a 共 12 行）",
      page3.items.map((i) => i.jobId),
    );

    ok(decodeWorkforceJobsCursor("tampered!!") === null, "篡改游标 → null（fail-closed）");
    ok(
      decodeWorkforceJobsCursor(
        Buffer.from(JSON.stringify({ u: "not-a-date", i: "x" })).toString("base64url"),
      ) === null,
      "非法时间游标 → null",
    );

    await listWorkforceJobViews({ orgId: "org_a", limit: 500 }, reader);
    const lastRunCall = calls
      .filter((c) => c.model === "agentRun")
      .at(-1) as { args: { take: number } };
    ok(lastRunCall.args.take === 51, "limit clamp 到 50（take=51 判定 hasMore）");

    await listWorkforceJobViews({ orgId: "org_a", limit: 0 }, reader);
    const zeroCall = calls
      .filter((c) => c.model === "agentRun")
      .at(-1) as { args: { take: number } };
    ok(zeroCall.args.take === 2, "limit 下限 clamp 到 1");
  }

  /* ================================================================ */
  section("L6 租户隔离（D9）：跨 org 不可见 + 条件强制");
  {
    const { reader, calls } = makeListFakeReader(seed());
    const orgA = await listWorkforceJobViews({ orgId: "org_a" }, reader);
    ok(
      !orgA.items.some((i) => i.jobId === "run_org_b"),
      "org_a 列表不含 org_b 的 Job",
    );
    ok(
      !orgA.items.some((i) => i.jobId === "run_chat"),
      "非 workforce_job runType 不进入列表",
    );
    const orgB = await listWorkforceJobViews({ orgId: "org_b" }, reader);
    ok(
      orgB.items.length === 1 && orgB.items[0].jobId === "run_org_b",
      "org_b 只见自己的 Job",
    );
    ok(
      calls.every(
        (c) =>
          (c.args as { where: { orgId?: string } }).where.orgId === "org_a" ||
          (c.args as { where: { orgId?: string } }).where.orgId === "org_b",
      ),
      "每条查询都带 orgId 条件",
    );

    const callCountBefore = calls.length;
    const empty = await listWorkforceJobViews({ orgId: "  " }, reader);
    ok(
      empty.items.length === 0 &&
        empty.nextCursor === null &&
        calls.length === callCountBefore,
      "空 orgId fail-closed：零查询、空结果",
    );
  }

  /* ================================================================ */
  section("L7 READ_ONLY：spy 全调用 ∈ {findMany} + Lite 契约");
  {
    const { reader, calls } = makeListFakeReader(seed());
    const result = await listWorkforceJobViews({ orgId: "org_a" }, reader);
    ok(
      calls.length > 0 && calls.every((c) => c.method === "findMany"),
      "全部调用 = findMany（零 mutation 调用）",
      calls.map((c) => `${c.model}.${c.method}`),
    );
    const item = result.items[0] as unknown as Record<string, unknown>;
    ok(
      !("timeline" in item) &&
        !("tasks" in item) &&
        !("internalTimeline" in item),
      "列表项不含 timeline / tasks / internalTimeline（Lite 契约）",
      Object.keys(item),
    );
    const exec = result.items.find((i) => i.jobId === "run_exec");
    ok(
      exec !== undefined &&
        exec.currentTasks.length === 1 &&
        exec.currentTasks[0].workerKey === "tender_worker" &&
        exec.currentTasks[0].taskKind === "work",
      "currentTasks 携带 #85 canonical worker/taskKind（信封有效时）",
      exec?.currentTasks,
    );
  }

  /* ================================================================ */
  section("L8 前向兼容：未知 internal status 不崩、fail-safe 呈现");
  {
    const { reader } = makeListFakeReader(seed());
    const result = await listWorkforceJobViews({ orgId: "org_a" }, reader);
    const future = result.items.find((i) => i.jobId === "run_future");
    ok(
      future !== undefined && future.status === "WORKING",
      "未知非终态 status fail-safe → WORKING（保守口径）",
      future?.status,
    );
  }

  /* ================================================================ */
  section("L9 finalSummary：结构化 payload.summary 唯一来源");
  {
    const run = makeRun({ id: "run_fs", status: "completed" });
    const base = {
      run,
      steps: [],
      pendingActions: [],
    };

    const withSummary = buildWorkforceJobViewModel({
      ...base,
      events: makeEvents([
        { type: "job.created", visible: true },
        {
          type: "job.completed",
          visible: true,
          payload: { status: "completed", summary: "已整理 3 位客户的优先顺序与建议" },
        },
      ]),
    });
    ok(
      withSummary.finalSummary === "已整理 3 位客户的优先顺序与建议",
      "job.completed payload.summary → finalSummary",
    );

    const noSummary = buildWorkforceJobViewModel({
      ...base,
      events: makeEvents([
        { type: "job.created", visible: true },
        { type: "job.completed", visible: true, payload: { status: "completed" } },
      ]),
    });
    ok(
      noSummary.finalSummary === undefined,
      "payload 无 summary → finalSummary=undefined（UI 显示占位）",
    );

    const failedRun = buildWorkforceJobViewModel({
      run: makeRun({ id: "run_ff", status: "failed" }),
      steps: [],
      pendingActions: [],
      events: makeEvents([
        {
          type: "job.failed",
          visible: true,
          payload: { report: "Error: ECONNRESET at Object.<anonymous> (/app/internal.ts:42)" },
        },
      ]),
    });
    ok(
      failedRun.finalSummary === undefined,
      "job.failed payload.report 结构性排除（内部错误原文永不透出）",
    );

    const latestWins = buildWorkforceJobViewModel({
      ...base,
      events: makeEvents([
        {
          type: "job.completed",
          visible: true,
          payload: { summary: "旧摘要" },
        },
        {
          type: "job.completed",
          visible: true,
          payload: { summary: "新摘要" },
        },
      ]),
    });
    ok(latestWins.finalSummary === "新摘要", "多条 job.completed 取最新 sequence");

    const invisible = buildWorkforceJobViewModel({
      ...base,
      events: makeEvents([
        { type: "job.completed", visible: false, payload: { summary: "内部摘要" } },
      ]),
    });
    ok(
      invisible.finalSummary === undefined,
      "非 user-visible 的 job.completed 不产出 finalSummary",
    );
  }

  /* ================================================================ */
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("测试进程异常：", err);
  process.exit(1);
});
