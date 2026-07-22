/**
 * Phase 3A-2：运行详情 = Trace Read Model + Usage
 */

import { db } from "@/lib/db";
import type { CapabilitiesAccessContext } from "../types";
import {
  CapabilitiesAccessError,
  isOrgAdminRole,
  resolveDetailAccessMode,
  visibilityForMode,
} from "../access";
import { getTraceBundle, getAgentRunProjection } from "../execution-query";
import { listLedgerForRun } from "../usage/query";

export async function getCapabilityRunDetail(
  access: CapabilitiesAccessContext,
  runId: string,
  opts?: { traceId?: string | null },
) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId: access.orgId },
    select: {
      id: true,
      orgId: true,
      traceId: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      metadata: true,
    },
  });
  if (!run) {
    throw new CapabilitiesAccessError("Run 不存在", "NOT_FOUND", 404);
  }
  if (opts?.traceId && run.traceId && opts.traceId !== run.traceId) {
    throw new CapabilitiesAccessError("Run 不存在", "NOT_FOUND", 404);
  }

  const [projection, bundle, usage] = await Promise.all([
    getAgentRunProjection(access, runId),
    getTraceBundle(access, runId),
    listLedgerForRun(access, { runId, traceId: opts?.traceId }),
  ]);

  const mode = resolveDetailAccessMode(access, projection.workspaceId);
  const visibility = visibilityForMode(mode);

  const totalCost = usage.reduce((s, u) => s + u.costAmount, 0);
  const totalTokens = usage.reduce(
    (s, u) => s + (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
    0,
  );

  const error =
    mode === "aggregate"
      ? projection.errorCode
        ? {
            category: "execution",
            summary: "有错误（明细已隐藏）",
            internalCode: null as string | null,
            retryable: null as boolean | null,
            recovered: null as boolean | null,
          }
        : null
      : projection.errorCode || projection.errorSummary
        ? {
            category: "execution",
            summary: projection.errorSummary ?? "执行失败",
            internalCode: projection.errorCode,
            retryable: false,
            recovered: projection.status === "SUCCEEDED",
          }
        : null;

  // AGGREGATE_ONLY：不返回完整时间线 payload
  const timeline =
    mode === "aggregate"
      ? bundle.items.map((i) => ({
          id: i.id,
          executionType: i.executionType,
          status: i.status,
          title: i.title,
          eventType: i.eventType,
          startedAt: i.startedAt,
          durationMs: i.durationMs,
          hasBusinessPayload: false,
          inputSummary: null,
          outputSummary: null,
        }))
      : mode === "metadata"
        ? bundle.items.map((i) => ({
            ...i,
            inputSummary: null,
            outputSummary: null,
            hasBusinessPayload: false,
            metadata: i.metadata
              ? { intent: (i.metadata as Record<string, unknown>).intent }
              : null,
          }))
        : bundle.items;

  const modelCalls =
    mode === "aggregate"
      ? usage.map((u) => ({
          id: u.id,
          provider: u.provider,
          model: null as string | null,
          inputTokens: null as number | null,
          outputTokens: null as number | null,
          durationMs: u.durationMs,
          costAmount: u.costAmount,
          status: u.status,
          pricingMode: u.pricingMode,
          retryCount: 0,
        }))
      : usage.map((u) => ({
          id: u.id,
          provider: u.provider,
          model: u.model,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          durationMs: u.durationMs,
          costAmount: u.costAmount,
          status: u.status,
          pricingMode: u.pricingMode,
          retryCount:
            typeof (u as { metadata?: { retryCount?: number } }).metadata
              ?.retryCount === "number"
              ? (u as { metadata?: { retryCount?: number } }).metadata!
                  .retryCount!
              : 0,
        }));

  return {
    orgId: access.orgId,
    visibility,
    accessMode: mode,
    isOrgAdmin: isOrgAdminRole(access.orgRole),
    basic: {
      runId: projection.runId,
      traceId: projection.traceId,
      status: projection.status,
      startedAt: projection.startedAt,
      finishedAt: projection.finishedAt,
      organizationId: projection.orgId,
      workspaceId: projection.workspaceId,
      projectId: projection.projectId,
      userId: projection.userId,
      entry: projection.capabilityKey,
      durationMs: projection.durationMs,
      totalCost,
      totalTokens,
      currency: "USD",
    },
    timeline,
    modelCalls,
    error,
    aggregate: bundle.aggregate,
  };
}
