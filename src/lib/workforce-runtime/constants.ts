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
