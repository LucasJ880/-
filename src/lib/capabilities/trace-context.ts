/**
 * Trace 关联标识：生成与传播约定（不改 Runtime 主执行语义）
 *
 * 新执行应携带：traceId / runId / parentRunId / orgId / workspaceId? / projectId?
 * 历史数据允许 traceId 为空。
 */

import { randomUUID } from "crypto";

export type TraceContext = {
  traceId: string;
  runId: string | null;
  parentRunId: string | null;
  orgId: string;
  workspaceId: string | null;
  projectId: string | null;
};

export function createTraceId(): string {
  return `tr_${randomUUID().replace(/-/g, "")}`;
}

export function createTraceContext(input: {
  orgId: string;
  runId?: string | null;
  parentRunId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  traceId?: string | null;
}): TraceContext {
  if (!input.orgId) {
    throw new Error("TraceContext.orgId 必填");
  }
  return {
    traceId: input.traceId?.trim() || createTraceId(),
    runId: input.runId ?? null,
    parentRunId: input.parentRunId ?? null,
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId ?? null,
  };
}

/** 写入 AgentRun.metadata（及未来列）的规范片段 */
export function traceContextToMetadata(
  ctx: TraceContext,
): Record<string, unknown> {
  return {
    traceId: ctx.traceId,
    runId: ctx.runId,
    parentRunId: ctx.parentRunId,
    orgId: ctx.orgId,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
  };
}

export function readTraceIdFromUnknown(
  metadata: unknown,
  columnTraceId?: string | null,
): string | null {
  if (columnTraceId?.trim()) return columnTraceId.trim();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const t = (metadata as Record<string, unknown>).traceId;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

export function readParentRunIdFromUnknown(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const t = (metadata as Record<string, unknown>).parentRunId;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * 合并调用链上下文：子调用继承父 traceId/orgId，可覆盖 runId/parentRunId。
 */
export function propagateTraceContext(
  parent: TraceContext,
  patch?: Partial<Pick<TraceContext, "runId" | "parentRunId" | "workspaceId" | "projectId">>,
): TraceContext {
  return {
    traceId: parent.traceId,
    orgId: parent.orgId,
    runId: patch?.runId !== undefined ? patch.runId : parent.runId,
    parentRunId:
      patch?.parentRunId !== undefined ? patch.parentRunId : parent.parentRunId,
    workspaceId:
      patch?.workspaceId !== undefined ? patch.workspaceId : parent.workspaceId,
    projectId:
      patch?.projectId !== undefined ? patch.projectId : parent.projectId,
  };
}
