/**
 * Replay Human Signals from durable business facts.
 * Does not create a second business truth.
 * Telemetry failure must not roll back the original business action.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import { parseRetrySlot } from "@/lib/assistant/retry-idempotency";
import { extractSourceOutputRef } from "./human-signals";
import {
  observeHumanEdit,
  observeHumanOverride,
  observeReAsk,
  type ObserveResult,
} from "./observe-human";

export type ReconcileHumanSignalsResult = {
  scanned: number;
  written: number;
  duplicate: number;
  skipped: number;
  rejected: number;
  failed: number;
};

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

export async function reconcileHumanSignals(input: {
  orgId: string;
  runId?: string;
  limit?: number;
}): Promise<ReconcileHumanSignalsResult> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 25));
  const summary: ReconcileHumanSignalsResult = {
    scanned: 0,
    written: 0,
    duplicate: 0,
    skipped: 0,
    rejected: 0,
    failed: 0,
  };

  const feedbacks = await db.humanFeedbackEvent.findMany({
    where: {
      orgId: input.orgId,
      agentRunId: input.runId ? input.runId : { not: null },
      humanDecision: { in: ["edited", "rejected"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
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
      } else if (event.humanDecision === "rejected" && !event.pendingActionId) {
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

  const retryRows = await db.approvalDecisionIdempotency.findMany({
    where: {
      orgId: input.orgId,
      action: "retry",
      ...(input.runId
        ? { approvalKey: `assistant-run-retry:${input.runId}` }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
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

  const rejectedActions = await db.pendingAction.findMany({
    where: {
      orgId: input.orgId,
      status: "rejected",
      agentRunId: input.runId ? input.runId : { not: null },
    },
    select: {
      id: true,
      type: true,
      agentRunId: true,
      decidedById: true,
      createdById: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const seenRuns = new Set<string>();
  for (const action of rejectedActions) {
    if (!action.agentRunId || seenRuns.has(action.agentRunId)) continue;
    seenRuns.add(action.agentRunId);
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

  return summary;
}
