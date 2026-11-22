/**
 * FIX-20 — 步骤失败怎样归类、综合汇总怎样降级、重试与受阻怎样显示（纯函数 + 投影 + 源码断言，不用库）
 *
 * 覆盖 change tender-job-synthesis-degrade design「验证方式」第一组：
 *   归类规则 / 降级判定 / 交接数据的话 / 重试投影（含重试中让出后）/
 *   停止原因新规则与计算时机 / synthesisNotGenerated 投影 / 源码断言。
 *
 * 运行：npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as constants from "../constants";
import * as stopReason from "../read-model/stop-reason";
import { buildWorkforceJobViewModel } from "../read-model/projection";
import type { WorkforceRunSnapshot, WorkforceStepSnapshot } from "../read-model/types";
import { buildWorkforceHandoffV1 } from "../handoff";
import { PLAN_SOURCE } from "../server-plan";
import { WORKFORCE_TASK_CONTRACT_WRITE_VERSION } from "../task-contract";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail)); }
}
/** 一组断言出异常（改动前的代码缺函数）也只记一条失败，接着跑下一组 */
function section(name: string, fn: () => void) {
  console.log(`\n[${name}]`);
  try { fn(); } catch (err) { fail++; console.error(`  ✗ ${name}：异常 ${err instanceof Error ? err.message : String(err)}`); }
}
// 通过命名空间取，改动前缺的导出是 undefined（不在 import 阶段就整体崩掉）
const C = constants as unknown as Record<string, unknown> & typeof constants;
const SR = stopReason as unknown as Record<string, unknown> & typeof stopReason;
type Fn = (...args: never[]) => unknown;
const fn = <T extends Fn>(mod: Record<string, unknown>, name: string): T => {
  const f = mod[name];
  if (typeof f !== "function") throw new Error(`缺少导出 ${name}`);
  return f as T;
};

const QUOTA_TEXT = "SYNTHESIS_MODEL_FAILED: 429 You exceeded your current quota, please check your plan and billing details";
const QUOTA_ZH = "AI 账户余额不足，请联系平台管理员充值";
const T0 = new Date("2026-11-22T21:27:00Z");

const spec = (taskKind: "work" | "synthesis") => ({
  workforceTask: {
    contractVersion: WORKFORCE_TASK_CONTRACT_WRITE_VERSION,
    worker: taskKind === "synthesis" ? { workerKey: "synthesis_worker", role: "synthesis" } : { workerKey: "tender_worker", role: "tender" },
    taskKind,
    objective: taskKind === "synthesis" ? "合并各上游任务的结构化 Handoff" : "投标分析任务",
  },
});
const TITLES = ["校验输入", "解析投标文件", "Canonical V2 包级分析", "证据与合规覆盖", "风险分析", "澄清问题草稿", "Grounded 交付物物化", "Workforce 执行汇总", "Canonical V2 状态终态化"];
type StepOverride = Partial<WorkforceStepSnapshot> & { attemptCount?: number; maxAttempts?: number };
function nineSteps(overrides: Record<number, StepOverride> = {}): WorkforceStepSnapshot[] {
  return TITLES.map((title, i) => ({
    id: `s${i + 1}`,
    stepKey: `t${i + 1}`,
    title,
    status: "completed",
    errorCode: null,
    inputJson: spec(i === 7 ? "synthesis" : "work"),
    startedAt: null,
    completedAt: null,
    createdAt: new Date(T0.getTime() + i * 1000),
    attemptCount: 1,
    maxAttempts: 2,
    ...overrides[i + 1],
  }) as WorkforceStepSnapshot);
}
const run = (o: Partial<WorkforceRunSnapshot>): WorkforceRunSnapshot => ({
  id: "job1", orgId: "org1", runType: "workforce_job", status: "executing", attempts: 1, errorCode: null, errorMessage: null,
  planJson: null, metadata: { workDomain: "tender", planSource: "SERVER_AUTHORED" }, startedAt: T0, completedAt: null, cancelledAt: null, createdAt: T0, updatedAt: T0,
  ...o,
} as WorkforceRunSnapshot);
const view = (r: Partial<WorkforceRunSnapshot>, steps: WorkforceStepSnapshot[]) =>
  buildWorkforceJobViewModel({ run: run(r), steps, events: [], pendingActions: [] }) as ReturnType<typeof buildWorkforceJobViewModel> & Record<string, unknown>;

console.log("FIX-20 step-failure-visibility");

