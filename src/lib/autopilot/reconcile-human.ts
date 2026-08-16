/**
 * Replay Human Signals from durable business facts.
 * Does not create a second business truth.
 * Telemetry failure must not roll back the original business action.
 *
 * Fairness: oldest-first cursor pagination. Each invocation is bounded.
 * Every eligible fact is inspectable by continuing the returned cursor.
 * Automatic scheduler is REQUIRED_BEFORE_PRODUCTION_ACTIVATION.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import { parseRetrySlot } from "@/lib/assistant/retry-idempotency";
import { extractSourceOutputRef } from "./human-signals";
import {
  clampReconcilePageSize,
  cloneHumanSignalReconcileCursor,
  HUMAN_SIGNAL_RECONCILE_MAX_PAGES,
  isHumanSignalReconcileDone,
  isReconcileStreamDone,
  nextStreamCursor,
  startHumanSignalReconcileCursor,
  streamCursorWhere,
  type HumanSignalReconcileCursor,
} from "./reconcile-cursor";
import {
  observeHumanEdit,
  observeHumanOverride,
  observeReAsk,
  type ObserveResult,
} from "./observe-human";

export {
  AUTOMATIC_RECONCILER_TRIGGER,
  cloneHumanSignalReconcileCursor,
  startHumanSignalReconcileCursor,
  isHumanSignalReconcileDone,
  type HumanSignalReconcileCursor,
} from "./reconcile-cursor";

export type ReconcileHumanSignalsResult = {
  scanned: number;
  written: number;
  duplicate: number;
  skipped: number;
  rejected: number;
  failed: number;
  done: boolean;
  cursor: HumanSignalReconcileCursor;
  pages: number;
};

function emptySummary(
  cursor: HumanSignalReconcileCursor,
): ReconcileHumanSignalsResult {
  return {
    scanned: 0,
    written: 0,
    duplicate: 0,
    skipped: 0,
    rejected: 0,
    failed: 0,
    done: isHumanSignalReconcileDone(cursor),
    cursor,
    pages: 0,
  };
}

function tally(
  result: ReconcileHumanSignalsResult,
  observe: ObserveResult,
): void {
  result.scanned += 1;
  if (observe.status === "written") result.written += 1;
  else if (observe.status === "duplicate") result.duplicate += 1;
  else if (observe.status === "skipped") result.skipped += 1;
  else if (observe.status === "rejected") result.rejected += 1;
  else result.failed += 1;
}

function mergeTally(
  acc: ReconcileHumanSignalsResult,
  page: ReconcileHumanSignalsResult,
): void {
  acc.scanned += page.scanned;
  acc.written += page.written;
  acc.duplicate += page.duplicate;
  acc.skipped += page.skipped;
  acc.rejected += page.rejected;
  acc.failed += page.failed;
}

export async function reconcileHumanSignals(input: {
  orgId: string;
  runId?: string;
  limit?: number;
  cursor?: HumanSignalReconcileCursor;
}): Promise<ReconcileHumanSignalsResult> {
  const pageSize = clampReconcilePageSize(input.limit);
  const cursor = cloneHumanSignalReconcileCursor(
    input.cursor ?? startHumanSignalReconcileCursor(),
  );
  const summary = emptySummary(cursor);
  summary.pages = 1;

  if (!isReconcileStreamDone(cursor.feedback)) {
    const extra = streamCursorWhere(cursor.feedback);
    if (extra) {
      const feedbacks = await db.humanFeedbackEvent.findMany({
        where: {
          orgId: input.orgId,
          agentRunId: input.runId ? input.runId : { not: null },
          humanDecision: { in: ["edited", "rejected"] },
          ...(extra as Prisma.HumanFeedbackEventWhereInput),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pageSize,
      });
      for (const event of feedbacks) {
        if (!event.agentRunId) continue;
        try {
          if (event.humanDecision === "edited") {
            const observe = await observeHumanEdit({
              orgId: event.orgId,
              sourceAgentRunId: event.agentRunId,
              actorUserId: event.userId,
              artifactType: "employee_ai_feedback",
              artifactId: event.id,
              committedVersion: "1",
              commitAction: "save",
              before: event.aiOutputSnapshot ?? event.aiOutputRef,
              after: event.humanEditedOutput ?? event.aiOutputSnapshot,
              sourceOutputRef: extractSourceOutputRef(
                event.aiOutputRef,
                event.agentRunId,
              ),
              artifactOrgId: event.orgId,
            });
            tally(summary, observe);
          } else if (
            event.humanDecision === "rejected" &&
            !event.pendingActionId
          ) {
            const observe = await observeHumanOverride({
              orgId: event.orgId,
              sourceAgentRunId: event.agentRunId,
              actorUserId: event.userId,
              overrideType: "REJECTED",
              decisionRef: event.id,
              actionType: "employee_ai.feedback",
            });
            tally(summary, observe);
          }
        } catch (error) {
          summary.scanned += 1;
          summary.failed += 1;
          logger.warn("autopilot.human_signal.reconcile_feedback_failed", {
            feedbackId: event.id,
            err: error instanceof Error ? error.message : String(error),
          });
        }
      }
      summary.cursor.feedback = nextStreamCursor(feedbacks, pageSize);
    }
  }

  if (!isReconcileStreamDone(cursor.retry)) {
    const extra = streamCursorWhere(cursor.retry);
    if (extra) {
      const retryRows = await db.approvalDecisionIdempotency.findMany({
        where: {
          orgId: input.orgId,
          action: "retry",
          ...(input.runId
            ? { approvalKey: `assistant-run-retry:${input.runId}` }
            : {}),
          ...(extra as Prisma.ApprovalDecisionIdempotencyWhereInput),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pageSize,
      });
      for (const row of retryRows) {
        const slot = parseRetrySlot(row.resultJson);
        if (!slot?.newRunId) continue;
        if (slot.status !== "STARTED" && slot.status !== "COMPLETED") continue;
        if (input.runId && slot.oldRunId !== input.runId) continue;
        try {
          const observe = await observeReAsk({
            orgId: row.orgId,
            originalRunId: slot.oldRunId,
            newRunId: slot.newRunId,
            actorUserId: row.userId,
            retryActionId: row.idempotencyKey,
            originalMessageId: slot.userMessageId ?? null,
          });
          tally(summary, observe);
        } catch (error) {
          summary.scanned += 1;
          summary.failed += 1;
          logger.warn("autopilot.human_signal.reconcile_reask_failed", {
            idempotencyKey: row.idempotencyKey,
            err: error instanceof Error ? error.message : String(error),
          });
        }
      }
      summary.cursor.retry = nextStreamCursor(retryRows, pageSize);
    }
  }

  if (!isReconcileStreamDone(cursor.pending)) {
    const extra = streamCursorWhere(cursor.pending, "updatedAt");
    if (extra) {
      const rejectedActions = await db.pendingAction.findMany({
        where: {
          orgId: input.orgId,
          status: "rejected",
          agentRunId: input.runId ? input.runId : { not: null },
          ...(extra as Prisma.PendingActionWhereInput),
        },
        select: {
          id: true,
          type: true,
          agentRunId: true,
          decidedById: true,
          createdById: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: pageSize,
      });
      for (const action of rejectedActions) {
        if (!action.agentRunId) continue;
        try {
          const { reconcileAssistantRunFromPendingActions } = await import(
            "@/lib/assistant/reconcile-run"
          );
          const recon = await reconcileAssistantRunFromPendingActions({
            orgId: input.orgId,
            runId: action.agentRunId,
            triggeredByUserId: action.decidedById ?? action.createdById,
            reason: "human_signal_reconcile_pending_action_rejected",
            triggerAction: {
              id: action.id,
              type: action.type,
              outcome: "rejected",
            },
          });
          summary.scanned += 1;
          if (recon.changed) summary.written += 1;
          else summary.duplicate += 1;
        } catch (error) {
          summary.scanned += 1;
          summary.failed += 1;
          logger.warn("autopilot.human_signal.reconcile_pending_failed", {
            pendingActionId: action.id,
            err: error instanceof Error ? error.message : String(error),
          });
        }
      }
      summary.cursor.pending = nextStreamCursor(
        rejectedActions.map((action) => ({
          createdAt: action.updatedAt,
          id: action.id,
        })),
        pageSize,
      );
    }
  }

  summary.done = isHumanSignalReconcileDone(summary.cursor);
  return summary;
}

/** Page until the window is exhausted. Each page stays bounded. */
export async function reconcileHumanSignalsUntilExhausted(input: {
  orgId: string;
  runId?: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<ReconcileHumanSignalsResult> {
  const maxPages = Math.min(
    HUMAN_SIGNAL_RECONCILE_MAX_PAGES,
    Math.max(1, input.maxPages ?? HUMAN_SIGNAL_RECONCILE_MAX_PAGES),
  );
  const acc = emptySummary(startHumanSignalReconcileCursor());
  let cursor = startHumanSignalReconcileCursor();
  for (let page = 0; page < maxPages; page += 1) {
    const result = await reconcileHumanSignals({
      orgId: input.orgId,
      runId: input.runId,
      limit: input.pageSize,
      cursor,
    });
    mergeTally(acc, result);
    acc.pages += 1;
    acc.cursor = result.cursor;
    acc.done = result.done;
    cursor = result.cursor;
    if (result.done) break;
  }
  return acc;
}
