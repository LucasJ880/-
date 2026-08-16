/**
 * 将现有 AgentRunEvent 映射为 Autopilot canonical trace events。
 * 不复制完整 payload；调用方负责 sanitize。
 */

import type { AutopilotTraceEventType } from "./types";

export const AUTOPILOT_MAPPING_SCHEMA_VERSION = 1;

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

function pick(
  p: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schemaVersion: AUTOPILOT_MAPPING_SCHEMA_VERSION,
  };
  for (const key of keys) {
    if (p[key] !== undefined) out[key] = p[key];
  }
  return out;
}

/** A1-P1 catalog sources that map to Autopilot canonical events. */
const MAPPED_SOURCE_EVENTS = new Set([
  "run.started",
  "context.loading",
  "context.loaded",
  "context.failed",
  "planning.completed",
  "plan.created",
  "retrieval.started",
  "retrieval.completed",
  "retrieval.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "model.started",
  "model.completed",
  "model.failed",
  "response.started",
  "response.completed",
  "response.failed",
  "grader.started",
  "grader.completed",
  "agent.output",
  "job.human_edited",
  "human.edit",
  "human.override",
  "human.reask",
  "approval.rejected",
  "approval.executed",
  "approval.required",
  "job.human_action_completed",
  "run.needs_human",
  "job.waiting_human",
  "run.completed",
  "job.completed",
  "run.failed",
  "job.failed",
  "run.cancelled",
]);

/** Known runtime-internal events: not A1-P1 catalog, not unknown. */
const INTERNAL_SOURCE_EVENTS = new Set([
  "ack.sent",
  "planning.started",
  "plan.started",
  "response.delta",
  "run.reconciled",
  "run.retry_requested",
  "run.retry_started",
  "background.queued",
  "background.started",
  "background.completed",
  "skill.started",
  "skill.completed",
  "step.ready",
  "step.started",
  "step.completed",
  "approval.resolved",
  "approval.failed",
  "approval.expired",
  "verification.started",
  "verification.passed",
  "verification.repair_required",
  "verification.needs_human",
  "repair.started",
  "repair.completed",
  "job.created",
  "job.queued",
  "job.claimed",
  "job.lease_renewed",
  "job.resumed",
  "job.resume_blocked",
  "job.clarification_answered",
  "task.claimed",
  "parallel.batch_started",
  "parallel.batch_completed",
]);

export function classifyAgentRunEvent(
  eventType: string,
): "mapped" | "internal" | "unknown" {
  if (MAPPED_SOURCE_EVENTS.has(eventType)) return "mapped";
  if (INTERNAL_SOURCE_EVENTS.has(eventType)) return "internal";
  return "unknown";
}

