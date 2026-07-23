/**
 * Phase 3B-A Commit 6A：PendingAction → AgentRun 收敛（锁内幂等事件）
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { AgentRunEventType } from "@/lib/agent-runtime/types";
import { toAssistantRunStatusDto } from "@/lib/assistant/run-status";
import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";
import {
  decideRunReconcile,
  deriveRetryFlags,
  type ReconcileDecision,
} from "@/lib/assistant/reconcile-decision";
import { logAudit } from "@/lib/audit/logger";

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

export function readWrittenEventKeys(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const v = (metadata as Record<string, unknown>).writtenEventKeys;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export function actionEventKey(
  actionId: string,
  outcome: string,
): string {
  return `approval-action:${actionId}:${outcome}`;
}

/** 纯函数：决定本轮要写入的事件键（供单测） */
export function planReconcileEventKeys(input: {
  writtenKeys: string[];
  decision: ReconcileDecision;
  triggerAction?: { id: string; outcome: string } | null;
}): {
  actionKey: string | null;
  writeAction: boolean;
  writeTerminal: boolean;
  nextKeys: string[];
} {
  const set = new Set(input.writtenKeys);
  let actionKey: string | null = null;
  let writeAction = false;
  if (input.triggerAction) {
    actionKey = actionEventKey(
      input.triggerAction.id,
      input.triggerAction.outcome,
    );
    if (!set.has(actionKey)) {
      writeAction = true;
      set.add(actionKey);
    }
  }
  const writeTerminal =
    !!input.decision.terminalEventType &&
    !set.has(input.decision.eventKey);
  if (writeTerminal) {
    set.add(input.decision.eventKey);
  }
  return {
    actionKey,
    writeAction,
    writeTerminal,
    nextKeys: [...set],
  };
}

export type ReconcileResult = {
  changed: boolean;
  decision: ReconcileDecision;
  run: AssistantRunStatusDto | null;
  errorCode?: string;
};