section("归类规则（写入时）", () => {
  const classify = fn<(i: { errorText: string | null | undefined; isSynthesis: boolean }) => string>(C, "classifyStepFailureErrorCode");
  ok(classify({ errorText: QUOTA_TEXT, isSynthesis: true }) === "model_quota_exhausted", "OpenAI 余额不足原文 → model_quota_exhausted");
  ok(classify({ errorText: "Error: 429 insufficient_quota", isSynthesis: false }) === "model_quota_exhausted", "工具步骤里带 insufficient_quota → model_quota_exhausted");
  ok(classify({ errorText: "YOU EXCEEDED YOUR CURRENT QUOTA", isSynthesis: true }) === "model_quota_exhausted", "不分大小写");
  // 2026-11-22 生产 Vercel 日志里 OpenAI 429 的原话（16:40:31 多伦多时间起）
  ok(classify({ errorText: "SYNTHESIS_MODEL_FAILED: 429 no credits remaining", isSynthesis: true }) === "model_quota_exhausted", "生产原话「429 no credits remaining」→ model_quota_exhausted");
  ok(classify({ errorText: "TOOL_FAILED: 429 No Credits Remaining", isSynthesis: false }) === "model_quota_exhausted", "「No Credits Remaining」不分大小写，工具步骤同样认出");
  ok(classify({ errorText: "SYNTHESIS_MODEL_FAILED: 配额限制：月 AI 费用已达 hard limit", isSynthesis: true }) === "org_ai_budget_exhausted", "本组织月度费用预检 → org_ai_budget_exhausted");
  ok(classify({ errorText: "400 Invalid request", isSynthesis: true }) === "synthesis_failed", "「400 Invalid request」综合汇总 → synthesis_failed");
  ok(classify({ errorText: "429 Rate limit reached for requests", isSynthesis: true }) === "synthesis_failed", "「429 Rate limit reached」不误认为余额不足（综合汇总）");
  ok(classify({ errorText: "429 Rate limit reached for requests", isSynthesis: false }) === "tool_failed", "「429 Rate limit reached」工具步骤 → tool_failed");
  ok(classify({ errorText: "400 Invalid request", isSynthesis: false }) === "tool_failed", "普通错误工具步骤 → tool_failed");
  ok(classify({ errorText: null, isSynthesis: true }) === "synthesis_failed" && classify({ errorText: "", isSynthesis: false }) === "tool_failed", "没有错误文本 → 笼统码");
  ok(C.STEP_ERROR_STALE_RUNNING_RECOVERED === "stale_running_recovered", "中断回收的错误码常量");
});

section("降级判定（D3）", () => {
  const should = fn<(i: { workDomain: unknown; planSource: unknown; isNativeSynthesis: boolean; errorCode: string | null }) => boolean>(C, "shouldDegradeFailedSynthesisStep");
  const base = { workDomain: "tender", planSource: "SERVER_AUTHORED", isNativeSynthesis: true };
  for (const code of ["synthesis_failed", "model_quota_exhausted", "org_ai_budget_exhausted", "step_attempts_exhausted", "stale_running_exhausted"]) {
    ok(should({ ...base, errorCode: code }), `执行失败码 ${code} → 降级`);
  }
  for (const code of ["workforce_task_invalid", "workforce_worker_invalid", "HANDOFF_MISSING", "HANDOFF_MALFORMED", "HANDOFF_VERSION_UNSUPPORTED", "HANDOFF_SOURCE_MISMATCH", "handoff_build_failed", "workforce_step_exception", "tool_failed"]) {
    ok(!should({ ...base, errorCode: code }), `契约类 / 非综合汇总的码 ${code} → 不降级`);
  }
  ok(!should({ ...base, errorCode: null }), "没有错误码 → 不降级");
  ok(!should({ ...base, workDomain: "sales", errorCode: "synthesis_failed" }), "销售域 → 不降级");
  ok(!should({ ...base, workDomain: undefined, errorCode: "synthesis_failed" }), "没有业务域 → 不降级");
  ok(!should({ ...base, planSource: "LLM_PLANNER", errorCode: "synthesis_failed" }), "模型规划的招投标 Job → 不降级");
  ok(!should({ ...base, isNativeSynthesis: false, errorCode: "synthesis_failed" }), "不是原生综合汇总 → 不降级");
  ok(C.SERVER_AUTHORED_PLAN_SOURCE === PLAN_SOURCE.SERVER_AUTHORED, "constants 里的字面量 \"SERVER_AUTHORED\" 与 PLAN_SOURCE.SERVER_AUTHORED 相同");
  const codes = C.SYNTHESIS_EXECUTION_FAILURE_CODES as readonly string[] | undefined;
  ok(Array.isArray(codes) && codes.length === 5, "执行失败码集合导出供 FIX-20b 复用", codes);
});

