/**
 * 各源状态 → 统一 ExecutionStatus 映射（只读层）
 */

import type { ExecutionStatus } from "./types";

const AGENT_RUN: Record<string, ExecutionStatus> = {
  queued: "QUEUED",
  running: "RUNNING",
  waiting_for_approval: "WAITING_APPROVAL",
  waiting_approval: "WAITING_APPROVAL",
  waiting_for_user: "RUNNING",
  completed: "SUCCEEDED",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  timed_out: "TIMED_OUT",
  timeout: "TIMED_OUT",
  partial: "PARTIAL",
};

const PENDING_ACTION: Record<string, ExecutionStatus> = {
  pending: "WAITING_APPROVAL",
  approved: "RUNNING",
  rejected: "CANCELLED",
  executed: "SUCCEEDED",
  failed: "FAILED",
  expired: "TIMED_OUT",
};

const TOOL_TRACE: Record<string, ExecutionStatus> = {
  success: "SUCCEEDED",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  error: "FAILED",
  running: "RUNNING",
  pending: "QUEUED",
};

const SUPERVISOR: Record<string, ExecutionStatus> = {
  understanding: "RUNNING",
  planning: "RUNNING",
  running: "RUNNING",
  replanning: "RUNNING",
  waiting_for_user: "RUNNING",
  waiting_for_approval: "WAITING_APPROVAL",
  completed: "SUCCEEDED",
  failed: "FAILED",
  cancelled: "CANCELLED",
};

export function mapAgentRunStatus(raw: string | null | undefined): ExecutionStatus {
  if (!raw) return "QUEUED";
  return AGENT_RUN[raw.toLowerCase()] ?? "PARTIAL";
}

export function mapPendingActionStatus(raw: string | null | undefined): ExecutionStatus {
  if (!raw) return "WAITING_APPROVAL";
  return PENDING_ACTION[raw.toLowerCase()] ?? "PARTIAL";
}

export function mapToolTraceStatus(raw: string | null | undefined): ExecutionStatus {
  if (!raw) return "SUCCEEDED";
  return TOOL_TRACE[raw.toLowerCase()] ?? "PARTIAL";
}

export function mapSupervisorStatus(raw: string | null | undefined): ExecutionStatus {
  if (!raw) return "RUNNING";
  return SUPERVISOR[raw.toLowerCase()] ?? "PARTIAL";
}

export function mapSkillSuccess(success: boolean | null | undefined): ExecutionStatus {
  if (success === false) return "FAILED";
  if (success === true) return "SUCCEEDED";
  return "PARTIAL";
}
