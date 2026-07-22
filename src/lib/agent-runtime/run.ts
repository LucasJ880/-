/**
 * AgentRun / AgentRunEvent — 任务与真实进度
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type {
  AgentErrorCode,
  AgentRunEventType,
  AgentRunStatus,
} from "./types";
import { ACTIVE_RUN_STATUSES } from "./types";
import {
  createTraceContext,
  traceContextToMetadata,
} from "@/lib/capabilities/trace-context";

function jsonValue(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function createAgentRun(input: {
  orgId: string;
  sessionId: string;
  userMessageId?: string | null;
  runType?: string;
  intent?: string | null;
  metadata?: Record<string, unknown>;
  /** Phase 3A：可选传入；缺省则自动生成并写入列 + metadata */
  traceId?: string | null;
  parentRunId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
}) {
  if (!input.orgId) throw new Error("orgId 必填");

  const session = await db.agentSession.findFirst({
    where: { id: input.sessionId, orgId: input.orgId },
    select: { id: true },
  });
  if (!session) throw new Error("Session 不存在或跨组织");

  // 幂等：同一 userMessageId 不重复创建 Run
  if (input.userMessageId) {
    const existing = await db.agentRun.findFirst({
      where: {
        orgId: input.orgId,
        userMessageId: input.userMessageId,
      },
    });
    if (existing) return { run: existing, reused: true as const };
  }

  const existingMeta = input.metadata ?? {};
  const incomingTrace =
    input.traceId ||
    (typeof existingMeta.traceId === "string" ? existingMeta.traceId : null);
  const trace = createTraceContext({
    orgId: input.orgId,
    traceId: incomingTrace,
    parentRunId: input.parentRunId ?? null,
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId ?? null,
  });
  const mergedMeta = {
    ...existingMeta,
    ...traceContextToMetadata(trace),
  };

  const run = await db.agentRun.create({
    data: {
      orgId: input.orgId,
      sessionId: input.sessionId,
      userMessageId: input.userMessageId || null,
      runType: input.runType || "conversation",
      status: "queued",
      intent: input.intent || null,
      traceId: trace.traceId,
      parentRunId: trace.parentRunId,
      metadata: jsonValue(mergedMeta),
      startedAt: new Date(),
    },
  });

  // 回写 runId 到 metadata（创建后已知）
  const runWithMeta = await db.agentRun.update({
    where: { id: run.id },
    data: {
      metadata: jsonValue({
        ...mergedMeta,
        runId: run.id,
      }),
    },
  });

  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: run.id,
    eventType: "run.started",
    title: "任务已创建",
    visibleToUser: true,
  });

  return { run: runWithMeta, reused: false as const };
}

export async function updateAgentRunStatus(
  orgId: string,
  runId: string,
  status: AgentRunStatus,
  patch?: {
    model?: string;
    intent?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
    select: { id: true, status: true },
  });
  if (!run) throw new Error("Run 不存在或跨组织");
  if (run.status === "cancelled" || run.status === "completed") return run;

  return db.agentRun.update({
    where: { id: runId },
    data: {
      status,
      ...(patch?.model ? { model: patch.model } : {}),
      ...(patch?.intent ? { intent: patch.intent } : {}),
      ...(patch?.metadata ? { metadata: jsonValue(patch.metadata) } : {}),
    },
  });
}

export async function completeAgentRun(orgId: string, runId: string) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
  });
  if (!run) throw new Error("Run 不存在或跨组织");
  if (
    run.status === "cancelled" ||
    run.status === "completed" ||
    run.status === "failed"
  ) {
    return run;
  }

  const completedAt = new Date();
  const latencyMs = run.startedAt
    ? completedAt.getTime() - run.startedAt.getTime()
    : null;

  const updated = await db.agentRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      completedAt,
      latencyMs,
    },
  });

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "run.completed",
    title: "任务完成",
    payload: { latencyMs },
  });

  return updated;
}

