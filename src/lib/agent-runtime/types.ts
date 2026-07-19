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
  | "response.started"
  | "response.delta"
  | "response.completed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "grader.started"
  | "grader.completed"
  | "background.queued"
  | "background.started"
  | "background.completed"
  | "skill.started"
  | "skill.completed";

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
