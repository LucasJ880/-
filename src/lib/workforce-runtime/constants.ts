/**
 * Workforce Runtime Phase 2A — 常量（零依赖，供 executor 等低层安全引用）
 *
 * 核心等式（冻结）：Job = root AgentRun（runType="workforce_job"）；jobId = rootRunId。
 */

export const WORKFORCE_JOB_RUN_TYPE = "workforce_job";

/**
 * workforce_job 在执行期间可能出现的"活跃"状态（v2 状态词汇表子集）。
 * 这些状态 + 租约过期 = 可被其他 worker 重新认领（crash recovery）。
 * 注意不含 awaiting_approval / needs_human（等待人，不允许被认领续跑）。
 */
export const WORKFORCE_ACTIVE_STATUSES = [
  "running",
  "planning",
  "planned",
  "executing",
  "verifying",
  "repairing",
] as const;

/**
 * T5-P1.1 §3/§4 —— agent-runs serverless invocation 预算。
 *
 * 路由 maxDuration = 300s；这里只给 **240s** 的活跃工作预算，
 * 留约 60s 给 checkpoint 落盘、Step 状态写、Job 回队、事件与 DB 往返。
 * 与 #113 的 Tender cron 采用同一安全模型（INVOCATION_BUDGET_MS = 240s）。
 *
 * 注意：这**不是**新的 one-shot 上限——长任务仍必须可续跑，
 * 240s 只保证单个安全切片里能塞下一次完整的模型调用。
 */
export const AGENT_RUNS_MAX_DURATION_S = 300;
export const AGENT_RUNS_INVOCATION_BUDGET_MS = 240_000;

/**
 * 观察期包1 · 延迟压缩 —— 让出链式自触发的 depth 硬上限（防风暴兜底）。
 *
 * 每次让出后由 route 层自触发下一个 cron invocation（消除 2 分钟节拍空转）。
 * depth 随链递增；到达上限后停止自触发，退回 cron 节拍兜底——不报错、
 * 不影响 Job（下一班 cron 照常接手）。163 页首单 = 8 个 invocation，
 * 25 给足数倍余量，只用于拦截病理性循环。
 */
export const WORKFORCE_CONTINUATION_MAX_DEPTH = 25;

/* ────────────────────────────────────────────────────────────────────
 * FIX-20 — 步骤失败在写入时归类成错误码；招投标确定性计划里的综合汇总失败可降级
 *
 * 放在这里（而不是新文件）是因为执行器已经引用本文件：多取几个名字不新增
 * agent-runtime-v2 → workforce-runtime 的引用边，运行时架构基线不变（design D6）。
 * 本段同样零依赖；只做确定性的字符串判断，不调模型。读取侧只查错误码，不读错误原文。
 * ──────────────────────────────────────────────────────────────────── */

/** AI 账户余额不足（模型供应商拒绝：OpenAI 的 insufficient_quota） */
export const STEP_ERROR_MODEL_QUOTA_EXHAUSTED = "model_quota_exhausted";
/** 本组织本月 AI 费用已达上限（统一模型出口的费用预检） */
export const STEP_ERROR_ORG_AI_BUDGET_EXHAUSTED = "org_ai_budget_exhausted";
/** 原生综合汇总的笼统失败码（#94 §20） */
export const STEP_ERROR_SYNTHESIS_FAILED = "synthesis_failed";
/** 工具步骤的笼统失败码 */
export const STEP_ERROR_TOOL_FAILED = "tool_failed";
/** 处理器把前一个执行者遗留的「执行中」步骤回收为「待开始」（次数未尽） */
export const STEP_ERROR_STALE_RUNNING_RECOVERED = "stale_running_recovered";

/**
 * 余额不足的识别字面量（不分大小写）。
 * - insufficient_quota：OpenAI 错误的 code / type，代理或别的链路可能带进文本；
 * - exceeded your current quota：OpenAI SDK 拼进 err.message 的原话；
 * - no credits remaining：2026-11-22 生产 Vercel 日志里 OpenAI 429 的原话（多伦多时间 16:40:31 起）。
 * 生产确切文本以 FIX-15 分支 docs/acceptance/fix-15/prod-check.sql A 段与 FIX-20 design 附录 SQL 的
 * 结果为准（G1），结果回来若原文不同，只在这里补字面量。
 */
