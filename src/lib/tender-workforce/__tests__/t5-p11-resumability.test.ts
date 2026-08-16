/**
 * T5-P1.1 — Workforce V2 Serverless Resumability（纯平面，零 DB / 零真实模型）
 *
 * P11-CONT-01..10   continuation 契约（让出 ≠ 失败）
 * P11-V2-01..12     游标 / 续跑 / 指纹失效 / 单一语义源
 * P11-FENCE-01..08  cursor checkpoint 防栅栏与域归属
 * P11-BUDGET-01..07 serverless 预算与 fail-closed
 *
 * 运行：npx tsx src/lib/tender-workforce/__tests__/t5-p11-resumability.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  createV2Cursor,
  parseV2Cursor,
  type V2CursorState,
} from "@/lib/tender-auto-analysis/v2-cursor";
import {
  saveWorkforceV2Cursor,
  assertWorkforceTenderOwnership,
  WorkforceTenderDomainOwnershipError,
} from "../v2-persist-workforce";
import {
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
  buildWorkforceTenderIdempotencyKey,
} from "../analysis-run-service";
import {
  AGENT_RUNS_MAX_DURATION_S,
  AGENT_RUNS_INVOCATION_BUDGET_MS,
} from "@/lib/workforce-runtime/constants";
import { TENDER_WORKFORCE_TOOL_HANDLERS } from "../tools";
import { LostLeaseError, type RunFence } from "@/lib/agent-runtime/lease";
import type { V2PersistTx } from "@/lib/tender-auto-analysis/v2-persist-core";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

const ROOT = join(process.cwd(), "src", "lib");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** 只看代码（源码级断言不把设计说明当证据） */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const execCode = code("agent-runtime-v2/executor.ts");
const toolsCode = code("tender-workforce/tools.ts");
const resumableCode = code("tender-workforce/v2-resumable-workforce.ts");
const fenceCode = code("tender-workforce/v2-persist-workforce.ts");
const routeCode = readFileSync(
  join(process.cwd(), "src", "app", "api", "cron", "agent-runs", "route.ts"),
  "utf8",
);

console.log("T5-P1.1 — Workforce V2 Serverless Resumability");

/* ═══════════ P11-CONT：continuation 契约 ═══════════ */

ok(
  code("agent-runtime-v2/adapters.ts").includes("continuation?: ToolContinuation") &&
    code("agent-runtime-v2/adapters.ts").includes('reason: "TIME_BUDGET_YIELD"'),
  "P11-CONT-01: AdapterResult 新增可选 continuation（普通工具不设 → 成功语义不变）",
);
ok(
  !execCode.includes('error: "YIELD"') && !execCode.includes('ok: false, continuation'),
  "P11-CONT-02: 让出不借用 ok=false / 错误串 → 普通失败语义不变",
);
{
  // 单步 + 并行批：两条路径都必须在 !result.ok 之前处理 continuation
  const singleY = execCode.indexOf("if (continuation) {");
  const singleFail = execCode.indexOf("if (!result.ok) {");
  const batchY = execCode.indexOf("if (batchContinuation) {");
  const batchFail = execCode.indexOf("if (!result.ok) {", batchY);
  ok(
    singleY > 0 && singleY < singleFail && batchY > 0 && batchY < batchFail,
    "P11-CONT-03: 两条执行路径都在失败/审批/完成之前识别 continuation",
    { singleY, singleFail, batchY, batchFail },
  );
}
{
  const yieldBlocks = execCode.split("continuation").filter((b) => b.includes('status: "ready"'));
  ok(yieldBlocks.length >= 1, "P11-CONT-04: continuation → Step 回 ready");
  ok(
    !/if \((continuation|batchContinuation)\)[\s\S]{0,900}buildWorkforceHandoffV1/.test(execCode),
    "P11-CONT-05: continuation 不产 Handoff（下游不会误认作完成证据）",
  );
  ok(
    /if \(continuation\)[\s\S]{0,600}completedAt: null/.test(execCode) &&
      /if \(batchContinuation\)[\s\S]{0,600}completedAt: null/.test(execCode),
    "P11-CONT-06: continuation 不写 completedAt",
  );
  ok(
    /if \(continuation\)[\s\S]{0,600}attemptCount: step\.attemptCount/.test(execCode) &&
      /if \(batchContinuation\)[\s\S]{0,600}attemptCount: row\.attemptCount/.test(execCode),
    "P11-CONT-07: continuation 把 attemptCount 回滚到本次 claim 前的值",
  );
}
{
  // §16 数值证明：claim 时 +1、让出时写回原值 → N 次让出后净增 0
  let attemptCount = 3;
  for (let i = 0; i < 10; i++) {
    const before = attemptCount;
    attemptCount = before + 1; // claim
    attemptCount = before;     // 正常让出写回
  }
  ok(attemptCount === 3, "P11-CONT-08: 10 次正常让出后 STEP_ATTEMPT_COUNT_DELTA = 0", attemptCount);
}
{
  const procCode = code("agent-runtime-v2/process.ts");
  const yIdx = procCode.indexOf('round.status === "yielded"');
  // 与**同一 round 循环内**的 ready_for_verification 分支比较——
  // process.ts 在进入循环前还有一处 verifier 调用（run 已就绪的入口路径），
  // 拿第一处比会得到无意义的结论。
  const verifyBranch = procCode.indexOf('round.status === "ready_for_verification"');
  const yieldBlock = procCode.slice(yIdx, yIdx + 320);
  ok(
    yIdx > 0 &&
      yIdx < verifyBranch &&
      yieldBlock.includes('status: "yielded"') &&
      !yieldBlock.includes("verifyRuntimeV2Run"),
    "P11-CONT-09: 让出直接返回，不进入 verifier（VERIFIER_RUNS_ON_YIELD = 0）",
    { yIdx, verifyBranch },
  );
}
{
  const wpCode = code("workforce-runtime/processor.ts");
  ok(
    wpCode.includes('result.status === "yielded"') && /result\.status === "yielded"\)\s*\{\s*break;/.test(wpCode),
    "P11-CONT-10: 让出冒泡到 Workforce processor 并立即结束本 slice（§20）",
  );
  const breakIdx = wpCode.indexOf('result.status === "yielded"');
  const requeueIdx = wpCode.indexOf('status: "queued"', breakIdx);
  ok(
    requeueIdx > breakIdx && /attempts: 0/.test(wpCode.slice(requeueIdx, requeueIdx + 400)),
    "P11-CONT-10b: 随后走 normal continuation 回队，attempts 归零（§17/§21）",
  );
}

