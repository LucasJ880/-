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
  | "planning.started"
  | "planning.completed"
  | "tool.started"
  | "tool.completed"
  | "approval.required"
  | "approval.executed"
  | "approval.rejected"
  | "approval.failed"
  | "approval.expired"
  | "response.started"
  | "response.delta"
  | "response.completed"
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
  | "run.needs_human";

export const ACTIVE_RUN_STATUSES: AgentRunStatus[] = [
  "queued",
  "acknowledged",
  "planning",
  "running",
  "awaiting_approval",
];

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
