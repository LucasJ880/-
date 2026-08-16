/**
 * A1-P2 Human Signal persistence.
 *
 * Called AFTER the durable business fact commits.
 * Telemetry failure must not throw to the business caller.
 * Same signalKey is at-least-once safe (duplicate suppressed).
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { logger } from "@/lib/common/logger";
import {
  appendAgentRunEventInTx,
  withAgentRunEventSequenceRetry,
} from "@/lib/agent-runtime/run";
import type { AgentRunEventType } from "@/lib/agent-runtime/types";
import {
  buildHumanSignalPayload,
  changeMagnitude,
  humanEditSignalKey,
  humanOverrideSignalKey,
  readHumanSignalKeys,
  reAskSignalKey,
  shouldEmitHumanEdit,
  snapshotStats,
  type HumanOverrideType,
} from "./human-signals";

export type ObserveResult =
  | { status: "written"; eventId: string; sequence: number }
  | { status: "duplicate"; signalKey: string }
  | { status: "skipped"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string };

function asMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

let testForceNextAppendFail = false;

/** Isolated E2E only: next appendHumanSignalOnce returns failed without writing. */
export function forceNextHumanSignalAppendFailureForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  testForceNextAppendFail = true;
}

export async function validateHumanSignalLineage(input: {
  orgId: string;
  actorUserId: string;
  sourceAgentRunId: string;
  newAgentRunId?: string | null;
  pendingActionId?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const membership = await getOrgMembership(input.actorUserId, input.orgId);
  if (!membership || membership.status !== "active") {
    return { ok: false, reason: "FOREIGN_ACTOR" };
  }

  const sourceRun = await db.agentRun.findFirst({
    where: { id: input.sourceAgentRunId, orgId: input.orgId },
    select: { id: true, orgId: true },
  });
  if (!sourceRun) {
    return { ok: false, reason: "FOREIGN_SOURCE_RUN" };
  }

  if (input.newAgentRunId?.trim()) {
    const newRun = await db.agentRun.findFirst({
      where: { id: input.newAgentRunId },
      select: { id: true, orgId: true, metadata: true },
    });
    if (!newRun || newRun.orgId !== input.orgId) {
      return { ok: false, reason: "FOREIGN_NEW_RUN" };
    }
    const retriedFrom = asMeta(newRun.metadata).retriedFromRunId;
    if (
      typeof retriedFrom === "string" &&
      retriedFrom.trim() &&
      retriedFrom !== input.sourceAgentRunId
    ) {
      return { ok: false, reason: "INVALID_RETRIED_FROM_RUN" };
    }
  }

  if (input.pendingActionId?.trim()) {
    const pa = await db.pendingAction.findFirst({
      where: { id: input.pendingActionId },
      select: { id: true, orgId: true, agentRunId: true },
    });
    if (!pa || pa.orgId !== input.orgId) {
      return { ok: false, reason: "FOREIGN_PENDING_ACTION" };
    }
    if (pa.agentRunId !== input.sourceAgentRunId) {
      return { ok: false, reason: "PENDING_ACTION_RUN_MISMATCH" };
    }
  }

  return { ok: true };
}

async function appendHumanSignalOnce(input: {
  orgId: string;
  runId: string;
  eventType: AgentRunEventType;
  title: string;
  signalKey: string;
  payload: Record<string, unknown>;
}): Promise<ObserveResult> {
  try {
    if (testForceNextAppendFail && process.env.NODE_ENV === "test") {
      testForceNextAppendFail = false;
      return { status: "failed", reason: "TEST_FORCED_FAILURE" };
    }
    const run = await db.agentRun.findFirst({
      where: { id: input.runId, orgId: input.orgId },
      select: { id: true, orgId: true, metadata: true, status: true },
    });
    if (!run) {
      return { status: "rejected", reason: "CROSS_ORG_OR_MISSING_RUN" };
    }

    return await withAgentRunEventSequenceRetry(async () => {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`
            SELECT id FROM "AgentRun"
            WHERE id = ${input.runId} AND "orgId" = ${input.orgId}
            FOR UPDATE
          `,
        );
        const locked = await tx.agentRun.findFirst({
          where: { id: input.runId, orgId: input.orgId },
          select: { id: true, metadata: true },
        });
        if (!locked) {
          return { status: "rejected" as const, reason: "CROSS_ORG_OR_MISSING_RUN" };
        }
        const keys = readHumanSignalKeys(locked.metadata);
        if (keys.includes(input.signalKey)) {
          return { status: "duplicate" as const, signalKey: input.signalKey };
        }
        const created = await appendAgentRunEventInTx(tx, {
          orgId: input.orgId,
          runId: input.runId,
          eventType: input.eventType,
          title: input.title,
          payload: buildHumanSignalPayload({
            ...input.payload,
            signalKey: input.signalKey,
          }),
          visibleToUser: false,
        });
        if (!created) {
          return { status: "failed" as const, reason: "APPEND_RETURNED_NULL" };
        }
        const meta = asMeta(locked.metadata);
        await tx.agentRun.update({
          where: { id: input.runId },
          data: {
            metadata: {
              ...meta,
              humanSignalKeys: [...keys, input.signalKey],
            } as Prisma.InputJsonValue,
          },
        });
        return {
          status: "written" as const,
          eventId: created.id,
          sequence: created.sequence,
        };
      });
    });
  } catch (error) {
    logger.warn("autopilot.human_signal.append_failed", {
      runId: input.runId,
      eventType: input.eventType,
      err: error instanceof Error ? error.message : String(error),
    });
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "append_failed",
    };
  }
}