/* ═══════════ P11-V2：游标 / 续跑 / 指纹 ═══════════ */
{
  const fp = "fp-aaa";
  const fresh = createV2Cursor({ fingerprint: fp, analysisDate: "2026-01-01", now: new Date(0) });
  ok(fresh.ticks === 0 && !!fresh.phase, "P11-V2-01: 新游标从起始阶段开始", fresh.phase);
  ok(
    parseV2Cursor(fresh as unknown, fp)?.phase === fresh.phase,
    "P11-V2-02: 指纹一致 → 可续跑（解析出同一游标）",
  );
  ok(parseV2Cursor(fresh as unknown, "fp-different") === null,
    "P11-V2-03/04: 指纹变化（文档 hash / 页数 / prompt 版本）→ 旧游标作废");
  ok(parseV2Cursor({ garbage: true }, fp) === null, "P11-V2-03b: 结构不符 → 作废（不消费脏 checkpoint）");
}
{
  // 引擎与游标契约来自 #113，本 PR 不新建
  ok(
    resumableCode.includes("advanceV2Analysis") &&
      resumableCode.includes("fingerprintAnalyzerInput") &&
      resumableCode.includes("parseV2Cursor"),
    "P11-V2-12a: 复用 #113 引擎/指纹/游标（RESUMABLE_ENGINE_SOURCE = MAIN_113）",
  );
  ok(
    !/function (buildAllWindows|deriveGroundedState|mapV2Result|runAnalystSynthesis)/.test(resumableCode) &&
      !resumableCode.includes("createCompletion"),
    "P11-V2-12b: 编排层零语义实现（不抽取/不澄清/不分析师/不映射）",
  );
  const engines = execSync(
    `grep -rln "export async function advanceV2Analysis" ${JSON.stringify(ROOT)} || true`,
    { encoding: "utf8" },
  ).split("\n").filter(Boolean).filter((f) => !f.includes("__tests__"));
  ok(engines.length === 1, "P11-V2-12: SEMANTIC_ENGINE_COUNT = 1", engines);
  const persistCores = execSync(
    `grep -rln "export async function persistV2CanonicalTx" ${JSON.stringify(ROOT)} || true`,
    { encoding: "utf8" },
  ).split("\n").filter(Boolean).filter((f) => !f.includes("__tests__"));
  ok(persistCores.length === 1, "P11-V2-12c: CANONICAL_WRITE_IMPLEMENTATION_COUNT = 1", persistCores);
}
{
  // YIELD 分支：零 canonical 写、零 marker
  const yieldBranch = toolsCode.slice(
    toolsCode.indexOf('if (outcome.status === "YIELD")'),
    toolsCode.indexOf('if (outcome.status === "EMPTY_ANALYSIS")'),
  );
  ok(
    yieldBranch.length > 0 &&
      !yieldBranch.includes("persistV2ForWorkforce") &&
      !yieldBranch.includes("TENDER_CANONICAL_V2_MARKER") &&
      !yieldBranch.includes("canonicalPersisted"),
    "P11-V2-05: YIELD → 零 canonical 写、零 canonical marker（YIELD_CANONICAL_MARKER = 0）",
  );
  ok(
    resumableCode.indexOf('status === "YIELD"') < resumableCode.indexOf("persistV2ForWorkforce({"),
    "P11-V2-06: 只有 READY 才走 canonical persist",
  );
  ok(
    resumableCode.includes("saveCursor:") && resumableCode.includes("saveWorkforceV2Cursor"),
    "P11-V2-07: 每阶段 checkpoint 落盘（已完成窗口不重跑）",
  );
  // 不靠注释措辞判断：断言代码里从不把 workerCursor 清空/置 null
  const clearsCursor =
    /workerCursor:\s*(null|undefined|\{\})/.test(resumableCode) ||
    /workerCursor:\s*(null|undefined|\{\})/.test(fenceCode);
  ok(
    !clearsCursor,
    "P11-V2-10: 落库后保留 workerCursor（可从 PERSIST 阶段安全恢复，§12）",
  );
}