export const MODEL_QUOTA_EXHAUSTED_LITERALS: readonly string[] = [
  "insufficient_quota",
  "exceeded your current quota",
  "no credits remaining",
];
/** 本组织月度费用预检失败时的原话（ai/client.ts「配额限制：月 AI 费用已达 hard limit」） */
export const ORG_AI_BUDGET_EXHAUSTED_LITERAL = "月 AI 费用已达 hard limit";

/** 错误文本是不是 AI 账户余额不足（收尾的已知标记也用这一份） */
export function isModelQuotaExhaustedText(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  return t.length > 0 && MODEL_QUOTA_EXHAUSTED_LITERALS.some((lit) => t.includes(lit));
}

/** 错误文本是不是本组织本月 AI 费用已达上限 */
export function isOrgAiBudgetExhaustedText(text: string | null | undefined): boolean {
  return (text ?? "").includes(ORG_AI_BUDGET_EXHAUSTED_LITERAL);
}

/**
 * 步骤执行失败（还会不会再试都一样）时写进这一步的错误码：
 * 余额不足 → model_quota_exhausted；本组织费用上限 → org_ai_budget_exhausted；
 * 其余：综合汇总 synthesis_failed，工具步骤 tool_failed。
 * 只决定「显示什么话」，不决定重试与否（design D7：照既有次数重试）。
 */
export function classifyStepFailureErrorCode(input: {
  errorText: string | null | undefined;
  isSynthesis: boolean;
}): string {
  if (isModelQuotaExhaustedText(input.errorText)) return STEP_ERROR_MODEL_QUOTA_EXHAUSTED;
  if (isOrgAiBudgetExhaustedText(input.errorText)) return STEP_ERROR_ORG_AI_BUDGET_EXHAUSTED;
  return input.isSynthesis ? STEP_ERROR_SYNTHESIS_FAILED : STEP_ERROR_TOOL_FAILED;
}

/**
 * 计划来源「服务端确定性计划」的字面量。与 server-plan.ts 的 PLAN_SOURCE.SERVER_AUTHORED
 * 相同（测试断言两者相等）；这里写字面量是为了本文件保持零依赖。
 */
export const SERVER_AUTHORED_PLAN_SOURCE = "SERVER_AUTHORED";

/** 业务域 + 计划来源：招投标、服务端确定性计划（两个都是只有服务端能写的保留键） */
export function isTenderServerAuthoredPlan(workDomain: unknown, planSource: unknown): boolean {
  return workDomain === "tender" && planSource === SERVER_AUTHORED_PLAN_SOURCE;
}

/**
 * 综合汇总「执行失败」的错误码集合：只有这些可以降级为已跳过（design D3）。
 * 契约类（workforce_task_invalid / workforce_worker_invalid / HANDOFF_* /
 * handoff_build_failed / workforce_step_exception）不在其中，照旧停下。
 * FIX-20b「从失败的这一步继续」也从这里取。
 */
export const SYNTHESIS_EXECUTION_FAILURE_CODES: readonly string[] = [
  STEP_ERROR_SYNTHESIS_FAILED,
  STEP_ERROR_MODEL_QUOTA_EXHAUSTED,
  STEP_ERROR_ORG_AI_BUDGET_EXHAUSTED,
  "step_attempts_exhausted",
  "stale_running_exhausted",
];

/**
 * 失败的综合汇总步骤该不该降级为「已跳过」（四个条件同时满足）：
 * 招投标域、服务端确定性计划、原生综合汇总（taskKind=synthesis 且无 preferredTool）、执行失败码。
 */
export function shouldDegradeFailedSynthesisStep(input: {
  workDomain: unknown;
  planSource: unknown;
  isNativeSynthesis: boolean;
  errorCode: string | null | undefined;
}): boolean {
  return (
    isTenderServerAuthoredPlan(input.workDomain, input.planSource) &&
    input.isNativeSynthesis &&
    typeof input.errorCode === "string" &&
    SYNTHESIS_EXECUTION_FAILURE_CODES.includes(input.errorCode)
  );
}