async function nextEventSequence(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<number> {
  const last = await tx.agentRunEvent.findFirst({
    where: { runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? 0) + 1;
}

async function createRunEventInTx(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    runId: string;
    eventType: AgentRunEventType;
    title: string;
    payload?: Record<string, unknown>;
  },
) {
  const sequence = await nextEventSequence(tx, input.runId);
  return tx.agentRunEvent.create({
    data: {
      orgId: input.orgId,
      runId: input.runId,
      sequence,
      eventType: input.eventType,
      title: input.title,
      payload: (input.payload ?? null) as Prisma.InputJsonValue,
      visibleToUser: true,
    },
  });
}

/**
 * 锁定 Run → 读全部 PA → 确定性收敛 → 锁内写事件（幂等）
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
      include: { session: { select: { userId: true } } },
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
          orgId: string | null;
        }>,
        orgLinkMismatch: false,
        initiatedByUserId: null as string | null,
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

    // 跨 org 关联：fail closed（null orgId 历史兼容保留）
    const foreign = actionsForDecide.filter(
      (a) => a.orgId != null && a.orgId !== input.orgId,
    );
    if (foreign.length > 0) {
      const meta = (run.metadata ?? {}) as Record<string, unknown>;
      const failMeta = {
        ...meta,
        scenarioErrorCode: "ORG_LINK_MISMATCH",
        resultSummary: "org_link_mismatch",
        safeToRetry: false,
        lastReconcileAt: now.toISOString(),
      };
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          completedAt: run.completedAt ?? now,
          errorCode: "tool_failed",
          errorMessage: "ORG_LINK_MISMATCH",
          metadata: failMeta as Prisma.InputJsonValue,
        },
      });
      const written = new Set(readWrittenEventKeys(failMeta));
      const mismatchKey = "terminal:org_link_mismatch";
      if (!written.has(mismatchKey)) {
        await createRunEventInTx(tx, {
          orgId: input.orgId,
          runId: run.id,
          eventType: "run.failed",
          title: "ORG_LINK_MISMATCH",
          payload: {
            foreignActionCount: foreign.length,
            // 不记录敏感明细
          },
        });
        written.add(mismatchKey);
        await tx.agentRun.update({
          where: { id: run.id },
          data: {
            metadata: {
              ...failMeta,
              writtenEventKeys: [...written],
              lastReconcileEventWritten: mismatchKey,
            } as Prisma.InputJsonValue,
          },
        });
      }
      const updated = await tx.agentRun.findFirstOrThrow({
        where: { id: run.id },
        include: { session: { select: { userId: true } } },
      });
      return {
        changed: true,
        decision: {
          ...decideRunReconcile([]),
          kind: "failed" as const,
          dbStatus: "failed" as const,
          assistantStatus: "failed" as const,
          resultSummary: "org_link_mismatch",
          userFacingSummary: "任务关联异常，已安全中止。",
          eventKey: mismatchKey,
          canRetry: false,
          retryKind: "manual_review" as const,
          metadataPatch: { scenarioErrorCode: "ORG_LINK_MISMATCH" },
          terminalEventType: "run.failed" as const,
          terminalEventTitle: "ORG_LINK_MISMATCH",
          counts: {
            total: actionsForDecide.length,
            pending: 0,
            approved: 0,
            executed: 0,
            rejected: 0,
            failed: 0,
            expired: 0,
          },
          partialCompletion: false,
          partialSideEffects: false,
        },
        runRow: updated,
        actions: actionsForDecide.filter(
          (a) => !a.orgId || a.orgId === input.orgId,
        ),
        orgLinkMismatch: true,
        initiatedByUserId:
          readInitiatedByUserId(updated.metadata) ||
          updated.session?.userId ||
          input.triggeredByUserId ||
          null,
      };
    }

    const safeActions = actionsForDecide.filter(
      (a) => !a.orgId || a.orgId === input.orgId,
    );

    const meta = (run.metadata ?? {}) as Record<string, unknown>;
    const decision = decideRunReconcile(safeActions, now, {
      safeToRetryHint: meta.safeToRetry === true,
    });

    const initiatedByUserId =
      readInitiatedByUserId(meta) ||
      run.session?.userId ||
      input.triggeredByUserId ||
      null;

    if (decision.kind === "noop_no_actions") {
      return {
        changed: false,
        decision,
        runRow: run,
        actions: safeActions,
        orgLinkMismatch: false,
        initiatedByUserId,
      };
    }

    const prevKey =
      typeof meta.lastReconcileEventKey === "string"
        ? meta.lastReconcileEventKey
        : null;
    const alreadySame =
      prevKey === decision.eventKey && run.status === decision.dbStatus;

    const plan = planReconcileEventKeys({
      writtenKeys: readWrittenEventKeys(meta),
      decision,
      triggerAction: input.triggerAction
        ? {
            id: input.triggerAction.id,
            outcome: input.triggerAction.outcome,
          }
        : null,
    });

    // 已收敛且无新事件：不重写 metadata，避免并发覆盖较新字段
    if (alreadySame && !plan.writeAction && !plan.writeTerminal) {
      return {
        changed: false,
        decision,
        runRow: run,
        actions: safeActions,
        orgLinkMismatch: false,
        initiatedByUserId,
      };
    }

    let nextMeta: Record<string, unknown> = {
      ...meta,
      ...decision.metadataPatch,
      lastReconcileEventKey: decision.eventKey,
      lastReconcileAt: now.toISOString(),
      lastReconcileReason: input.reason ?? null,
      writtenEventKeys: plan.nextKeys,
    };
    if (plan.writeTerminal) {
      nextMeta.lastReconcileEventWritten = decision.eventKey;
    }

    const statusChanged = !alreadySame;
    await tx.agentRun.update({
      where: { id: run.id },
      data: {
        ...(statusChanged ? { status: decision.dbStatus } : {}),
        metadata: nextMeta as Prisma.InputJsonValue,
        ...(statusChanged
          ? decision.kind === "awaiting"
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
              }
          : {}),
      },
    });

    if (plan.writeAction && input.triggerAction && plan.actionKey) {
      const map: Record<string, AgentRunEventType> = {
        executed: "approval.executed",
        rejected: "approval.rejected",
        failed: "approval.failed",
        expired: "approval.expired",
      };
      await createRunEventInTx(tx, {
        orgId: input.orgId,
        runId: run.id,
        eventType: map[input.triggerAction.outcome],
        title: `approval.${input.triggerAction.outcome}`,
        payload: {
          actionId: input.triggerAction.id,
          actionType: input.triggerAction.type,
          outcome: input.triggerAction.outcome,
          counts: decision.counts,
          eventKey: plan.actionKey,
        },
      });
    }

    if (plan.writeTerminal && decision.terminalEventType) {
      await createRunEventInTx(tx, {
        orgId: input.orgId,
        runId: run.id,
        eventType: "run.reconciled",
        title: "run.reconciled",
        payload: {
          resultSummary: decision.resultSummary,
          counts: decision.counts,
          partialCompletion: decision.partialCompletion,
          partialSideEffects: decision.partialSideEffects,
          reason: input.reason ?? null,
          eventKey: decision.eventKey,
        },
      });
      await createRunEventInTx(tx, {
        orgId: input.orgId,
        runId: run.id,
        eventType: decision.terminalEventType,
        title: decision.terminalEventTitle ?? decision.terminalEventType,
        payload: {
          resultSummary: decision.resultSummary,
          counts: decision.counts,
          eventKey: decision.eventKey,
        },
      });
    }

    const updated = await tx.agentRun.findFirstOrThrow({
      where: { id: run.id },
      include: { session: { select: { userId: true } } },
    });

    return {
      changed: statusChanged || plan.writeAction || plan.writeTerminal,
      decision,
      runRow: updated,
      actions: safeActions,
      orgLinkMismatch: false,
      initiatedByUserId:
        readInitiatedByUserId(updated.metadata) ||
        updated.session?.userId ||
        input.triggeredByUserId ||
        null,
    };
  });

  if (result.orgLinkMismatch) {
    await logAudit({
      userId: input.triggeredByUserId || "system",
      orgId: input.orgId,
      action: "ASSISTANT_RUN_ORG_LINK_MISMATCH",
      targetType: "agent_run",
      targetId: input.runId,
      afterData: { code: "ORG_LINK_MISMATCH" },
    }).catch(() => {});
  }

  if (!result.runRow) {
    return { changed: false, decision: result.decision, run: null };
  }

  if (!result.initiatedByUserId) {
    // 无法确认发起人：不返回伪造 DTO
    return {
      changed: result.changed,
      decision: result.decision,
      run: null,
      errorCode: "INITIATOR_UNKNOWN",
    };
  }

  const threadId = readThreadId(result.runRow.metadata) ?? "";
  const retry = deriveRetryFlags({
    runStatus: result.runRow.status,
    metadata: result.runRow.metadata,
    actions: result.actions,
    now,
  });

  const dto = toAssistantRunStatusDto({
    run: result.runRow,
    threadId,
    initiatedByUserId: result.initiatedByUserId,
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
    errorCode: result.orgLinkMismatch ? "ORG_LINK_MISMATCH" : undefined,
  };
}