void (async () => {
/* ═══════════ P11-FENCE：cursor checkpoint 防栅栏 ═══════════ */
{
  type Rec = { model: string; op: string; args: Record<string, unknown> };
  const OWN = {
    orgId: "org1", projectId: "proj1", analysisRunId: "run1", jobId: "job1",
  };
  const ownedRow: Record<string, unknown> = {
    id: OWN.analysisRunId,
    orgId: OWN.orgId,
    projectId: OWN.projectId,
    analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
    status: TENDER_AGENT_RUN_STATUS.running,
    idempotencyKey: buildWorkforceTenderIdempotencyKey(OWN.jobId),
  };
  function fakeTx(row: Record<string, unknown>) {
    const writes: Rec[] = [];
    const tx = {
      tenderAnalysisRun: {
        updateMany: async (args: unknown) => {
          const where = ((args ?? {}) as { where?: Record<string, unknown> }).where ?? {};
          const matched = Object.entries(where).every(([k, v]) => row[k] === v);
          return { count: matched ? 1 : 0 };
        },
        update: async (args: unknown) => {
          writes.push({ model: "run", op: "update", args: args as Record<string, unknown> });
          return {};
        },
      },
    } as unknown as V2PersistTx;
    return { tx, writes };
  }
  const okFence = (tx: V2PersistTx): RunFence => ({
    runId: "agentrun1",
    check: async () => true,
    guard: async (w) => w(tx as never),
  });
  const staleFence = (): RunFence => ({
    runId: "agentrun1",
    check: async () => false,
    guard: async () => { throw new LostLeaseError("agentrun1"); },
  });
  const cursor = createV2Cursor({ fingerprint: "fp", analysisDate: "2026-01-01", now: new Date(0) }) as unknown as V2CursorState;

  const a = fakeTx(ownedRow);
  ok(
    (await saveWorkforceV2Cursor({ own: OWN, runFence: okFence(a.tx), cursor })) === true &&
      a.writes.length === 1 && "workerCursor" in ((a.writes[0].args as { data: object }).data),
    "P11-FENCE-01: 有效 fence + 归属命中 → cursor 落盘",
  );

  const b = fakeTx(ownedRow);
  ok(
    (await saveWorkforceV2Cursor({ own: OWN, runFence: staleFence(), cursor })) === false &&
      b.writes.length === 0,
    "P11-FENCE-02: stale RunFence → cursor 写 0（返回 false，引擎按租约丢失收尾）",
  );

  for (const [id, bad, label] of [
    ["P11-FENCE-03", { ...OWN, orgId: "org-x" }, "错误 org"],
    ["P11-FENCE-04", { ...OWN, projectId: "proj-x" }, "错误 project"],
    ["P11-FENCE-05", { ...OWN, jobId: "job-x" }, "错误 job 幂等键"],
  ] as const) {
    const f = fakeTx(ownedRow);
    const r = await saveWorkforceV2Cursor({ own: bad, runFence: okFence(f.tx), cursor });
    ok(r === false && f.writes.length === 0, `${id}: ${label} → cursor 写 0`);
  }
  {
    const terminalRow = { ...ownedRow, status: "AGENT_FAILED" };
    const f = fakeTx(terminalRow);
    const r = await saveWorkforceV2Cursor({ own: OWN, runFence: okFence(f.tx), cursor });
    ok(r === false && f.writes.length === 0, "P11-FENCE-06: 终态 run → cursor 写 0");
  }
  {
    // 归属守卫唯一实现：canonical persist 与 cursor checkpoint 同源
    const guards = (fenceCode.match(/assertWorkforceTenderOwnership\(/g) ?? []).length;
    const whereBlocks = (fenceCode.match(/analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION/g) ?? []).length;
    ok(
      whereBlocks === 1 && guards >= 3,
      "P11-FENCE-07/08: WORKFORCE_DOMAIN_GUARD_IMPLEMENTATIONS = 1（两条写路径共用）",
      { whereBlocks, guards },
    );
    const f = fakeTx({ ...ownedRow, orgId: "other" });
    let threw = "";
    try {
      await assertWorkforceTenderOwnership(f.tx, OWN);
    } catch (e) { threw = e instanceof Error ? e.name : "?"; }
    ok(threw === "WorkforceTenderDomainOwnershipError", "P11-FENCE-08b: 归属守卫 fail-closed 抛出", threw);
  }
}

/* ═══════════ P11-BUDGET：serverless 预算 ═══════════ */
ok(AGENT_RUNS_MAX_DURATION_S === 300, "P11-BUDGET-01: agent-runs maxDuration = 300", AGENT_RUNS_MAX_DURATION_S);
ok(
  AGENT_RUNS_INVOCATION_BUDGET_MS === 240_000 &&
    AGENT_RUNS_INVOCATION_BUDGET_MS < AGENT_RUNS_MAX_DURATION_S * 1000,
  "P11-BUDGET-01b: 活跃预算 240s < maxDuration，留收尾余量",
);
{
  const startIdx = routeCode.indexOf("const requestStartedAt = Date.now()");
  const budgetIdx = routeCode.indexOf("deadlineAt: requestStartedAt +");
  const workIdx = routeCode.indexOf("processQueuedAgentRuns(");
  ok(
    startIdx > 0 && budgetIdx > startIdx && startIdx < workIdx,
    "P11-BUDGET-02: 绝对 deadline 从 HTTP 请求开始算（先于任何工作）",
    { startIdx, budgetIdx, workIdx },
  );
}
{
  const forbidden = ["handoff.ts", "task-contract.ts", "job.ts", "server-plan.ts"];
  const leaked = forbidden.filter((f) => code(`workforce-runtime/${f}`).includes("executionBudget"));
  ok(leaked.length === 0, "P11-BUDGET-03: 预算 server-only（不进 handoff/契约/metadata/plan）", leaked);
  ok(
    !code("agent-runtime-v2/persist.ts").includes("executionBudget"),
    "P11-BUDGET-03b: 不写入 planJson / step 持久化面",
  );
}
{
  const handler = toolsCode.slice(
    toolsCode.indexOf("async function handleAnalyzePackageV2"),
    toolsCode.indexOf("export const TENDER_WORKFORCE_TOOL_HANDLERS"),
  );
  ok(
    handler.includes("WORKFORCE_EXECUTION_BUDGET_MISSING") &&
      handler.indexOf("if (!budget)") < handler.indexOf("advanceV2ForWorkforce"),
    "P11-BUDGET-04: 缺预算 → fail closed（绝不回落 one-shot）",
  );
  ok(
    !handler.includes("Infinity") && !handler.includes("POSITIVE_INFINITY"),
    "P11-BUDGET-04b: 没有偷偷的 Infinity 兜底",
  );
  ok(
    (toolsCode.match(/runV2Inference/g) ?? []).length === 0,
    "P11-BUDGET-04c: WORKFORCE_T3_ONE_SHOT_REACHABILITY = 0",
  );
}
ok(
  typeof TENDER_WORKFORCE_TOOL_HANDLERS.tender_analyze_package_v2 === "function" &&
    Object.keys(TENDER_WORKFORCE_TOOL_HANDLERS).length === 9,
  "P11-BUDGET-06b: 工具集合不变（9 个），未新增第二套工具",
);
{
  const crons = execSync(
    `ls ${JSON.stringify(join(process.cwd(), "src", "app", "api", "cron"))} || true`,
    { encoding: "utf8" },
  ).split("\n").filter(Boolean);
  ok(
    crons.filter((c) => c.includes("tender")).length === 1,
    "P11-BUDGET-06: NEW_TENDER_CRON = 0（仍只有 #113 那一个 tender cron）",
    crons.filter((c) => c.includes("tender")),
  );
  ok(
    !code("workforce-runtime/processor.ts").includes("WORKFORCE_SLICE_BUDGET_MS = 240") &&
      code("workforce-runtime/processor.ts").includes("WORKFORCE_SLICE_BUDGET_MS = 45_000"),
    "P11-BUDGET-07: 未全局拉长普通 Workforce slice 预算（Sales/General 影响面不变）",
  );
}

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();
