/**
 * AgentRun / AgentRunEvent / SupervisorState → ExecutionProjection
 */

import type { AgentRun, AgentRunEvent } from "@prisma/client";
import type { ExecutionProjection, TraceTimelineItem } from "../types";
import {
  mapAgentRunStatus,
  mapSupervisorStatus,
} from "../execution-status";
import {
  readParentRunIdFromUnknown,
  readTraceIdFromUnknown,
} from "../trace-context";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function truncate(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function projectAgentRun(run: AgentRun & {
  session?: { userId: string | null; currentProjectId: string | null } | null;
}): ExecutionProjection {
  const meta = asRecord(run.metadata);
  const traceId = readTraceIdFromUnknown(
    run.metadata,
    // schema 列在 migration 后可用；用 any 兼容生成前客户端
    (run as { traceId?: string | null }).traceId,
  );
  const parentRunId =
    readParentRunIdFromUnknown(run.metadata) ??
    ((run as { parentRunId?: string | null }).parentRunId ?? null);

  return {
    id: run.id,
    executionType: "AGENT",
    status: mapAgentRunStatus(run.status),
    capabilityKey: run.runType ?? "agent_run",
    orgId: run.orgId,
    workspaceId:
      typeof meta?.workspaceId === "string" ? meta.workspaceId : null,
    projectId:
      typeof meta?.projectId === "string"
        ? meta.projectId
        : run.session?.currentProjectId ?? null,
    userId: run.session?.userId ?? null,
    traceId,
    runId: run.id,
    parentRunId,
    startedAt: run.startedAt ?? run.createdAt,
    finishedAt: run.completedAt ?? run.cancelledAt,
    durationMs: run.latencyMs,
    modelProvider: run.model ? "openai" : null,
    modelName: run.model,
    tokenInput: null,
    tokenOutput: null,
    costAmount: null,
    currency: null,
    riskLevel: typeof meta?.riskLevel === "string" ? meta.riskLevel : null,
    approvalRequired:
      typeof meta?.approvalRequired === "boolean"
        ? meta.approvalRequired
        : null,
    errorCode: run.errorCode,
    errorSummary: truncate(run.errorMessage),
    hasBusinessPayload: true,
    inputSummary: truncate(
      typeof meta?.inputSummary === "string" ? meta.inputSummary : null,
    ),
    outputSummary: truncate(
      typeof meta?.outputSummary === "string" ? meta.outputSummary : null,
    ),
    sourceType: "AgentRun",
    sourceId: run.id,
    metadata: meta,
  };
}

export function projectAgentRunEvent(
  event: AgentRunEvent,
  parent: ExecutionProjection,
): TraceTimelineItem {
  const payload = asRecord(event.payload);
  return {
    ...parent,
    id: event.id,
    executionType: event.eventType.startsWith("tool")
      ? "TOOL"
      : event.eventType.startsWith("skill")
        ? "SKILL"
        : event.eventType.includes("approval")
          ? "APPROVAL"
          : "AGENT",
    capabilityKey: event.eventType,
    sourceType: "AgentRunEvent",
    sourceId: event.id,
    startedAt: event.createdAt,
    finishedAt: event.createdAt,
    inputSummary: truncate(
      typeof payload?.summary === "string"
        ? payload.summary
        : event.title,
    ),
    outputSummary: null,
    hasBusinessPayload: Boolean(payload),
    metadata: payload,
    sequence: event.sequence,
    title: event.title,
    eventType: event.eventType,
  };
}

export function projectSupervisorState(
  run: AgentRun,
  parent: ExecutionProjection,
): TraceTimelineItem | null {
  const state = asRecord(run.supervisorState);
  if (!state) return null;
  const statusRaw =
    typeof state.status === "string" ? state.status : "running";
  return {
    ...parent,
    id: `${run.id}:supervisor`,
    executionType: "SUPERVISOR",
    status: mapSupervisorStatus(statusRaw),
    capabilityKey: "supervisor",
    sourceType: "AgentRun.supervisorState",
    sourceId: run.id,
    hasBusinessPayload: true,
    inputSummary: truncate(
      typeof state.goal === "string" ? state.goal : "Supervisor",
    ),
    outputSummary: truncate(
      typeof state.summary === "string" ? state.summary : null,
    ),
    metadata: { status: statusRaw },
    sequence: null,
    title: "Supervisor",
    eventType: "supervisor.state",
  };
}
