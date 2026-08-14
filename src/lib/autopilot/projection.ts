/**
 * AgentRun → Autopilot 观察 DTO（只读投影，不把 Runtime 当第二套事实源）。
 */

import { runtimeFromRunMetadata } from "@/lib/ai/runtime-context";
import { mapAgentRunEventToAutopilot } from "./map-events";
import { mapDeterministicFailureType, mapDeterministicOutcome } from "./outcome";
import { sanitizeAgentTrace, sanitizeAutopilotPayload, toContentRef } from "./sanitize";
import type {
  AutopilotContentRef,
  AutopilotFailureType,
  AutopilotOutcome,
  AutopilotReAskStatus,
  AutopilotTokenUsage,
  AutopilotTraceEventType,
} from "./types";

export type AgentRunSource = {
  id: string;
  orgId: string;
  sessionId: string;
  userMessageId?: string | null;
  runType: string;
  status: string;
  model?: string | null;
  intent?: string | null;
  traceId?: string | null;
  parentRunId?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: unknown;
  runtimeVersion?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
  session?: { userId?: string | null } | null;
};

export type AgentRunEventSource = {
  id: string;
  runId: string;
  sequence: number;
  eventType: string;
  title?: string | null;
  payload?: unknown;
  createdAt: Date | string;
};

export type PendingActionSource = {
  id: string;
  type: string;
  status: string;
  agentRunId?: string | null;
};

export type AutopilotOverlaySource = {
  outcome?: string | null;
  failureType?: string | null;
  humanOverride?: boolean;
  humanEdit?: boolean;
  reAskStatus?: string | null;
  tokenUsage?: unknown;
  estimatedCost?: unknown;
  agentType?: string | null;
  agentVersion?: string | null;
  projectId?: string | null;
  threadId?: string | null;
  userId?: string | null;
};

export type AutopilotTraceEventView = {
  id: string;
  runId: string;
  eventType: AutopilotTraceEventType;
  sequence: number;
  timestamp: string;
  durationMs: number | null;
  payload: Record<string, unknown> | null;
};

export type AutopilotRunListItem = {
  runId: string;
  time: string;
  userId: string | null;
  agent: string | null;
  projectId: string | null;
  outcome: AutopilotOutcome;
  latencyMs: number | null;
  toolCallCount: number;
  error: string | null;
  status: string;
  agentType: string | null;
};

export type AutopilotRunDetail = AutopilotRunListItem & {
  orgId: string;
  sessionId: string;
  threadId: string | null;
  traceId: string | null;
  agentVersion: string | null;
  intent: string | null;
  userGoalSummary: string | null;
  inputRef: AutopilotContentRef | null;
  outputRef: AutopilotContentRef | null;
  originalOutputRef: AutopilotContentRef | null;
  humanEditedOutputRef: AutopilotContentRef | null;
  humanOverride: boolean;
  humanEdit: boolean;
  reAskStatus: AutopilotReAskStatus;
  failureType: AutopilotFailureType | null;
  tokenUsage: AutopilotTokenUsage | null;
  estimatedCost: number | null;
  events: AutopilotTraceEventView[];
  pendingActions: Array<{ id: string; type: string; status: string }>;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function metaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function projectAutopilotRunListItem(input: {
  run: AgentRunSource;
  overlay?: AutopilotOverlaySource | null;
  toolCallCount?: number;
  humanOverride?: boolean;
}): AutopilotRunListItem {
  const runtime = runtimeFromRunMetadata(input.run);
  const humanOverride =
    input.humanOverride === true || input.overlay?.humanOverride === true;
  const outcome = mapDeterministicOutcome({
    status: input.run.status,
    errorCode: input.run.errorCode,
    humanOverride,
  });
  const failure = mapDeterministicFailureType(input.run.errorCode);
  const errorSummary =
    outcome === "FAILURE"
      ? failure?.failureType ?? input.run.errorCode ?? "UNKNOWN"
      : input.run.errorCode ?? null;

  return {
    runId: input.run.id,
    time: iso(input.run.startedAt) ?? iso(input.run.createdAt) ?? new Date(0).toISOString(),
    userId:
      input.overlay?.userId ??
      input.run.session?.userId ??
      runtime.actor?.userId ??
      null,
    agent: runtime.agent?.id ?? input.run.model ?? input.run.runType ?? null,
    projectId:
      input.overlay?.projectId ?? runtime.projectId ?? metaString(input.run.metadata, "projectId"),
    outcome,
    latencyMs: input.run.latencyMs ?? null,
    toolCallCount: input.toolCallCount ?? 0,
    error: errorSummary,
    status: input.run.status,
    agentType:
      input.overlay?.agentType ?? runtime.agent?.role ?? input.run.runType ?? null,
  };
}

export function projectAutopilotTraceEvents(
  runId: string,
  events: AgentRunEventSource[],
): AutopilotTraceEventView[] {
  const out: AutopilotTraceEventView[] = [];
  for (const event of events) {
    const mapped = mapAgentRunEventToAutopilot(event.eventType, event.payload);
    if (!mapped) continue;
    out.push({
      id: event.id,
      runId,
      eventType: mapped.eventType,
      sequence: event.sequence,
      timestamp: iso(event.createdAt) ?? new Date(0).toISOString(),
      durationMs: mapped.durationMs,
      payload: sanitizeAutopilotPayload(mapped.payload),
    });
  }
  return out;
}

export function projectAutopilotRunDetail(input: {
  run: AgentRunSource;
  events: AgentRunEventSource[];
  pendingActions?: PendingActionSource[];
  overlay?: AutopilotOverlaySource | null;
}): AutopilotRunDetail {
  const pending = input.pendingActions ?? [];
  const humanOverride =
    input.overlay?.humanOverride === true ||
    pending.some((a) => a.status === "rejected");
  const humanEdit =
    input.overlay?.humanEdit === true ||
    input.events.some((e) => e.eventType === "job.human_edited");
  const list = projectAutopilotRunListItem({
    run: input.run,
    overlay: input.overlay,
    toolCallCount: input.events.filter(
      (e) => e.eventType === "tool.started",
    ).length,
    humanOverride,
  });
  const runtime = runtimeFromRunMetadata(input.run);
  const failure = mapDeterministicFailureType(input.run.errorCode);

  return {
    ...list,
    orgId: input.run.orgId,
    sessionId: input.run.sessionId,
    threadId:
      input.overlay?.threadId ??
      runtime.threadId ??
      metaString(input.run.metadata, "threadId"),
    traceId: input.run.traceId ?? null,
    agentVersion:
      input.overlay?.agentVersion ?? input.run.runtimeVersion ?? null,
    intent: input.run.intent ?? null,
    userGoalSummary: null,
    inputRef: toContentRef(input.run.userMessageId, input.run.userMessageId ?? undefined),
    outputRef: null,
    originalOutputRef: null,
    humanEditedOutputRef: null,
    humanOverride,
    humanEdit,
    reAskStatus: (input.overlay?.reAskStatus as AutopilotReAskStatus) ?? "NOT_EVALUATED",
    failureType: failure?.failureType ?? null,
    tokenUsage: null,
    estimatedCost: null,
    events: projectAutopilotTraceEvents(input.run.id, input.events),
    pendingActions: pending.map((a) => ({
      id: a.id,
      type: a.type,
      status: a.status,
    })),
  };
}

export function sanitizedErrorSummary(errorMessage: string | null | undefined): string | null {
  if (!errorMessage) return null;
  const sanitized = sanitizeAgentTrace(errorMessage);
  return typeof sanitized === "string" ? sanitized : null;
}
