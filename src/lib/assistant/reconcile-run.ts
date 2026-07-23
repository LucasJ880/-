/**
 * Phase 3B-A Commit 6：PendingAction → AgentRun 收敛（DB）
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import type { AgentRunEventType } from "@/lib/agent-runtime/types";
import { toAssistantRunStatusDto } from "@/lib/assistant/run-status";
import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";
import {
  decideRunReconcile,
  deriveRetryFlags,
  type ReconcileDecision,
} from "@/lib/assistant/reconcile-decision";

export * from "@/lib/assistant/reconcile-decision";

function readInitiatedByUserId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).initiatedByUserId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readThreadId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).threadId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export type ReconcileResult = {
  changed: boolean;
  decision: ReconcileDecision;
  run: AssistantRunStatusDto | null;
};

/**
 * 锁定 Run → 读全部 PA → 确定性收敛 → 写事件（幂等）
 */
export async function reconcileAssistantRunFromPendingActions(input: {
  orgId: string;
  runId: string;
  triggeredByUserId?: string;
  reason?: string;
  triggerAction?: {
    id: string;
    type: string;
    outcome: "executed" | "rejected" | "failed" | "expired";
  };
}): Promise<ReconcileResult> {
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "AgentRun"
      WHERE id = ${input.runId} AND "orgId" = ${input.orgId}
      FOR UPDATE
    `;

    const run = await tx.agentRun.findFirst({
      where: { id: input.runId, orgId: input.orgId },
    });
    if (!run) {
      return {
        changed: false,
        decision: decideRunReconcile([]),
        runRow: null as null,
        actions: [] as Array<{
          id: string;
          status: string;
          expiresAt: Date | null;
          type: string;
        }>,
      };
    }

    const actionsForDecide = await tx.pendingAction.findMany({
      where: { agentRunId: input.runId },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        type: true,
        orgId: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const safeActions = actionsForDecide.filter(
      (a) => !a.orgId || a.orgId === input.orgId,
    );

    const meta = (run.metadata ?? {}) as Record<string, unknown>;
    const decision = decideRunReconcile(safeActions, now, {
      safeToRetryHint: meta.safeToRetry === true,
    });

    if (decision.kind === "noop_no_actions") {
      return { changed: false, decision, runRow: run, actions: safeActions };
    }

    const prevKey =
      typeof meta.lastReconcileEventKey === "string"
        ? meta.lastReconcileEventKey
        : null;
    const alreadySame =
      prevKey === decision.eventKey && run.status === decision.dbStatus;

    const nextMeta = {
      ...meta,
      ...decision.metadataPatch,
      lastReconcileEventKey: decision.eventKey,
      lastReconcileAt: now.toISOString(),
      lastReconcileReason: input.reason ?? null,
    };

    if (!alreadySame) {
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: decision.dbStatus,
          metadata: nextMeta as Prisma.InputJsonValue,
          ...(decision.kind === "awaiting"
            ? { completedAt: null }
            : {
                completedAt: run.completedAt ?? now,
                ...(decision.kind === "failed"
                  ? {
                      errorCode: "tool_failed",
                      errorMessage: String(
                        decision.metadataPatch.scenarioErrorCode ??
                          decision.resultSummary,
                      ).slice(0, 2000),
                    }
                  : {}),
                ...(decision.kind === "cancelled"
                  ? { cancelledAt: run.cancelledAt ?? now }
                  : {}),
              }),
        },
      });
    } else {
      await tx.agentRun.update({
        where: { id: run.id },
        data: { metadata: nextMeta as Prisma.InputJsonValue },
      });
    }

    const updated = await tx.agentRun.findFirstOrThrow({
      where: { id: run.id },
    });

    return {
      changed: !alreadySame,
      decision,
      runRow: updated,
      actions: safeActions,
    };
  });

  if (!result.runRow) {
    return { changed: false, decision: result.decision, run: null };
  }

  const meta = (result.runRow.metadata ?? {}) as Record<string, unknown>;
  const writtenKey =
    typeof meta.lastReconcileEventWritten === "string"
      ? meta.lastReconcileEventWritten
      : null;

  if (input.triggerAction) {
    const map: Record<string, AgentRunEventType> = {
      executed: "approval.executed",
      rejected: "approval.rejected",
      failed: "approval.failed",
      expired: "approval.expired",
    };
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: map[input.triggerAction.outcome],
      title: `approval.${input.triggerAction.outcome}`,
      visibleToUser: true,
      payload: {
        actionId: input.triggerAction.id,
        actionType: input.triggerAction.type,
        outcome: input.triggerAction.outcome,
        counts: result.decision.counts,
      },
    });
  }

  if (
    result.changed &&
    result.decision.terminalEventType &&
    writtenKey !== result.decision.eventKey
  ) {
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "run.reconciled",
      title: "run.reconciled",
      visibleToUser: true,
      payload: {
        resultSummary: result.decision.resultSummary,
        counts: result.decision.counts,
        partialCompletion: result.decision.partialCompletion,
        partialSideEffects: result.decision.partialSideEffects,
        reason: input.reason ?? null,
      },
    });
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: result.decision.terminalEventType,
      title:
        result.decision.terminalEventTitle ?? result.decision.terminalEventType,
      visibleToUser: true,
      payload: {
        resultSummary: result.decision.resultSummary,
        counts: result.decision.counts,
      },
    });
    await db.agentRun.update({
      where: { id: input.runId },
      data: {
        metadata: {
          ...meta,
          lastReconcileEventWritten: result.decision.eventKey,
        } as Prisma.InputJsonValue,
      },
    });
  }

  const refreshed = await db.agentRun.findFirstOrThrow({
    where: { id: input.runId },
  });
  const threadId = readThreadId(refreshed.metadata) ?? "";
  const initiated =
    readInitiatedByUserId(refreshed.metadata) ??
    input.triggeredByUserId ??
    "";

  const retry = deriveRetryFlags({
    runStatus: refreshed.status,
    metadata: refreshed.metadata,
    actions: result.actions,
    now,
  });

  const dto = toAssistantRunStatusDto({
    run: refreshed,
    threadId,
    initiatedByUserId: initiated || "unknown",
    pendingActionIds: result.actions.map((a) => a.id),
    pendingActionStatus:
      result.decision.counts.pending + result.decision.counts.approved > 0
        ? "pending"
        : result.decision.counts.rejected === result.decision.counts.total &&
            result.decision.counts.total > 0
          ? "rejected"
          : result.decision.counts.failed + result.decision.counts.expired > 0
            ? "failed"
            : null,
    resultSummary:
      result.decision.userFacingSummary || result.decision.resultSummary,
    statusOverride:
      result.decision.kind === "noop_no_actions"
        ? undefined
        : result.decision.assistantStatus,
    actionSummary: result.decision.counts,
    partialCompletion: result.decision.partialCompletion,
    partialSideEffects: result.decision.partialSideEffects,
    canRetry: retry.canRetry,
    retryKind: retry.retryKind,
  });

  return {
    changed: result.changed,
    decision: result.decision,
    run: dto,
  };
}
