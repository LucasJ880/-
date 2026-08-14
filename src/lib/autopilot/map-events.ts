/**
 * 将现有 AgentRunEvent 映射为 Autopilot canonical trace events。
 * 不复制完整 payload；调用方负责 sanitize。
 */

import type { AutopilotTraceEventType } from "./types";

export type MappedAutopilotEvent = {
  eventType: AutopilotTraceEventType;
  durationMs: number | null;
  payload: Record<string, unknown>;
};

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function durationFrom(payload: Record<string, unknown>): number | null {
  const v = payload.durationMs;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function mapAgentRunEventToAutopilot(
  eventType: string,
  payload?: unknown,
): MappedAutopilotEvent | null {
  const p = asRecord(payload);
  const durationMs = durationFrom(p);

  switch (eventType) {
    case "run.started":
      return { eventType: "USER_INPUT", durationMs, payload: { source: "run.started" } };
    case "ack.sent":
      return null;
    case "context.loading":
      return null;
    case "context.loaded":
      return { eventType: "CONTEXT_LOADED", durationMs, payload: { source: "context.loaded" } };
    case "planning.completed":
    case "plan.created":
      return {
        eventType: "INTENT_RESOLVED",
        durationMs,
        payload: { source: eventType },
      };
    case "tool.started":
      return {
        eventType: "TOOL_CALL_STARTED",
        durationMs,
        payload: { source: "tool.started", name: p.name ?? null },
      };
    case "tool.failed":
      return {
        eventType: "TOOL_CALL_FAILED",
        durationMs,
        payload: { source: "tool.failed", name: p.name ?? null },
      };
    case "tool.completed": {
      const failed = p.ok === false;
      return {
        eventType: failed ? "TOOL_CALL_FAILED" : "TOOL_CALL_COMPLETED",
        durationMs,
        payload: { source: "tool.completed", name: p.name ?? null, ok: p.ok ?? true },
      };
    }
    case "response.started":
    case "grader.started":
      return {
        eventType: "MODEL_STARTED",
        durationMs,
        payload: { source: eventType },
      };
    case "response.completed":
    case "grader.completed":
      return {
        eventType: "MODEL_COMPLETED",
        durationMs,
        payload: { source: eventType, toolCalls: p.toolCalls ?? null },
      };
    case "job.human_edited":
      return {
        eventType: "HUMAN_EDIT",
        durationMs,
        payload: { source: "job.human_edited" },
      };
    case "approval.rejected":
      return {
        eventType: "HUMAN_OVERRIDE",
        durationMs,
        payload: { source: "approval.rejected" },
      };
    case "approval.executed":
    case "job.human_action_completed":
      return {
        eventType: "HUMAN_ACTION",
        durationMs,
        payload: { source: eventType },
      };
    case "run.completed":
    case "job.completed":
      return {
        eventType: "TASK_COMPLETED",
        durationMs,
        payload: { source: eventType, latencyMs: p.latencyMs ?? null },
      };
    case "run.failed":
    case "job.failed":
      return {
        eventType: "TASK_FAILED",
        durationMs,
        payload: { source: eventType, code: p.code ?? null },
      };
    default:
      return null;
  }
}

export function countToolCallsFromEventTypes(eventTypes: string[]): {
  toolCallCount: number;
  toolFailureCount: number;
} {
  let toolCallCount = 0;
  let toolFailureCount = 0;
  for (const t of eventTypes) {
    if (t === "tool.started" || t === "TOOL_CALL_STARTED") toolCallCount += 1;
    if (t === "tool.failed" || t === "TOOL_CALL_FAILED") toolFailureCount += 1;
  }
  return { toolCallCount, toolFailureCount };
}
