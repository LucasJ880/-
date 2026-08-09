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