export async function observeHumanEdit(input: {
  orgId: string;
  sourceAgentRunId: string;
  actorUserId: string;
  artifactType: string;
  artifactId: string;
  committedVersion: string;
  commitAction: "save" | "send" | "submit" | "accept" | "finalize" | "commit";
  before: unknown;
  after: unknown;
  sourceOutputRef?: string | null;
  artifactOrgId?: string | null;
}): Promise<ObserveResult> {
  if (!input.sourceAgentRunId?.trim()) {
    return { status: "skipped", reason: "UNLINKED_AI_LINEAGE" };
  }
  if (input.artifactOrgId && input.artifactOrgId !== input.orgId) {
    return { status: "rejected", reason: "CROSS_ORG_ARTIFACT" };
  }
  const lineage = await validateHumanSignalLineage({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    sourceAgentRunId: input.sourceAgentRunId,
  });
  if (!lineage.ok) {
    return { status: "rejected", reason: lineage.reason };
  }
  const before = snapshotStats(input.before);
  const after = snapshotStats(input.after);
  if (
    !shouldEmitHumanEdit({
      sourceAgentRunId: input.sourceAgentRunId,
      beforeHash: before.hash,
      afterHash: after.hash,
      commitOccurred: true,
    })
  ) {
    return { status: "skipped", reason: "UNCHANGED_OR_NO_LINEAGE" };
  }
  const signalKey = humanEditSignalKey({
    sourceRunId: input.sourceAgentRunId,
    artifactId: input.artifactId,
    committedVersion: input.committedVersion,
  });
  return appendHumanSignalOnce({
    orgId: input.orgId,
    runId: input.sourceAgentRunId,
    eventType: "human.edit",
    title: "human.edit",
    signalKey,
    payload: {
      sourceAgentRunId: input.sourceAgentRunId,
      sourceOutputRef: input.sourceOutputRef ?? null,
      artifactType: input.artifactType,
      artifactRef: input.artifactId,
      commitAction: input.commitAction,
      beforeHash: before.hash,
      afterHash: after.hash,
      beforeChars: before.chars,
      afterChars: after.chars,
      changed: true,
      changeMagnitude: changeMagnitude(before.chars, after.chars),
      actorUserId: input.actorUserId,
    },
  });
}

