/**
 * A0 确定性 outcome / failure 映射。
 * 禁止用 AI 判断 INTENT / HALLUCINATION / WRONG_TOOL。
 */

import type { AutopilotFailureType, AutopilotOutcome } from "./types";

export type DeterministicOutcomeInput = {
  status?: string | null;
  errorCode?: string | null;
  humanOverride?: boolean;
  cancelled?: boolean;
};

export function mapDeterministicOutcome(
  input: DeterministicOutcomeInput,
): AutopilotOutcome {
  if (input.humanOverride) return "HUMAN_OVERRIDE";
  const status = (input.status ?? "").toLowerCase();
  if (status === "cancelled" || input.cancelled) return "ABANDONED";
  if (status === "failed") return "FAILURE";
  // completed ≠ TASK_SUCCESS：A0 不把「跑完」当成任务成功
  return "UNKNOWN";
}

const SYSTEM_FAILURE_BY_ERROR: Record<string, AutopilotFailureType> = {
  org_forbidden: "PERMISSION_ERROR",
  pending_forbidden: "PERMISSION_ERROR",
  user_unbound: "PERMISSION_ERROR",
  tool_failed: "TOOL_FAILURE",
  external_timeout: "LATENCY_ERROR",
  model_failed: "EXTERNAL_SERVICE_FAILURE",
  model_parse_failed: "EXTERNAL_SERVICE_FAILURE",
  db_error: "EXTERNAL_SERVICE_FAILURE",
  session_failed: "WORKFLOW_ERROR",
  duplicate_message: "WORKFLOW_ERROR",
  unknown: "UNKNOWN",
};

export function mapDeterministicFailureType(
  errorCode: string | null | undefined,
): { failureType: AutopilotFailureType; failureSource: "system" } | null {
  if (!errorCode) return null;
  const key = errorCode.trim().toLowerCase();
  if (!key) return null;
  const failureType = SYSTEM_FAILURE_BY_ERROR[key] ?? "UNKNOWN";
  return { failureType, failureSource: "system" };
}
