/**
 * ToolCallTrace adapter — 无直接 orgId，必须经 Project.orgId 可信 JOIN
 */

import type { ExecutionProjection } from "../types";
import { mapToolTraceStatus } from "../execution-status";

export type ToolCallTraceJoinRow = {
  id: string;
  projectId: string;
  toolKey: string;
  toolName: string;
  inputJson: string | null;
  outputJson: string | null;
  status: string;
  errorMessage: string | null;
  durationMs: number;
  createdAt: Date;
  project: {
    id: string;
    orgId: string | null;
    workspaceId: string | null;
  };
};

function truncate(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function projectToolCallTrace(
  row: ToolCallTraceJoinRow,
): ExecutionProjection | null {
  // 无 org 归属的 Project 不得进入企业中台（禁止猜测）
  if (!row.project.orgId) return null;

  return {
    id: row.id,
    executionType: "TOOL",
    status: mapToolTraceStatus(row.status),
    capabilityKey: row.toolKey || row.toolName,
    orgId: row.project.orgId,
    workspaceId: row.project.workspaceId,
    projectId: row.projectId,
    userId: null,
    traceId: null,
    runId: null,
    parentRunId: null,
    startedAt: row.createdAt,
    finishedAt: row.createdAt,
    durationMs: row.durationMs,
    modelProvider: null,
    modelName: null,
    tokenInput: null,
    tokenOutput: null,
    costAmount: null,
    currency: null,
    riskLevel: null,
    approvalRequired: null,
    errorCode: row.errorMessage ? "TOOL_ERROR" : null,
    errorSummary: truncate(row.errorMessage),
    hasBusinessPayload: true,
    inputSummary: truncate(row.inputJson),
    outputSummary: truncate(row.outputJson),
    sourceType: "ToolCallTrace",
    sourceId: row.id,
    metadata: { toolName: row.toolName },
  };
}

export const TOOL_CALL_TRACE_ORG_DEBT = {
  model: "ToolCallTrace",
  issue: "missing_direct_orgId",
  mitigation: "JOIN Project.orgId (+ workspaceId) + TenantContext.orgId equality",
  followUp:
    "Add nullable ToolCallTrace.orgId/workspaceId + backfill from Project (Phase 3A-2+)",
} as const;
