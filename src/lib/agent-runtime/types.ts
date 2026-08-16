export type AgentRunStatus =
  | "queued"
  | "acknowledged"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRunEventType =
  | "run.started"
  | "ack.sent"
  | "context.loading"
  | "context.loaded"
  | "context.failed"
  | "planning.started"
  | "planning.completed"
  | "tool.started"
  | "tool.completed"
  /** T5-P1.1：工具正常让出（预算用尽、已 checkpoint），非失败 */
  | "tool.yielded"
  | "approval.required"
  | "approval.executed"
  | "approval.rejected"
  | "approval.failed"
  | "approval.expired"
  | "response.started"
  | "response.delta"
  | "response.completed"
  | "response.failed"
  | "retrieval.started"
  | "retrieval.completed"
  | "retrieval.failed"
  | "model.started"
  | "model.completed"
  | "model.failed"
  | "agent.output"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.reconciled"
  | "run.retry_requested"
  | "run.retry_started"
  | "grader.started"
  | "grader.completed"
  | "background.queued"
  | "background.started"
  | "background.completed"
  | "skill.started"
  | "skill.completed"
  // Agent Runtime 2.0
  | "plan.started"
  | "plan.created"
  | "step.ready"
  | "step.started"
  | "tool.failed"
  | "approval.resolved"
  | "step.completed"
  | "verification.started"
  | "verification.passed"
  | "verification.repair_required"
  | "verification.needs_human"
  | "repair.started"
  | "repair.completed"
  | "run.needs_human"
  // Workforce Runtime Phase 2A — Job 生命周期事件
  | "job.created"
  | "job.queued"
  | "job.claimed"
  | "job.lease_renewed"
  | "job.resumed"
  | "job.waiting_human"
  | "job.completed"
  | "job.failed"
  // Phase 2C-1（Pause/Resume Contract）：resume 门禁审计 + 人工介入恢复事件族
  // （clarification/human_action/human_edited 的生产者分别归 2C-3/2C-4，先冻结类型）
  | "job.resume_blocked"
  | "job.clarification_answered"
  | "job.human_action_completed"
  | "job.human_edited"
  // Phase 2B-2（Controlled Parallel）：最小内部观测事件（visibleToUser=false）
  | "task.claimed"
  | "parallel.batch_started"
  | "parallel.batch_completed";

export const ACTIVE_RUN_STATUSES: AgentRunStatus[] = [
  "queued",
  "acknowledged",
  "planning",
  "running",
  "awaiting_approval",
];

export const AGENT_RUN_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentRunTerminalStatus = (typeof AGENT_RUN_TERMINAL_STATUSES)[number];

export type AgentErrorCode =
  | "user_unbound"
  | "org_forbidden"
  | "session_failed"
  | "model_failed"
  | "model_parse_failed"
  | "tool_failed"
  | "external_timeout"
  | "pending_forbidden"
  | "run_cancelled"
  | "duplicate_message"
  | "db_error"
  | "unknown";
