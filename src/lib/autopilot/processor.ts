/**
 * Autopilot A1-P0 outbox processor.
 * Claim → load canonical source → sanitize/project → mark processed.
 *
 * 单条失败不堵队列。Processor flag OFF 时零 Outbox 查询。
 */

import { db } from "@/lib/db";
import { isAutopilotProcessorEnabled } from "./flags";
import { projectAutopilotNotice } from "./instrumentation";
import {
  AUTOPILOT_OUTBOX_BATCH_LIMIT,
  claimAutopilotOutboxBatch,
  markAutopilotOutboxDead,
  markAutopilotOutboxProcessed,
  markAutopilotOutboxRetryOrDead,
  recoverExpiredMaxAttemptOutbox,
  type ClaimedOutboxRow,
} from "./outbox";

export type ProcessOutboxResult = {
  skipped: boolean;
  claimed: number;
  processed: number;
  retried: number;
  dead: number;
  lost: number;
  recoveredDead: number;
};

export type AutopilotProcessorPorts = {
  claim: (input: {
    limit?: number;
    now?: Date;
  }) => Promise<ClaimedOutboxRow[]>;
  recoverExpiredMaxAttempts?: (input: {
    now?: Date;
    limit?: number;
  }) => Promise<number>;
  markProcessed: typeof markAutopilotOutboxProcessed;
  markRetryOrDead: typeof markAutopilotOutboxRetryOrDead;
  markDead: typeof markAutopilotOutboxDead;
  loadRun: (
    agentRunId: string,
  ) => Promise<{ id: string; orgId: string } | null>;
  loadEvent: (input: {
    id: string;
    runId: string;
    orgId: string;
  }) => Promise<{
    eventType: string;
    sequence: number;
    payload: unknown;
    createdAt: Date;
  } | null>;
  project: typeof projectAutopilotNotice;
};

function asPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const TERMINAL_PROCESSOR_CODES = new Set([
  "CROSS_ORG",
  "MISSING_RUN",
  "MISSING_EVENT",
  "MISSING_EVENT_ID",
]);

export async function defaultAutopilotProcessorPorts(): Promise<AutopilotProcessorPorts> {
  return {
    claim: claimAutopilotOutboxBatch,
    recoverExpiredMaxAttempts: recoverExpiredMaxAttemptOutbox,
    markProcessed: markAutopilotOutboxProcessed,
    markRetryOrDead: markAutopilotOutboxRetryOrDead,
    markDead: markAutopilotOutboxDead,
    loadRun: async (agentRunId) =>
      db.agentRun.findFirst({
        where: { id: agentRunId },
        select: { id: true, orgId: true },
      }),
    loadEvent: async (input) =>
      db.agentRunEvent.findFirst({
        where: { id: input.id, runId: input.runId, orgId: input.orgId },
        select: {
          eventType: true,
          sequence: true,
          payload: true,
          createdAt: true,
        },
      }),
    project: projectAutopilotNotice,
  };
}

async function projectClaimedRow(
  row: ClaimedOutboxRow,
  ports: AutopilotProcessorPorts,
): Promise<void> {
  const run = await ports.loadRun(row.agentRunId);
  if (!run) {
    await ports.markDead({
      id: row.id,
      leaseToken: row.leaseToken,
      code: "MISSING_RUN",
      summary: "canonical AgentRun missing",
    });
    throw new Error("MISSING_RUN");
  }
  if (run.orgId !== row.orgId) {
    await ports.markDead({
      id: row.id,
      leaseToken: row.leaseToken,
      code: "CROSS_ORG",
      summary: "outbox.orgId does not match AgentRun.orgId",
    });
    throw new Error("CROSS_ORG");
  }

  if (row.noticeType === "event") {
    if (!row.agentEventId) {
      await ports.markDead({
        id: row.id,
        leaseToken: row.leaseToken,
        code: "MISSING_EVENT_ID",
        summary: "event envelope missing agentEventId",
      });
      throw new Error("MISSING_EVENT_ID");
    }
    const event = await ports.loadEvent({
      id: row.agentEventId,
      runId: row.agentRunId,
      orgId: row.orgId,
    });
    if (!event) {
      await ports.markDead({
        id: row.id,
        leaseToken: row.leaseToken,
        code: "MISSING_EVENT",
        summary: "canonical AgentRunEvent missing",
      });
      throw new Error("MISSING_EVENT");
    }
    await ports.project({
      type: "event",
      orgId: row.orgId,
      runId: row.agentRunId,
      eventType: event.eventType,
      sequence: event.sequence,
      payload: asPayload(event.payload),
      timestamp: event.createdAt,
      agentEventId: row.agentEventId,
    });
    return;
  }

  await ports.project({
    type: row.noticeType,
    orgId: row.orgId,
    runId: row.agentRunId,
  });
}

export async function processAutopilotTelemetryOutbox(input: {
  limit?: number;
  now?: Date;
  env?: Record<string, string | undefined>;
  ports?: AutopilotProcessorPorts;
} = {}): Promise<ProcessOutboxResult> {
  const env = input.env ?? process.env;
  if (!isAutopilotProcessorEnabled(env)) {
    return {
      skipped: true,
      claimed: 0,
      processed: 0,
      retried: 0,
      dead: 0,
      lost: 0,
      recoveredDead: 0,
    };
  }

  const ports = input.ports ?? (await defaultAutopilotProcessorPorts());
  const recoveredDead = ports.recoverExpiredMaxAttempts
    ? await ports.recoverExpiredMaxAttempts({
        now: input.now,
        limit: input.limit ?? AUTOPILOT_OUTBOX_BATCH_LIMIT,
      })
    : 0;
  const claimed = await ports.claim({
    limit: input.limit ?? AUTOPILOT_OUTBOX_BATCH_LIMIT,
    now: input.now,
  });

  const result: ProcessOutboxResult = {
    skipped: false,
    claimed: claimed.length,
    processed: 0,
    retried: 0,
    dead: recoveredDead,
    lost: 0,
    recoveredDead,
  };

  for (const row of claimed) {
    try {
      await projectClaimedRow(row, ports);
      const ok = await ports.markProcessed({
        id: row.id,
        leaseToken: row.leaseToken,
        now: input.now,
      });
      if (ok) result.processed += 1;
      else result.lost += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (TERMINAL_PROCESSOR_CODES.has(message)) {
        result.dead += 1;
        continue;
      }
      const outcome = await ports.markRetryOrDead({
        id: row.id,
        leaseToken: row.leaseToken,
        attemptCount: row.attemptCount,
        error,
        now: input.now,
      });
      if (outcome === "dead") result.dead += 1;
      else if (outcome === "pending") result.retried += 1;
      else result.lost += 1;
    }
  }

  return result;
}
