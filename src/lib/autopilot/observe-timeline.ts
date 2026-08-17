/**
 * Deterministic timeline categories. No LLM classification.
 * Human signals after a terminal event are legal.
 */

import type { AutopilotTraceEventType } from "./types";

export type ObserveEventCategory =
  | "Input"
  | "Context"
  | "Retrieval"
  | "Model"
  | "Tool"
  | "Output"
  | "Human"
  | "Terminal"
  | "System";

const TERMINAL_TYPES = new Set<string>([
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "job.completed",
  "job.failed",
]);

const CATEGORY_BY_TYPE: Record<AutopilotTraceEventType, ObserveEventCategory> = {
  USER_INPUT: "Input",
  INTENT_RESOLVED: "Input",
  CONTEXT_LOAD_STARTED: "Context",
  CONTEXT_LOADED: "Context",
  CONTEXT_LOAD_FAILED: "Context",
  RETRIEVAL_STARTED: "Retrieval",
  RETRIEVAL_COMPLETED: "Retrieval",
  RETRIEVAL_FAILED: "Retrieval",
  TOOL_CALL_STARTED: "Tool",
  TOOL_CALL_COMPLETED: "Tool",
  TOOL_CALL_YIELDED: "Tool",
  TOOL_CALL_FAILED: "Tool",
  MODEL_STARTED: "Model",
  MODEL_COMPLETED: "Model",
  MODEL_FAILED: "Model",
  AGENT_OUTPUT: "Output",
  HUMAN_EDIT: "Human",
  HUMAN_OVERRIDE: "Human",
  HUMAN_ACTION: "Human",
  HUMAN_ACTION_REQUESTED: "Human",
  RE_ASK_SIGNAL: "Human",
  TASK_COMPLETED: "Terminal",
  TASK_FAILED: "Terminal",
  TASK_CANCELLED: "Terminal",
  UNKNOWN_EVENT: "System",
};

export function observeEventCategory(
  eventType: string,
): ObserveEventCategory {
  return CATEGORY_BY_TYPE[eventType as AutopilotTraceEventType] ?? "System";
}

export function isTerminalObserveEvent(eventType: string): boolean {
  return TERMINAL_TYPES.has(eventType);
}

export type TerminalInvariant = {
  terminalCount: number;
  extraTerminal: boolean;
};

export function terminalInvariant(
  events: Array<{ eventType: string; sequence: number }>,
): TerminalInvariant {
  const terminals = events.filter((e) => isTerminalObserveEvent(e.eventType));
  return {
    terminalCount: terminals.length,
    extraTerminal: terminals.length > 1,
  };
}

export function postTerminalHumanSignalsAreLegal(): true {
  return true;
}

const BLOCKED_DISPLAY_KEYS = [
  "prompt",
  "completion",
  "messages",
  "args",
  "arguments",
  "result",
  "output",
  "email",
  "body",
  "tender",
  "quote",
  "contract",
  "chunk",
  "chunks",
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "apikey",
];

export function timelineSafeSummary(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const n = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (BLOCKED_DISPLAY_KEYS.some((part) => n.includes(part))) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}