export function mapAgentRunEventToAutopilot(
  eventType: string,
  payload?: unknown,
): MappedAutopilotEvent | null {
  const p = asRecord(payload);
  const durationMs = durationFrom(p);

  switch (eventType) {
    case "run.started":
      return {
        eventType: "USER_INPUT",
        durationMs,
        payload: pick(p, ["userMessageId", "inputRef"]),
      };
    case "context.loading":
      return {
        eventType: "CONTEXT_LOAD_STARTED",
        durationMs,
        payload: pick(p, ["contextTypes"]),
      };
    case "context.loaded":
      return {
        eventType: "CONTEXT_LOADED",
        durationMs,
        payload: pick(p, ["types", "contextTypes", "sourceCount", "projectId", "customerId"]),
      };
    case "context.failed":
      return {
        eventType: "CONTEXT_LOAD_FAILED",
        durationMs,
        payload: pick(p, ["errorCode"]),
      };
    case "planning.completed":
    case "plan.created":
      return {
        eventType: "INTENT_RESOLVED",
        durationMs,
        payload: pick(p, [
          "intent",
          "selectedAgent",
          "selectedCapability",
          "route",
          "source",
          "confidence",
        ]),
      };
    case "retrieval.started":
      return {
        eventType: "RETRIEVAL_STARTED",
        durationMs,
        payload: pick(p, ["retrievalId", "retrievalType", "queryHash"]),
      };
    case "retrieval.completed":
      return {
        eventType: "RETRIEVAL_COMPLETED",
        durationMs,
        payload: pick(p, [
          "retrievalId",
          "retrievalType",
          "queryHash",
          "resultCount",
          "sourceRefs",
          "topScore",
        ]),
      };
    case "retrieval.failed":
      return {
        eventType: "RETRIEVAL_FAILED",
        durationMs,
        payload: pick(p, ["retrievalId", "retrievalType", "errorCode"]),
      };
    case "tool.started":
      return {
        eventType: "TOOL_CALL_STARTED",
        durationMs,
        payload: pick(p, ["name", "toolCallId", "round"]),
      };
    case "tool.failed":
      return {
        eventType: "TOOL_CALL_FAILED",
        durationMs,
        payload: pick(p, ["name", "toolCallId", "errorCode"]),
      };
    case "tool.completed": {
      const failed = p.ok === false;
      return {
        eventType: failed ? "TOOL_CALL_FAILED" : "TOOL_CALL_COMPLETED",
        durationMs,
        payload: pick(p, ["name", "toolCallId", "ok", "resultType"]),
      };
    }
    case "model.started":
    case "response.started":
    case "grader.started":
      return {
        eventType: "MODEL_STARTED",
        durationMs,
        payload: pick(p, ["modelCallId", "provider", "model"]),
      };
    case "model.completed":
    case "response.completed":
    case "grader.completed":
      return {
        eventType: "MODEL_COMPLETED",
        durationMs,
        payload: pick(p, [
          "modelCallId",
          "provider",
          "model",
          "tokenUsage",
          "finishReason",
          "toolCalls",
        ]),
      };
    case "model.failed":
    case "response.failed":
      return {
        eventType: "MODEL_FAILED",
        durationMs,
        payload: pick(p, ["modelCallId", "provider", "model", "errorCode"]),
      };
    case "agent.output":
      return {
        eventType: "AGENT_OUTPUT",
        durationMs,
        payload: pick(p, ["outputRef", "hash", "bytes", "outputType"]),
      };
    case "job.human_edited":
    case "human.edit":
      return {
        eventType: "HUMAN_EDIT",
        durationMs,
        payload: pick(p, [
          "source",
          "signalKey",
          "sourceAgentRunId",
          "sourceOutputRef",
          "artifactType",
          "artifactRef",
          "commitAction",
          "beforeHash",
          "afterHash",
          "beforeChars",
          "afterChars",
          "changed",
          "changeMagnitude",
        ]),
      };
    case "approval.rejected":
    case "human.override":
      return {
        eventType: "HUMAN_OVERRIDE",
        durationMs,
        payload: pick(p, [
          "source",
          "signalKey",
          "sourceAgentRunId",
          "sourceDecisionRef",
          "pendingActionId",
          "actionId",
          "actionType",
          "overrideType",
          "replacementRef",
          "outcome",
          "eventKey",
        ]),
      };
    case "human.reask":
      return {
        eventType: "RE_ASK_SIGNAL",
        durationMs,
        payload: pick(p, [
          "signalKey",
          "originalAgentRunId",
          "newAgentRunId",
          "originalOutputRef",
          "originalMessageId",
          "retryActionId",
        ]),
      };
    case "approval.executed":
    case "job.human_action_completed":
      return {
        eventType: "HUMAN_ACTION",
        durationMs,
        payload: { source: eventType, schemaVersion: AUTOPILOT_MAPPING_SCHEMA_VERSION },
      };
    case "approval.required":
    case "run.needs_human":
    case "job.waiting_human":
      return {
        eventType: "HUMAN_ACTION_REQUESTED",
        durationMs,
        payload: { source: eventType, schemaVersion: AUTOPILOT_MAPPING_SCHEMA_VERSION },
      };
    case "run.completed":
    case "job.completed":
      return {
        eventType: "TASK_COMPLETED",
        durationMs,
        payload: pick(p, ["latencyMs"]),
      };
    case "run.failed":
    case "job.failed":
      return {
        eventType: "TASK_FAILED",
        durationMs,
        payload: pick(p, ["code"]),
      };
    case "run.cancelled":
      return {
        eventType: "TASK_CANCELLED",
        durationMs,
        payload: pick(p, ["rejectedPending"]),
      };
    default:
      if (INTERNAL_SOURCE_EVENTS.has(eventType)) return null;
      return {
        eventType: "UNKNOWN_EVENT",
        durationMs,
        payload: { source: eventType, schemaVersion: AUTOPILOT_MAPPING_SCHEMA_VERSION },
      };
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