section("交接数据的话（跳过的综合汇总）", () => {
  const h = buildWorkforceHandoffV1({
    runId: "job1", stepKey: "t8_synthesis", workerKey: "synthesis_worker", taskKind: "synthesis", stepStatus: "skipped",
    taskObjective: "合并各上游任务的结构化 Handoff", businessOutput: { synthesisNotGenerated: true, reasonCode: "model_quota_exhausted" },
    completedAt: T0, upstreamHandoffs: [],
  });
  ok(h.ok && h.payload.summary === "综合汇总未生成", "摘要为「综合汇总未生成」", h.ok ? h.payload.summary : h);
  ok(h.ok && (h.payload.warnings ?? []).includes(`综合汇总未生成：${QUOTA_ZH}`), "警告写明原因白话", h.ok ? h.payload.warnings : h);
  ok(h.ok && !(h.payload.warnings ?? []).some((w) => w.includes("审批拒绝或无可写对象")), "没有「该任务未产生业务写入（审批拒绝或无可写对象）」");
  ok(h.ok && !JSON.stringify(h.payload).includes("degraded"), "交接数据不带降级证据标记");
  const unknown = buildWorkforceHandoffV1({
    runId: "job1", stepKey: "t8_synthesis", workerKey: "synthesis_worker", taskKind: "synthesis", stepStatus: "skipped",
    taskObjective: "x", businessOutput: { synthesisNotGenerated: true, reasonCode: "weird" }, completedAt: T0, upstreamHandoffs: [],
  });
  ok(unknown.ok && (unknown.payload.warnings ?? []).includes("综合汇总未生成：执行出错"), "原因码认不出 → 执行出错");
  const approvalSkip = buildWorkforceHandoffV1({
    runId: "job1", stepKey: "s9", workerKey: "synthesis_worker", taskKind: "synthesis", stepStatus: "skipped",
    taskObjective: "汇总", businessOutput: { skipped: true }, completedAt: T0, upstreamHandoffs: [],
  });
  ok(approvalSkip.ok && approvalSkip.payload.summary === "任务未执行（skipped）：汇总" && (approvalSkip.payload.warnings ?? []).includes("该任务未产生业务写入（审批拒绝或无可写对象）"), "别的跳过（审批被拒）保持原话");
});

section("重试投影（D8）", () => {
  const waiting = view({ status: "queued" }, nineSteps({ 8: { status: "ready", attemptCount: 1, errorCode: "model_quota_exhausted" }, 9: { status: "pending", attemptCount: 0 } }));
  const t8 = waiting.tasks[7] as { retry?: { attempt: number; maxRetries: number; reasonZh: string } };
  ok(t8.retry?.attempt === 1 && t8.retry.maxRetries === 1 && t8.retry.reasonZh === QUOTA_ZH, "待开始、尝试 1 次、有错误码 → 第 1 次重试、最多 1 次、原因白话", t8.retry);
  const sentence = fn<(i: { stepIndex: number; stepTitle: string; attempt: number; maxRetries: number; reasonZh: string }) => string>(SR, "retrySentenceZh");
  ok(sentence({ stepIndex: 8, stepTitle: "Workforce 执行汇总", ...t8.retry! }) === `第 8 步〈Workforce 执行汇总〉正在第 1 次重试（最多重试 1 次）。上一次没成功：${QUOTA_ZH}`, "重试句的写法");
  const running = view({}, nineSteps({ 3: { status: "running", attemptCount: 2, errorCode: "tool_failed" } }));
  const t3 = running.tasks[2] as { retry?: { attempt: number } };
  ok(t3.retry?.attempt === 1, "执行中、尝试 2 次、有错误码 → 第 1 次重试（尝试次数减 1）", t3.retry);
  const firstRun = view({}, nineSteps({ 3: { status: "running", attemptCount: 1, errorCode: null } }));
  ok((firstRun.tasks[2] as { retry?: unknown }).retry === undefined, "第一次执行（尝试 1 次、没有错误码）→ 没有重试信息");
  const yieldedFirst = view({ status: "queued" }, nineSteps({ 3: { status: "ready", attemptCount: 0, errorCode: null } }));
  ok((yieldedFirst.tasks[2] as { retry?: unknown }).retry === undefined, "第一次执行中途让出（尝试次数退回 0、错误码清掉）→ 没有重试信息");
  const yieldedRetry = view({ status: "queued" }, nineSteps({ 3: { status: "ready", attemptCount: 1, errorCode: "tool_failed" } }));
  const y3 = yieldedRetry.tasks[2] as { retry?: { attempt: number; reasonZh: string } };
  ok(y3.retry?.attempt === 1 && y3.retry.reasonZh === "工具执行失败", "重试中途让出（尝试次数退回 1、错误码保留）→ 仍是第 1 次重试", y3.retry);
  const never = view({ status: "queued" }, nineSteps({ 9: { status: "pending", attemptCount: 0, errorCode: null } }));
  ok((never.tasks[8] as { retry?: unknown }).retry === undefined, "没失败过（待开始、尝试 0 次）→ 没有重试信息");
  const recovered = view({ status: "queued" }, nineSteps({ 8: { status: "ready", attemptCount: 1, errorCode: "stale_running_recovered" } }));
  ok((recovered.tasks[7] as { retry?: { reasonZh: string } }).retry?.reasonZh === "上一次执行时间过长被中断", "中断回收后 → 原因「上一次执行时间过长被中断」");
  const doneWithCode = view({ status: "completed" }, nineSteps({ 9: { status: "completed", attemptCount: 2, errorCode: "model_quota_exhausted" } }));
  ok((doneWithCode.tasks[8] as { retry?: unknown }).retry === undefined, "已完成的步骤上留着旧错误码 → 没有重试信息");
  ok(!JSON.stringify(waiting).includes("model_quota_exhausted") && !JSON.stringify(waiting).includes("quota"), "视图里没有错误码原文");
});