export async function observeHumanOverride(input: {
  orgId: string;
  sourceAgentRunId: string;
  actorUserId: string;
  overrideType: HumanOverrideType;
  decisionRef: string;
  actionType?: string;
  pendingActionId?: string;
  replacementRef?: string | null;
}): Promise<ObserveResult> {
  if (!input.sourceAgentRunId.trim()) {
    return { status: "skipped", reason: "UNLINKED_AI_LINEAGE" };
  }
  const lineage = await validateHumanSignalLineage({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    sourceAgentRunId: input.sourceAgentRunId,
    pendingActionId: input.pendingActionId ?? null,
  });
  if (!lineage.ok) {
    return { status: "rejected", reason: lineage.reason };
  }
  const signalKey = humanOverrideSignalKey({
    sourceRunId: input.sourceAgentRunId,
    decisionRef: input.decisionRef,
    transition: input.overrideType.toLowerCase(),
  });
  return appendHumanSignalOnce({
    orgId: input.orgId,
    runId: input.sourceAgentRunId,
    eventType: "human.override",
    title: "human.override",
    signalKey,
    payload: {
      sourceAgentRunId: input.sourceAgentRunId,
      sourceDecisionRef: input.decisionRef,
      pendingActionId: input.pendingActionId ?? null,
      actionType: input.actionType ?? null,
      overrideType: input.overrideType,
      replacementRef: input.replacementRef ?? null,
      actorUserId: input.actorUserId,
    },
  });
}

export async function observeReAsk(input: {
  orgId: string;
  originalRunId: string;
  newRunId: string;
  actorUserId: string;
  retryActionId: string;
  originalOutputRef?: string | null;
  originalMessageId?: string | null;
}): Promise<ObserveResult> {
  if (!input.originalRunId.trim() || !input.newRunId.trim()) {
    return { status: "skipped", reason: "MISSING_RUN_CORRELATION" };
  }
  const lineage = await validateHumanSignalLineage({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    sourceAgentRunId: input.originalRunId,
    newAgentRunId: input.newRunId,
  });
  if (!lineage.ok) {
    return { status: "rejected", reason: lineage.reason };
  }
  const signalKey = reAskSignalKey({
    sourceRunId: input.originalRunId,
    retryActionId: input.retryActionId,
  });
  return appendHumanSignalOnce({
    orgId: input.orgId,
    runId: input.originalRunId,
    eventType: "human.reask",
    title: "human.reask",
    signalKey,
    payload: {
      originalAgentRunId: input.originalRunId,
      newAgentRunId: input.newRunId,
      originalOutputRef: input.originalOutputRef ?? null,
      originalMessageId: input.originalMessageId ?? null,
      retryActionId: input.retryActionId,
      actorUserId: input.actorUserId,
    },
  });
}

/** Safe wrapper: never throws into business commits. */
export async function observeHumanEditSafe(
  input: Parameters<typeof observeHumanEdit>[0],
): Promise<ObserveResult> {
  try {
    return await observeHumanEdit(input);
  } catch (error) {
    logger.warn("autopilot.human_edit.safe_failed", {
      err: error instanceof Error ? error.message : String(error),
    });
    return { status: "failed", reason: "safe_wrapper" };
  }
}

export async function observeHumanOverrideSafe(
  input: Parameters<typeof observeHumanOverride>[0],
): Promise<ObserveResult> {
  try {
    return await observeHumanOverride(input);
  } catch (error) {
    logger.warn("autopilot.human_override.safe_failed", {
      err: error instanceof Error ? error.message : String(error),
    });
    return { status: "failed", reason: "safe_wrapper" };
  }
}

export async function observeReAskSafe(
  input: Parameters<typeof observeReAsk>[0],
): Promise<ObserveResult> {
  try {
    return await observeReAsk(input);
  } catch (error) {
    logger.warn("autopilot.human_reask.safe_failed", {
      err: error instanceof Error ? error.message : String(error),
    });
    return { status: "failed", reason: "safe_wrapper" };
  }
}
