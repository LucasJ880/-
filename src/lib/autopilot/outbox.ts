/**
 * Autopilot A1-P0 durable telemetry outbox.
 * Envelope only — Processor 回读 canonical AgentRun / AgentRunEvent。
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { isAutopilotTelemetryCaptureEnabled } from "./flags";
import { redactPersistedErrorText, safePersistedErrorCode } from "./sanitize";

export const AUTOPILOT_OUTBOX_MAX_ATTEMPTS = 8;
export const AUTOPILOT_OUTBOX_LEASE_MS = 60_000;
export const AUTOPILOT_OUTBOX_BATCH_LIMIT = 25;
export const AUTOPILOT_OUTBOX_BACKOFF_MS = [
  60_000, 300_000, 900_000, 3_600_000, 21_600_000,
] as const;

export type AutopilotOutboxStatus =
  | "pending"
  | "processing"
  | "processed"
  | "dead";

export type AutopilotOutboxNoticeType =
  | "run_created"
  | "event"
  | "run_terminal";

export type AutopilotOutboxClient = {
  autopilotTelemetryOutbox: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export type OutboxClaimSnapshot = {
  status: string;
  attemptCount: number;
  nextAttemptAt: Date | null;
  leaseExpiresAt: Date | null;
};

/** CAS claim 条件（与 lease.ts updateMany 模式一致）。 */
export function isOutboxRowClaimable(
  row: OutboxClaimSnapshot,
  now: Date,
  maxAttempts: number,
): boolean {
  if (row.status === "processed" || row.status === "dead") return false;
  if (row.attemptCount >= maxAttempts) return false;
  if (row.status === "processing") {
    return (
      row.leaseExpiresAt != null && row.leaseExpiresAt.getTime() <= now.getTime()
    );
  }
  if (row.status !== "pending") return false;
  if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime()) {
    return false;
  }
  return true;
}

/** Expired processing at/over max attempts: recover to DEAD, do not reclaim. */
export function isOutboxRowExpiredMaxAttempt(
  row: OutboxClaimSnapshot,
  now: Date,
  maxAttempts: number,
): boolean {
  if (row.status !== "processing") return false;
  if (row.attemptCount < maxAttempts) return false;
  return (
    row.leaseExpiresAt != null && row.leaseExpiresAt.getTime() <= now.getTime()
  );
}

export type AutopilotOutboxEnvelope = {
  orgId: string;
  agentRunId: string;
  noticeType: AutopilotOutboxNoticeType;
  agentEventId?: string | null;
  sequence?: number | null;
  sourceEventType?: string | null;
};

export type EnqueueOutboxResult = "inserted" | "duplicate" | "skipped";

export function autopilotOutboxIdempotencyKey(
  input: AutopilotOutboxEnvelope,
): string {
  if (input.noticeType === "event") {
    if (!input.agentEventId) {
      throw new Error("event outbox requires agentEventId");
    }
    return `event:${input.agentEventId}`;
  }
  return `${input.noticeType}:${input.agentRunId}`;
}

export function autopilotOutboxBackoffMs(attemptCount: number): number {
  const idx = Math.min(
    AUTOPILOT_OUTBOX_BACKOFF_MS.length - 1,
    Math.max(0, attemptCount - 1),
  );
  return AUTOPILOT_OUTBOX_BACKOFF_MS[idx];
}