section("停止原因新规则（D9）", () => {
  const fromCodes = fn<(i: { stepFailed: boolean; stepErrorCode: string | null; jobErrorCode: string | null; jobStatus: string }) => string>(SR, "stopReasonFromCodes");
  ok(fromCodes({ stepFailed: true, stepErrorCode: "synthesis_failed", jobErrorCode: "blocked_graph", jobStatus: "needs_human" }) === "综合汇总生成失败", "失败步骤 synthesis_failed → 综合汇总生成失败（不回落 Job 的 blocked_graph）");
  ok(fromCodes({ stepFailed: true, stepErrorCode: "model_quota_exhausted", jobErrorCode: "blocked_graph", jobStatus: "needs_human" }) === QUOTA_ZH, "失败步骤 model_quota_exhausted → 余额不足");
  ok(fromCodes({ stepFailed: true, stepErrorCode: "org_ai_budget_exhausted", jobErrorCode: null, jobStatus: "failed" }) === "本组织本月 AI 费用已达上限，请组织管理员调高月度上限", "失败步骤 org_ai_budget_exhausted → 本组织本月 AI 费用已达上限");
  ok(fromCodes({ stepFailed: true, stepErrorCode: null, jobErrorCode: "model_failed", jobStatus: "failed" }) === "执行出错", "失败步骤没有错误码 → 执行出错（不回落 Job 的码）");
  ok(fromCodes({ stepFailed: true, stepErrorCode: "workforce_task_invalid", jobErrorCode: "workforce_task_invalid", jobStatus: "needs_human" }) === "执行出错", "契约损坏 → 执行出错（不再是「需要人工处理」）");
  ok(fromCodes({ stepFailed: false, stepErrorCode: "model_quota_exhausted", jobErrorCode: "verification_failed", jobStatus: "needs_human" }) === "结果没有通过校验", "不是失败步骤 → 只用 Job 的码，不读步骤上留下的码");
  ok(fromCodes({ stepFailed: false, stepErrorCode: "stale_running_recovered", jobErrorCode: "USER_INACTIVE", jobStatus: "needs_human" }) === "需要人工处理", "待开始步骤留着回收码、Job 码不在表里 → 需要人工处理（不是「上一次执行时间过长被中断」）");
  const allDone = view({ status: "needs_human", errorCode: "verification_failed" }, nineSteps({ 9: { status: "completed", attemptCount: 2, errorCode: "model_quota_exhausted" } }));
  ok(allDone.stopReason?.stepIndex === 9 && allDone.stopReason.reasonZh === "结果没有通过校验", "每一步都完成、第 9 步留着旧码 → 卡在第 9 步：结果没有通过校验", allDone.stopReason);
  const t8failed = view({ status: "needs_human", errorCode: "blocked_graph" }, nineSteps({ 8: { status: "failed", attemptCount: 2, errorCode: "model_quota_exhausted" }, 9: { status: "pending", attemptCount: 0 } }));
  ok(t8failed.stopReason?.sentenceZh === `卡在第 8 步〈Workforce 执行汇总〉：${QUOTA_ZH}`, "第 8 步余额不足 → 不写「前置步骤没有完成」", t8failed.stopReason);
});

