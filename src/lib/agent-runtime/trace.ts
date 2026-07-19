/**
 * Agent Trace 只读查询 — 强制 orgId 隔离
 */

import { db } from "@/lib/db";

function requireOrg(orgId: string) {
  const id = (orgId || "").trim();
  if (!id) throw new Error("orgId 必填");
  return id;
}

/** 当前用户在组织内的近期 Session（含最近一次 Run 摘要） */
export async function listAgentSessionsForTrace(input: {
  orgId: string;
  userId: string;
  /** admin 可看组织内全部；普通用户只看自己 */
  scope: "self" | "org";
  limit?: number;
}) {
  const orgId = requireOrg(input.orgId);
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 50);

  const sessions = await db.agentSession.findMany({
    where: {
      orgId,
      ...(input.scope === "self" ? { userId: input.userId } : {}),
    },
    orderBy: { lastActiveAt: "desc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      channel: true,
      channelUserId: true,
      currentProjectId: true,
      currentCustomerId: true,
      currentQuoteId: true,
      lastResponseId: true,
      summary: true,
      status: true,
      lastActiveAt: true,
      createdAt: true,
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          intent: true,
          runType: true,
          latencyMs: true,
          createdAt: true,
          errorCode: true,
        },
      },
    },
  });

  return sessions.map((s) => ({
    id: s.id,
    userId: s.userId,
    channel: s.channel,
    channelUserId: s.channelUserId,
    currentProjectId: s.currentProjectId,
    currentCustomerId: s.currentCustomerId,
    currentQuoteId: s.currentQuoteId,
    lastResponseId: s.lastResponseId,
    summaryPreview: s.summary?.slice(0, 240) ?? null,
    status: s.status,
    lastActiveAt: s.lastActiveAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    latestRun: s.runs[0]
      ? {
          id: s.runs[0].id,
          status: s.runs[0].status,
          intent: s.runs[0].intent,
          runType: s.runs[0].runType,
          latencyMs: s.runs[0].latencyMs,
          createdAt: s.runs[0].createdAt.toISOString(),
          errorCode: s.runs[0].errorCode,
        }
      : null,
  }));
}

export async function listAgentRunsForSession(input: {
  orgId: string;
  userId: string;
  sessionId: string;
  scope: "self" | "org";
  limit?: number;
}) {
  const orgId = requireOrg(input.orgId);
  const session = await db.agentSession.findFirst({
    where: {
      id: input.sessionId,
      orgId,
      ...(input.scope === "self" ? { userId: input.userId } : {}),
    },
    select: { id: true },
  });
  if (!session) return null;

  const runs = await db.agentRun.findMany({
    where: { orgId, sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input.limit ?? 40, 1), 80),
    select: {
      id: true,
      status: true,
      intent: true,
      runType: true,
      model: true,
      latencyMs: true,
      errorCode: true,
      errorMessage: true,
      attempts: true,
      startedAt: true,
      completedAt: true,
      cancelledAt: true,
      createdAt: true,
    },
  });

  return runs.map((r) => ({
    ...r,
    errorMessage: r.errorMessage?.slice(0, 300) ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getAgentRunTrace(input: {
  orgId: string;
  userId: string;
  runId: string;
  scope: "self" | "org";
}) {
  const orgId = requireOrg(input.orgId);

  const run = await db.agentRun.findFirst({
    where: { id: input.runId, orgId },
    include: {
      session: {
        select: {
          id: true,
          userId: true,
          channel: true,
          channelUserId: true,
          summary: true,
          currentProjectId: true,
          currentCustomerId: true,
        },
      },
      events: {
        orderBy: { sequence: "asc" },
        take: 200,
        select: {
          id: true,
          sequence: true,
          eventType: true,
          title: true,
          payload: true,
          visibleToUser: true,
          createdAt: true,
        },
      },
    },
  });

  if (!run) return null;
  if (input.scope === "self" && run.session.userId !== input.userId) {
    return null;
  }

  const pendingActions = await db.pendingAction.findMany({
    where: { agentRunId: run.id, OR: [{ orgId }, { orgId: null }] },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      type: true,
      title: true,
      status: true,
      createdAt: true,
      decidedAt: true,
    },
  });

  return {
    run: {
      id: run.id,
      orgId: run.orgId,
      sessionId: run.sessionId,
      status: run.status,
      intent: run.intent,
      runType: run.runType,
      model: run.model,
      latencyMs: run.latencyMs,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage?.slice(0, 500) ?? null,
      attempts: run.attempts,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      cancelledAt: run.cancelledAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
    },
    session: {
      id: run.session.id,
      userId: run.session.userId,
      channel: run.session.channel,
      channelUserId: run.session.channelUserId,
      summaryPreview: run.session.summary?.slice(0, 400) ?? null,
      currentProjectId: run.session.currentProjectId,
      currentCustomerId: run.session.currentCustomerId,
    },
    events: run.events.map((e) => ({
      id: e.id,
      sequence: e.sequence,
      eventType: e.eventType,
      title: e.title,
      visibleToUser: e.visibleToUser,
      // 不回传可能含敏感全文的大 payload，只保留安全摘要键
      payload: summarizePayload(e.payload),
      createdAt: e.createdAt.toISOString(),
    })),
    pendingActions: pendingActions.map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      decidedAt: p.decidedAt?.toISOString() ?? null,
    })),
  };
}

function summarizePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const src = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const allow = [
    "intent",
    "source",
    "complexity",
    "needsTools",
    "mode",
    "maxToolRounds",
    "name",
    "ok",
    "durationMs",
    "round",
    "types",
    "contextTypes",
    "skills",
    "capability",
    "latencyMs",
    "toolCalls",
    "rejectedPending",
    "code",
    "preview",
  ];
  for (const k of allow) {
    if (k in src) out[k] = src[k];
  }
  return Object.keys(out).length ? out : null;
}
