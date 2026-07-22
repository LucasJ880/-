/**
 * PendingAction → APPROVAL 投影
 */

import type { PendingAction } from "@prisma/client";
import type { ExecutionProjection } from "../types";
import { mapPendingActionStatus } from "../execution-status";

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

export function projectPendingAction(
  row: PendingAction,
): ExecutionProjection | null {
  // orgId 为空的历史脏数据：不猜测归属，不进入企业中台
  if (!row.orgId) return null;

  const payload = asRecord(row.payload);
  const traceId =
    typeof payload?.traceId === "string" ? payload.traceId : null;

  return {
    id: row.id,
    executionType: "APPROVAL",
    status: mapPendingActionStatus(row.status),
    capabilityKey: row.type,
    orgId: row.orgId,
    workspaceId:
      typeof payload?.workspaceId === "string" ? payload.workspaceId : null,
    projectId: row.projectId,
    userId: row.createdById,
    traceId,
    runId: row.agentRunId,
    parentRunId: row.agentRunId,
    startedAt: row.createdAt,
    finishedAt: row.decidedAt ?? row.executedAt ?? null,
    durationMs: null,
    modelProvider: null,
    modelName: null,
    tokenInput: null,
    tokenOutput: null,
    costAmount: null,
    currency: null,
    riskLevel:
      typeof payload?.riskLevel === "string" ? payload.riskLevel : null,
    approvalRequired: true,
    errorCode: row.status === "failed" ? "APPROVAL_EXEC_FAILED" : null,
    errorSummary: truncate(row.failureReason),
    hasBusinessPayload: true,
    inputSummary: truncate(row.preview || row.title),
    outputSummary: null,
    sourceType: "PendingAction",
    sourceId: row.id,
    metadata: {
      status: row.status,
      type: row.type,
      // 不回传完整 payload
    },
  };
}