section("停止原因的计算时机（D10）", () => {
  const steps = () => nineSteps({ 3: { status: "failed", attemptCount: 2, errorCode: "model_quota_exhausted" }, 4: { status: "pending" }, 5: { status: "pending" }, 6: { status: "pending" }, 7: { status: "pending" }, 8: { status: "pending" }, 9: { status: "pending" } });
  const working = view({ status: "executing" }, steps());
  ok(working.status === "WORKING" && working.stopReason?.sentenceZh === `卡在第 3 步〈Canonical V2 包级分析〉：${QUOTA_ZH}`, "进行中有失败步骤 → 带停止原因", working.stopReason);
  const between = view({ status: "queued" }, steps());
  ok(between.status === "WORKING" && between.stopReason?.stepIndex === 3, "两轮之间回到排队 → 也带停止原因", between.stopReason);
  for (const status of ["awaiting_approval", "completed", "partially_executed", "cancelled"]) {
    ok(view({ status }, steps()).stopReason === undefined, `${status} → 不带停止原因`);
  }
  ok(view({ status: "executing" }, nineSteps({ 9: { status: "running" } })).stopReason === undefined, "进行中、没有失败步骤 → 不带停止原因");
});

section("synthesisNotGenerated 投影（D11）", () => {
  const skipped = nineSteps({ 8: { status: "skipped", attemptCount: 2, errorCode: "model_quota_exhausted" } });
  const v = view({ status: "completed" }, skipped);
  const s = v.synthesisNotGenerated as { stepIndex: number; stepTitle: string; reasonZh: string } | undefined;
  ok(s?.stepIndex === 8 && s.stepTitle === "Workforce 执行汇总" && s.reasonZh === QUOTA_ZH, "招投标服务端计划、综合汇总已跳过 → 带说明", s);
  const sentence = fn<(reasonZh: string) => string>(SR, "synthesisNotGeneratedSentenceZh");
  ok(sentence(QUOTA_ZH) === `AI 数字员工的综合汇总未生成：${QUOTA_ZH}`, "说明句的写法");
  ok(!sentence(QUOTA_ZH).includes("解读"), "说明句不用「解读」二字");
  const noCode = view({ status: "completed" }, nineSteps({ 8: { status: "skipped", errorCode: null } }));
  ok((noCode.synthesisNotGenerated as { reasonZh?: string } | undefined)?.reasonZh === "执行出错", "跳过的综合汇总没有错误码 → 原因「执行出错」");
  const sales = view({ status: "completed", metadata: { workDomain: "sales", planSource: "LLM_PLANNER" } }, skipped);
  ok(sales.synthesisNotGenerated === undefined, "销售域里审批被拒而跳过的综合汇总 → 不带说明");
  const llm = view({ status: "completed", metadata: { workDomain: "tender", planSource: "LLM_PLANNER" } }, skipped);
  ok(llm.synthesisNotGenerated === undefined, "模型规划的招投标 Job → 不带说明");
  ok(view({ status: "completed" }, nineSteps()).synthesisNotGenerated === undefined, "综合汇总已完成 → 不带说明");
  ok(!JSON.stringify(v).includes("quota") && !JSON.stringify(v).includes("model_quota_exhausted"), "视图里没有错误码原文");
});

