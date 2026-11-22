/**
 * CHAIN-0c — 读模型的「停在哪一步、为什么」（纯函数 + 投影 + 源码断言）
 * 运行：npx tsx src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  findStoppedStep,
  projectStopReason,
  STOP_REASON_UNRECORDED_ZH,
  stopReasonFromCodes,
  stopReasonSentenceZh,
} from "../stop-reason";
import { buildWorkforceJobViewModel } from "../projection";
import type { WorkforceRunSnapshot, WorkforceStepSnapshot } from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

const T0 = new Date("2026-11-19T10:19:00Z");
const step = (i: number, title: string, status: string, errorCode: string | null = null): WorkforceStepSnapshot => ({
  id: `s${i}`, stepKey: `k${i}`, title, status, errorCode, inputJson: null, startedAt: null, completedAt: null,
  createdAt: new Date(T0.getTime() + i * 1000),
});
const run = (o: Partial<WorkforceRunSnapshot>): WorkforceRunSnapshot => ({
  id: "job1", orgId: "org1", runType: "workforce_job", status: "failed", attempts: 3, errorCode: null, errorMessage: null,
  planJson: null, metadata: { workDomain: "tender" }, startedAt: T0, completedAt: null, cancelledAt: null, createdAt: T0, updatedAt: T0,
  ...o,
} as WorkforceRunSnapshot);
const STEPS = [
  step(1, "校验输入", "completed"),
  step(2, "解析投标文件", "completed"),
  step(3, "Canonical V2 包级分析", "failed", "tool_failed"),
  step(4, "要求抽取", "pending"),
];

console.log("stop-reason");

// ── 纯函数 ──
{
  const found = findStoppedStep(STEPS);
  ok(!!found && found[0] === 3 && found[1].title === "Canonical V2 包级分析", "第一个失败的步骤，序号从 1 起");
  const noFail = findStoppedStep([step(1, "校验输入", "completed"), step(2, "解析投标文件", "running")]);
  ok(!!noFail && noFail[0] === 2, "没有失败的 → 第一个没完成的");
  ok(findStoppedStep([]) === null, "没有步骤 → null");
  const done = projectStopReason([step(1, "校验输入", "completed"), step(2, "汇总", "completed")], { status: "needs_human", errorCode: "verification_failed" });
  ok(done?.stepIndex === 2 && done.reasonZh === "结果没有通过校验", "每一步都完成 → 算在最后一步、原因取 Job 错误码", done);
  // FIX-20 D9：失败步骤只用它自己的码；不是失败步骤只用 Job 的码（stepFailed 标明是哪一种）
  ok(stopReasonFromCodes({ stepFailed: true, stepErrorCode: "tool_failed", jobErrorCode: "model_failed", jobStatus: "failed" }) === "工具执行失败", "失败步骤：用它自己的错误码");
  ok(stopReasonFromCodes({ stepFailed: false, stepErrorCode: null, jobErrorCode: "external_timeout", jobStatus: "failed" }) === "长时间没有进展", "不是失败步骤：用 Job 错误码");
  ok(stopReasonFromCodes({ stepFailed: true, stepErrorCode: "weird_code", jobErrorCode: null, jobStatus: "failed" }) === "执行出错", "不认识 → 执行出错（不显示原码）");
  ok(stopReasonFromCodes({ stepFailed: false, stepErrorCode: null, jobErrorCode: null, jobStatus: "needs_human" }) === "需要人工处理", "需要人工处理兜底");
  // FIX-20 新码与新规则
  ok(stopReasonFromCodes({ stepFailed: true, stepErrorCode: "synthesis_failed", jobErrorCode: "blocked_graph", jobStatus: "needs_human" }) === "综合汇总生成失败", "新码 synthesis_failed；失败步骤不回落到 Job 的 blocked_graph");
  ok(stopReasonFromCodes({ stepFailed: true, stepErrorCode: "model_quota_exhausted", jobErrorCode: "blocked_graph", jobStatus: "needs_human" }) === "AI 账户余额不足，请联系平台管理员充值", "新码 model_quota_exhausted");
  ok(stopReasonFromCodes({ stepFailed: true, stepErrorCode: "org_ai_budget_exhausted", jobErrorCode: null, jobStatus: "failed" }) === "本组织本月 AI 费用已达上限，请组织管理员调高月度上限", "新码 org_ai_budget_exhausted");
  ok(stopReasonFromCodes({ stepFailed: false, stepErrorCode: "stale_running_recovered", jobErrorCode: "INITIATOR_MISSING", jobStatus: "needs_human" }) === "需要人工处理", "不是失败步骤：不读它留下的 stale_running_recovered");
  ok(stopReasonFromCodes({ stepFailed: true, stepErrorCode: "stale_running_recovered", jobErrorCode: null, jobStatus: "failed" }) === "上一次执行时间过长被中断", "新码 stale_running_recovered 有白话");
  ok(stopReasonFromCodes({ stepFailed: true, stepErrorCode: null, jobErrorCode: "model_failed", jobStatus: "failed" }) === "执行出错", "失败步骤没有码 → 执行出错（不回落 Job 的码）");
  const leftover = projectStopReason([step(1, "校验输入", "completed"), step(2, "Canonical V2 状态终态化", "completed", "model_quota_exhausted")], { status: "needs_human", errorCode: "verification_failed" });
  ok(leftover?.stepIndex === 2 && leftover.reasonZh === "结果没有通过校验", "每步都完成、最后一步留着旧码 → 只按 Job 的码（结果没有通过校验）", leftover);
  ok(stopReasonSentenceZh(null) === STOP_REASON_UNRECORDED_ZH, "没有原因 → 系统未记录原因");
  const long = stopReasonSentenceZh({ stepIndex: 1, stepTitle: "长".repeat(400), reasonZh: "x" });
  ok([...long].length === 300, "整句不超过 300 字");
  ok(stopReasonSentenceZh(projectStopReason(STEPS, { status: "failed", errorCode: null })) === "卡在第 3 步〈Canonical V2 包级分析〉：工具执行失败", "整句写法");
}

// ── 投影 ──
{
  const failed = buildWorkforceJobViewModel({ run: run({ status: "failed", errorMessage: "STACK_SENTINEL at x.ts:1" }), steps: STEPS, events: [], pendingActions: [] });
  ok(failed.stopReason?.stepIndex === 3 && failed.stopReason.stepTitle === "Canonical V2 包级分析" && failed.stopReason.reasonZh === "工具执行失败", "失败的 Job：视图带停止原因（第 3 步、标题、工具执行失败）", failed.stopReason);
  ok(!JSON.stringify(failed).includes("STACK_SENTINEL"), "运行记录上的错误原文不进视图");

  const parked = buildWorkforceJobViewModel({
    run: run({ status: "needs_human" }),
    steps: STEPS,
    events: [{ sequence: 1, eventType: "job.waiting_human", title: "需要人工处理", payload: { status: "needs_human", humanRequirement: { type: "CONFLICT_REQUIRES_HUMAN" } }, visibleToUser: true, createdAt: T0 }],
    pendingActions: [],
  });
  ok(parked.needsYou?.detail === "卡在第 3 步〈Canonical V2 包级分析〉：工具执行失败", "需要人工处理且没有说明 → 「需要你处理」框用停在哪一步兜底", parked.needsYou);

  const noSteps = buildWorkforceJobViewModel({
    run: run({ status: "needs_human" }),
    steps: [],
    events: [{ sequence: 1, eventType: "job.waiting_human", title: "需要人工处理", payload: { humanRequirement: { type: "CONFLICT_REQUIRES_HUMAN" } }, visibleToUser: true, createdAt: T0 }],
    pendingActions: [],
  });
  ok(noSteps.needsYou?.detail === "系统未记录原因" && noSteps.stopReason === undefined, "连步骤都没有 → 系统未记录原因，不留空白", noSteps.needsYou);

  const clar = buildWorkforceJobViewModel({
    run: run({ status: "needs_human", errorCode: "clarification_required" }),
    steps: STEPS,
    events: [{ sequence: 1, eventType: "job.waiting_human", title: "需要补充信息后继续", payload: { status: "needs_human" }, visibleToUser: true, createdAt: T0 }],
    pendingActions: [],
  });
  ok(clar.needsYou?.detail === undefined, "澄清类的「需要你处理」不加兜底（标题已说明，保持既有行为）", clar.needsYou);

  const completed = buildWorkforceJobViewModel({ run: run({ status: "completed" }), steps: STEPS, events: [], pendingActions: [] });
  ok(completed.stopReason === undefined, "已完成的 Job 不带停止原因");
  const approval = buildWorkforceJobViewModel({ run: run({ status: "awaiting_approval" }), steps: STEPS, events: [], pendingActions: [] });
  ok(approval.stopReason === undefined, "等待审批不算停下");

  // FIX-20 D10：进行中（含两轮之间回到排队）而有失败步骤 → 也带停止原因
  const quotaSteps = [step(1, "校验输入", "completed"), step(2, "解析投标文件", "completed"), step(3, "Canonical V2 包级分析", "failed", "model_quota_exhausted"), step(4, "要求抽取", "pending")];
  const working = buildWorkforceJobViewModel({ run: run({ status: "executing" }), steps: quotaSteps, events: [], pendingActions: [] });
  ok(working.status === "WORKING" && working.stopReason?.sentenceZh === "卡在第 3 步〈Canonical V2 包级分析〉：AI 账户余额不足，请联系平台管理员充值", "进行中的 Job 有失败步骤 → 带停止原因", working.stopReason);
  const requeued = buildWorkforceJobViewModel({ run: run({ status: "queued" }), steps: quotaSteps, events: [], pendingActions: [] });
  ok(requeued.status === "WORKING" && requeued.stopReason?.stepIndex === 3, "两轮之间回到排队 → 也带停止原因", requeued.stopReason);
  for (const status of ["partially_executed", "cancelled"]) {
    ok(buildWorkforceJobViewModel({ run: run({ status }), steps: quotaSteps, events: [], pendingActions: [] }).stopReason === undefined, `${status} 不带停止原因`);
  }
  const workingNoFail = buildWorkforceJobViewModel({ run: run({ status: "executing" }), steps: [step(1, "校验输入", "completed"), step(2, "解析投标文件", "running")], events: [], pendingActions: [] });
  ok(workingNoFail.stopReason === undefined, "进行中、没有失败步骤 → 不带停止原因");
}

// ── 源码断言：停止原因的计算不读 errorMessage ──
{
  const root = process.cwd();
  const sr = readFileSync(path.join(root, "src/lib/workforce-runtime/read-model/stop-reason.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/errorMessage/.test(sr), "stop-reason.ts（去掉注释）不引用 errorMessage");
  const proj = readFileSync(path.join(root, "src/lib/workforce-runtime/read-model/projection.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/errorMessage/.test(proj), "projection.ts（去掉注释）不引用 errorMessage");
  const svc = readFileSync(path.join(root, "src/lib/workforce-runtime/read-model/service.ts"), "utf8");
  const at = svc.indexOf("db.agentRunStep.findMany({");
  const stepSelect = svc.slice(at, svc.indexOf("db.agentRunEvent.findMany", at)).replace(/\/\/.*$/gm, "");
  ok(/errorCode: true/.test(stepSelect) && !/errorMessage/.test(stepSelect), "详情查询只多取步骤的 errorCode，不取 errorMessage");
  // FIX-20：步骤查询多取的只有 attemptCount、maxAttempts（列出全部选中的列逐一核对）
  const selected = [...stepSelect.matchAll(/(\w+): true/g)].map((m) => m[1]).sort();
  ok(JSON.stringify(selected) === JSON.stringify(["attemptCount", "completedAt", "createdAt", "errorCode", "id", "inputJson", "maxAttempts", "startedAt", "status", "stepKey", "title"]), "详情查询的步骤列：CHAIN-0c 的列 + attemptCount、maxAttempts", selected);
  const page = readFileSync(path.join(root, "src/app/(main)/workforce/[id]/page.tsx"), "utf8");
  ok(/job\.status === "FAILED" \? <StoppedCard/.test(page) && /系统未记录原因/.test(page), "详情页：失败时显示「任务未能完成」卡，算不出写「系统未记录原因」");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