export function sanitizeOutboxError(error: unknown): {
  code: string;
  summary: string;
} {
  const raw = error instanceof Error ? error.message : String(error);
  const summary = redactPersistedErrorText(raw);
  const rawCode =
    typeof error === "object" &&
    error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code: string }).code)
      : "PROCESSOR_ERROR";
  return { code: safePersistedErrorCode(rawCode), summary };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function enqueueAutopilotTelemetryOutbox(
  client: unknown,
  input: AutopilotOutboxEnvelope,
  env: Record<string, string | undefined> = process.env,
): Promise<EnqueueOutboxResult> {
  if (!isAutopilotTelemetryCaptureEnabled(env)) return "skipped";

  const writer = client as AutopilotOutboxClient;
  const idempotencyKey = autopilotOutboxIdempotencyKey(input);
  try {
    await writer.autopilotTelemetryOutbox.create({
      // envelope only: no prompt / email / document / credential payload
      data: {
        orgId: input.orgId,
        agentRunId: input.agentRunId,
        agentEventId: input.agentEventId ?? null,
        sequence: input.sequence ?? null,
        noticeType: input.noticeType,
        sourceEventType: input.sourceEventType ?? null,
        idempotencyKey,
        status: "pending",
        nextAttemptAt: new Date(),
      },
    });
    return "inserted";
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}

export type ClaimedOutboxRow = {
  id: string;
  orgId: string;
  agentRunId: string;
  agentEventId: string | null;
  sequence: number | null;
  noticeType: AutopilotOutboxNoticeType;
  sourceEventType: string | null;
  attemptCount: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export async function claimAutopilotOutboxBatch(input: {
  limit?: number;
  now?: Date;
  leaseMs?: number;
  maxAttempts?: number;
}): Promise<ClaimedOutboxRow[]> {
  const now = input.now ?? new Date();
  const limit = Math.min(
    AUTOPILOT_OUTBOX_BATCH_LIMIT,
    Math.max(1, input.limit ?? AUTOPILOT_OUTBOX_BATCH_LIMIT),
  );
  const leaseMs = input.leaseMs ?? AUTOPILOT_OUTBOX_LEASE_MS;
  const maxAttempts = input.maxAttempts ?? AUTOPILOT_OUTBOX_MAX_ATTEMPTS;
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  const candidates = await db.autopilotTelemetryOutbox.findMany({
    where: {
      OR: [
        {
          status: "pending",
          attemptCount: { lt: maxAttempts },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: "processing",
          attemptCount: { lt: maxAttempts },
          leaseExpiresAt: { lte: now },
        },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const claimed: ClaimedOutboxRow[] = [];
  for (const cand of candidates) {
    const leaseToken = randomUUID();
    const updated = await db.autopilotTelemetryOutbox.updateMany({
      where: {
        id: cand.id,
        OR: [
          {
            status: "pending",
            attemptCount: { lt: maxAttempts },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: "processing",
            attemptCount: { lt: maxAttempts },
            leaseExpiresAt: { lte: now },
          },
        ],
      },
      data: {
        status: "processing",
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
        leaseExpiresAt,
        leaseToken,
      },
    });
    if (updated.count !== 1) continue;
    const row = await db.autopilotTelemetryOutbox.findUnique({
      where: { id: cand.id },
    });
    if (!row || row.leaseToken !== leaseToken) continue;
    claimed.push({
      id: row.id,
      orgId: row.orgId,
      agentRunId: row.agentRunId,
      agentEventId: row.agentEventId,
      sequence: row.sequence,
      noticeType: row.noticeType as AutopilotOutboxNoticeType,
      sourceEventType: row.sourceEventType,
      attemptCount: row.attemptCount,
      leaseToken,
      leaseExpiresAt,
    });
  }
  return claimed;
}

export async function markAutopilotOutboxProcessed(input: {
  id: string;
  leaseToken: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const res = await db.autopilotTelemetryOutbox.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: "processing" },
    data: {
      status: "processed",
      processedAt: now,
      leaseExpiresAt: null,
      leaseToken: null,
      lastErrorCode: null,
      lastErrorSummary: null,
    },
  });
  return res.count === 1;
}

export async function markAutopilotOutboxRetryOrDead(input: {
  id: string;
  leaseToken: string;
  attemptCount: number;
  error: unknown;
  now?: Date;
  maxAttempts?: number;
}): Promise<"pending" | "dead" | "lost"> {
  const now = input.now ?? new Date();
  const maxAttempts = input.maxAttempts ?? AUTOPILOT_OUTBOX_MAX_ATTEMPTS;
  const { code, summary } = sanitizeOutboxError(input.error);
  const terminal = input.attemptCount >= maxAttempts;
  const res = await db.autopilotTelemetryOutbox.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: "processing" },
    data: terminal
      ? {
          status: "dead",
          lastErrorCode: code,
          lastErrorSummary: summary,
          leaseExpiresAt: null,
          leaseToken: null,
          nextAttemptAt: null,
        }
      : {
          status: "pending",
          lastErrorCode: code,
          lastErrorSummary: summary,
          leaseExpiresAt: null,
          leaseToken: null,
          nextAttemptAt: new Date(now.getTime() + autopilotOutboxBackoffMs(input.attemptCount)),
        },
  });
  if (res.count !== 1) return "lost";
  return terminal ? "dead" : "pending";
}

export async function markAutopilotOutboxDead(input: {
  id: string;
  leaseToken: string;
  code: string;
  summary: string;
}): Promise<boolean> {
  const { summary } = sanitizeOutboxError(new Error(input.summary));
  const res = await db.autopilotTelemetryOutbox.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: "processing" },
    data: {
      status: "dead",
      lastErrorCode: safePersistedErrorCode(input.code),
      lastErrorSummary: summary,
      leaseExpiresAt: null,
      leaseToken: null,
      nextAttemptAt: null,
    },
  });
  return res.count === 1;
}

/**
 * Deterministic recovery: expired PROCESSING rows at/over maxAttempts
 * become DEAD without incrementing attemptCount (no unbounded reclaim).
 */
export async function recoverExpiredMaxAttemptOutbox(input: {
  now?: Date;
  maxAttempts?: number;
  limit?: number;
} = {}): Promise<number> {
  const now = input.now ?? new Date();
  const maxAttempts = input.maxAttempts ?? AUTOPILOT_OUTBOX_MAX_ATTEMPTS;
  const limit = Math.min(
    AUTOPILOT_OUTBOX_BATCH_LIMIT,
    Math.max(1, input.limit ?? AUTOPILOT_OUTBOX_BATCH_LIMIT),
  );
  const { summary } = sanitizeOutboxError(
    new Error("lease expired after max attempts"),
  );
  const candidates = await db.autopilotTelemetryOutbox.findMany({
    where: {
      status: "processing",
      attemptCount: { gte: maxAttempts },
      leaseExpiresAt: { lte: now },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, attemptCount: true },
  });
  let recovered = 0;
  for (const cand of candidates) {
    const res = await db.autopilotTelemetryOutbox.updateMany({
      where: {
        id: cand.id,
        status: "processing",
        attemptCount: { gte: maxAttempts },
        leaseExpiresAt: { lte: now },
      },
      data: {
        status: "dead",
        lastErrorCode: "LEASE_EXPIRED_MAX_ATTEMPTS",
        lastErrorSummary: summary,
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: null,
      },
    });
    recovered += res.count;
  }
  return recovered;
}