section("源码断言", () => {
  const root = process.cwd();
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const consts = read("src/lib/workforce-runtime/constants.ts");
  ok(!/^\s*import\s/m.test(consts) && !/\brequire\(/.test(consts), "constants.ts 没有任何 import（仍是零依赖）");
  const MODEL_ENTRIES = /createCompletion|executeWorkforceSynthesisTask|executeRuntimeV2Tool|@\/lib\/ai\//;
  const exec = read("src/lib/agent-runtime-v2/executor.ts");
  const degradeAt = exec.indexOf("async function degradeFailedNativeSynthesisSteps(");
  const degradeEnd = exec.indexOf("\n}\n", degradeAt);
  const degradeBody = degradeAt >= 0 ? exec.slice(degradeAt, degradeEnd) : "";
  ok(degradeBody.length > 0 && !MODEL_ENTRIES.test(degradeBody), "执行器的降级函数不引用任何模型调用入口");
  ok(/shouldDegradeFailedSynthesisStep\(/.test(degradeBody) && /status: "failed"/.test(degradeBody) && /updateMany\(/.test(degradeBody), "降级是条件更新（只在仍为失败时改），判定从 constants 取");
  const round = exec.slice(exec.indexOf("async function executeRoundGuarded("), exec.indexOf("await refreshReadySteps(orgId, runId, fence);"));
  ok(/getOrgMembership\(userId, orgId\)[\s\S]*await degradeFailedNativeSynthesisSteps\(/.test(round), "每轮开头：成员资格检查之后、依赖推进之前做降级");
  for (const f of ["src/lib/workforce-runtime/read-model/stop-reason.ts", "src/lib/workforce-runtime/read-model/projection.ts", "src/lib/workforce-runtime/handoff.ts"]) {
    ok(!MODEL_ENTRIES.test(strip(read(f))), `${path.basename(f)}（说明拼装）不引用模型调用入口`);
  }
  for (const f of ["src/lib/workforce-runtime/read-model/stop-reason.ts", "src/lib/workforce-runtime/read-model/projection.ts"]) {
    ok(!/errorMessage/.test(strip(read(f))), `${path.basename(f)}（去掉注释）不引用 errorMessage`);
  }
  const svc = read("src/lib/workforce-runtime/read-model/service.ts");
  const at = svc.indexOf("db.agentRunStep.findMany({");
  const stepSelect = strip(svc.slice(at, svc.indexOf("db.agentRunEvent.findMany", at)));
  ok(/attemptCount: true/.test(stepSelect) && /maxAttempts: true/.test(stepSelect) && !/errorMessage/.test(stepSelect), "详情查询多取 attemptCount、maxAttempts，不取 errorMessage");
  // 让出分支：重试那次认领保留错误码、第一次执行清掉；字符窗口不变
  const yAt = exec.indexOf("if (batchContinuation) {");
  const yieldBlock = exec.slice(yAt, exec.indexOf("tool.yielded", yAt));
  ok(/row\.attemptCount >= 2 \? row\.errorCode : null/.test(exec.slice(exec.indexOf("async function executeClaimedWorkforceStep("), yAt)), "让出前算好：认领后尝试次数 ≥ 2 才保留错误码");
  ok(!/errorCode: null/.test(yieldBlock) && /errorCode: yieldErrorCode/.test(yieldBlock), "批量路径让出分支写算好的错误码（不再一律清空）");
  ok(/if \(batchContinuation\)[\s\S]{0,600}completedAt: null/.test(exec), "让出分支字符窗口：600 字符内仍有 completedAt: null");
  // 失败分支：还会重试与最终失败都写归类后的码，事件同码
  const failAt = exec.indexOf("if (!result.ok) {", yAt);
  const failBlock = exec.slice(failAt, exec.indexOf("return { kind: \"continued\" };", failAt));
  ok(/classifyStepFailureErrorCode\(\{[\s\S]*isSynthesis: isNativeSynthesis/.test(failBlock), "失败分支按规则归类错误码");
  ok(/\{ status: "ready", errorCode: failureErrorCode, errorMessage: result\.error \}/.test(failBlock), "还会重试：回到待开始，也写错误码");
  ok(/status: "failed",[\s\S]{0,200}errorCode: failureErrorCode/.test(failBlock) && /errorCode: failureErrorCode,\s*\},\s*\}\);/.test(failBlock), "最终失败与 tool.failed 事件用同一个码");
  const proc = read("src/lib/workforce-runtime/processor.ts");
  const recAt = proc.indexOf("const staleRunning = await db.agentRunStep.findMany(");
  const recBlock = proc.slice(recAt, proc.indexOf("resolveRuntimeV2Principal", recAt));
  ok(/data: \{ status: "ready", errorCode: STEP_ERROR_STALE_RUNNING_RECOVERED \}/.test(recBlock), "处理器回收：写 stale_running_recovered，尝试次数不动");
  ok(/eventType: "step\.ready"[\s\S]{0,300}recoveredFrom: "stale_running"[\s\S]{0,200}visibleToUser: false/.test(recBlock), "处理器回收：写一条不对用户显示的 step.ready 事件");
  ok(/errorCode: "stale_running_exhausted"/.test(recBlock), "次数用尽的照旧记 stale_running_exhausted");
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