export async function failAgentRun(
  orgId: string,
  runId: string,
  error: { code: AgentErrorCode; message: string },
) {
  const run = await db.agentRun.findFirst({ where: { id: runId, orgId } });
  if (!run) throw new Error("Run 不存在或跨组织");
  if (run.status === "cancelled") return run;

  const completedAt = new Date();
  const latencyMs = run.startedAt
    ? completedAt.getTime() - run.startedAt.getTime()
    : null;

  const updated = await db.agentRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      completedAt,
      latencyMs,
      errorCode: error.code,
      errorMessage: error.message.slice(0, 2000),
    },
  });

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "run.failed",
    title: "任务失败",
    payload: { code: error.code },
    visibleToUser: true,
  });

  return updated;
}

export async function cancelAgentRun(orgId: string, runId: string) {
  const run = await db.agentRun.findFirst({ where: { id: runId, orgId } });
  if (!run) throw new Error("Run 不存在或跨组织");
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return run;
  }

  const updated = await db.agentRun.update({
    where: { id: runId },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      completedAt: new Date(),
      latencyMs: run.startedAt
        ? Date.now() - run.startedAt.getTime()
        : null,
    },
  });

  // 联动拒绝该 Run 下未决 PendingAction（不自动执行）
  let rejectedPending = 0;
  try {
    const { rejectPendingActionsForAgentRun } = await import("./pending-link");
    rejectedPending = await rejectPendingActionsForAgentRun({
      orgId,
      agentRunId: runId,
      reason: "关联任务已取消，待确认动作已拒绝",
    });
  } catch {
    /* 联动失败不阻断取消 */
  }

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "run.cancelled",
    title:
      rejectedPending > 0
        ? `任务已取消，并拒绝 ${rejectedPending} 个待确认动作`
        : "任务已取消",
    payload: { rejectedPending },
  });

  return updated;
}

export async function isAgentRunCancelled(
  orgId: string,
  runId: string,
): Promise<boolean> {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
    select: { status: true },
  });
  return run?.status === "cancelled";
}

export async function findLatestActiveRun(input: {
  orgId: string;
  sessionId: string;
  /** 排除当前消息刚创建的 Run（状态/取消命令自身） */
  excludeRunId?: string;
}) {
  return db.agentRun.findFirst({
    where: {
      orgId: input.orgId,
      sessionId: input.sessionId,
      status: { in: ACTIVE_RUN_STATUSES },
      ...(input.excludeRunId ? { id: { not: input.excludeRunId } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function appendAgentRunEvent(input: {
  orgId: string;
  runId: string;
  eventType: AgentRunEventType;
  title?: string;
  payload?: Record<string, unknown>;
  visibleToUser?: boolean;
}) {
  try {
    const run = await db.agentRun.findFirst({
      where: { id: input.runId, orgId: input.orgId },
      select: { id: true },
    });
    if (!run) return null;

    const last = await db.agentRunEvent.findFirst({
      where: { runId: input.runId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const sequence = (last?.sequence ?? 0) + 1;

    return await db.agentRunEvent.create({
      data: {
        orgId: input.orgId,
        runId: input.runId,
        sequence,
        eventType: input.eventType,
        title: input.title || null,
        payload: jsonValue(input.payload),
        visibleToUser: input.visibleToUser !== false,
      },
    });
  } catch (error) {
    console.error("[AgentRunEvent] append failed", {
      runId: input.runId,
      orgId: input.orgId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listAgentRunEvents(orgId: string, runId: string) {
  return db.agentRunEvent.findMany({
    where: { orgId, runId },
    orderBy: { sequence: "asc" },
  });
}

export async function getAgentRunStatus(orgId: string, runId: string) {
  return db.agentRun.findFirst({
    where: { id: runId, orgId },
    include: {
      events: {
        where: { visibleToUser: true },
        orderBy: { sequence: "desc" },
        take: 1,
      },
    },
  });
}
