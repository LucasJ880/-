/**
 * Autopilot 数据访问。页面 / API 禁止直接 prisma.agentRun.findMany。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { sanitizeAutopilotPayload } from "./sanitize";
import type { AutopilotTraceEventType } from "./types";

export type AutopilotListQuery = {
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function jsonValue(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function listAgentRunsForAutopilot(
  orgId: string,
  query: AutopilotListQuery = {},
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = { orgId };
  const [total, rows] = await Promise.all([
    db.agentRun.count({ where }),
    db.agentRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        session: { select: { userId: true } },
        events: {
          select: { eventType: true },
        },
        autopilotRun: true,
      },
    }),
  ]);
  return { total, page, pageSize, rows };
}

export async function getAgentRunForAutopilot(orgId: string, runId: string) {
  return db.agentRun.findFirst({
    where: { id: runId, orgId },
    include: {
      session: { select: { userId: true } },
      events: { orderBy: { sequence: "asc" } },
      autopilotRun: { include: { events: { orderBy: { sequence: "asc" } } } },
    },
  });
}

export async function listPendingActionsForRun(orgId: string, runId: string) {
  return db.pendingAction.findMany({
    where: { orgId, agentRunId: runId },
    select: { id: true, type: true, status: true, agentRunId: true },
    take: 50,
  });
}

export async function countRunsSince(orgId: string, since: Date): Promise<number> {
  return db.agentRun.count({
    where: { orgId, createdAt: { gte: since } },
  });
}

export async function averageLatencySince(
  orgId: string,
  since: Date,
): Promise<number | null> {
  const agg = await db.agentRun.aggregate({
    where: { orgId, createdAt: { gte: since }, latencyMs: { not: null } },
    _avg: { latencyMs: true },
  });
  const v = agg._avg.latencyMs;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function countToolFailuresSince(
  orgId: string,
  since: Date,
): Promise<number> {
  return db.agentRunEvent.count({
    where: {
      orgId,
      createdAt: { gte: since },
      OR: [
        { eventType: "tool.failed" },
        { eventType: "TOOL_CALL_FAILED" },
      ],
    },
  });
}

export async function upsertAutopilotObservation(input: {
  agentRunId: string;
  orgId: string;
  userId?: string | null;
  projectId?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  agentType?: string | null;
  agentVersion?: string | null;
  intent?: string | null;
  outcome: string;
  failureType?: string | null;
  failureSource?: string | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  toolCallCount?: number;
  humanOverride?: boolean;
  humanEdit?: boolean;
  startedAt?: Date | null;
  completedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = sanitizeAutopilotPayload(input.metadata ?? null);
  return db.autopilotRun.upsert({
    where: { agentRunId: input.agentRunId },
    create: {
      agentRunId: input.agentRunId,
      orgId: input.orgId,
      userId: input.userId ?? null,
      projectId: input.projectId ?? null,
      threadId: input.threadId ?? null,
      sessionId: input.sessionId ?? null,
      agentId: input.agentId ?? null,
      agentType: input.agentType ?? null,
      agentVersion: input.agentVersion ?? null,
      intent: input.intent ?? null,
      outcome: input.outcome,
      failureType: input.failureType ?? null,
      failureSource: input.failureSource ?? null,
      latencyMs: input.latencyMs ?? null,
      errorCode: input.errorCode ?? null,
      errorSummary: input.errorSummary ?? null,
      toolCallCount: input.toolCallCount ?? 0,
      humanOverride: input.humanOverride ?? false,
      humanEdit: input.humanEdit ?? false,
      reAskStatus: "NOT_EVALUATED",
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      metadata: jsonValue(metadata),
    },
    update: {
      userId: input.userId ?? undefined,
      projectId: input.projectId ?? undefined,
      threadId: input.threadId ?? undefined,
      sessionId: input.sessionId ?? undefined,
      agentId: input.agentId ?? undefined,
      agentType: input.agentType ?? undefined,
      agentVersion: input.agentVersion ?? undefined,
      intent: input.intent ?? undefined,
      outcome: input.outcome,
      failureType: input.failureType ?? undefined,
      failureSource: input.failureSource ?? undefined,
      latencyMs: input.latencyMs ?? undefined,
      errorCode: input.errorCode ?? undefined,
      errorSummary: input.errorSummary ?? undefined,
      toolCallCount: input.toolCallCount ?? undefined,
      humanOverride: input.humanOverride ?? undefined,
      humanEdit: input.humanEdit ?? undefined,
      startedAt: input.startedAt ?? undefined,
      completedAt: input.completedAt ?? undefined,
      metadata: jsonValue(metadata),
    },
  });
}

export type AutopilotRunOrgOverlay = {
  id: string;
  orgId: string;
};

/** Pure guard: overlay.agentRunId 所属 org 必须与写入 orgId 一致。 */
export function overlayBelongsToOrg(
  overlay: AutopilotRunOrgOverlay | null | undefined,
  orgId: string,
): overlay is AutopilotRunOrgOverlay {
  if (!overlay) return false;
  if (!orgId) return false;
  return overlay.orgId === orgId;
}

export async function appendAutopilotObservationEvent(input: {
  orgId: string;
  agentRunId: string;
  eventType: AutopilotTraceEventType;
  sequence?: number;
  timestamp: Date;
  durationMs?: number | null;
  payload?: Record<string, unknown> | null;
}) {
  const overlay = await db.autopilotRun.findUnique({
    where: { agentRunId: input.agentRunId },
    select: { id: true, orgId: true },
  });
  if (!overlayBelongsToOrg(overlay, input.orgId)) return null;

  const last = await db.autopilotRunEvent.findFirst({
    where: { runId: overlay.id },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = input.sequence ?? (last?.sequence ?? 0) + 1;
  const payload = sanitizeAutopilotPayload(input.payload ?? null);

  try {
    return await db.autopilotRunEvent.create({
      data: {
        orgId: input.orgId,
        runId: overlay.id,
        eventType: input.eventType,
        sequence,
        timestamp: input.timestamp,
        durationMs: input.durationMs ?? null,
        payload: jsonValue(payload),
      },
    });
  } catch {
    return null;
  }
}
