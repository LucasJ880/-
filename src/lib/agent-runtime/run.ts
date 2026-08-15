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
import {
  runtimeContextToRunMetadata,
  readRootRunIdFromUnknown,
  type AIRuntimeContext,
} from "@/lib/ai/runtime-context";
import { notifyAutopilotRuntime } from "@/lib/autopilot/instrumentation";

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
  /** Commit 6：安全重试允许同一 userMessageId 再建 Run */
  skipUserMessageIdempotency?: boolean;
  /**
   * Phase 1.1：统一执行上下文（actor/agent/owner/job/task/rootRunId）。
   * correlation 字段写入 metadata；rootRunId 缺省时从父 Run 推导，
   * 无父 Run 则为自身 runId。
   */
  runtime?: AIRuntimeContext;
}) {
  if (!input.orgId) throw new Error("orgId 必填");

  const session = await db.agentSession.findFirst({
    where: { id: input.sessionId, orgId: input.orgId },
    select: { id: true, userId: true },
  });
  if (!session) throw new Error("Session 不存在或跨组织");

  // 幂等：同一 userMessageId 不重复创建 Run（重试除外）
  if (input.userMessageId && !input.skipUserMessageIdempotency) {
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
  // Phase 1.1：rootRunId 推导 — 显式传入 > metadata > 父 Run 的 rootRunId > 父 runId
  let rootRunId =
    input.runtime?.rootRunId?.trim() ||
    (typeof existingMeta.rootRunId === "string" && existingMeta.rootRunId.trim()
      ? existingMeta.rootRunId.trim()
      : null);
  if (!rootRunId && trace.parentRunId) {
    const parent = await db.agentRun.findFirst({
      where: { id: trace.parentRunId, orgId: input.orgId },
      select: { id: true, metadata: true },
    });
    if (parent) {
      rootRunId = readRootRunIdFromUnknown(parent.metadata) ?? parent.id;
    } else {
      rootRunId = trace.parentRunId;
    }
  }

  const mergedMeta = {
    ...existingMeta,
    ...runtimeContextToRunMetadata(input.runtime),
    ...traceContextToMetadata(trace),
    ...(rootRunId ? { rootRunId } : {}),
  };

  // Phase 3A-4：创建前配额预留（失败则不落 Run）
  const actorId = session.userId ?? "system";
  const { reserveQuota, releaseReservation, commitReservation } = await import(
    "@/lib/capabilities/governance/reserve"
  );
  const idemBase = `agent_run:${input.orgId}:${input.userMessageId ?? trace.traceId}:${Date.now()}`;
  const rDaily = await reserveQuota({
    orgId: input.orgId,
    userId: actorId,
    workspaceId: input.workspaceId,
    metric: "DAILY_AGENT_RUNS",
    amount: 1,
    idempotencyKey: `${idemBase}:daily`,
    traceId: trace.traceId,
  });
  if (!rDaily.ok) {
    throw new Error(`配额限制：${rDaily.error}`);
  }
  const rConc = await reserveQuota({
    orgId: input.orgId,
    userId: actorId,
    workspaceId: input.workspaceId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: `${idemBase}:concurrent`,
    traceId: trace.traceId,
  });
  if (!rConc.ok) {
    await releaseReservation({
      reservationId: rDaily.reservationId,
      orgId: input.orgId,
      userId: actorId,
    });
    throw new Error(`配额限制：${rConc.error}`);
  }

  // 单次运行估算成本（estimated；不预留账本，仅 hard 拦截）
  const { evaluateQuota } = await import(
    "@/lib/capabilities/governance/evaluate"
  );
  const costEval = await evaluateQuota({
    orgId: input.orgId,
    userId: actorId,
    workspaceId: input.workspaceId,
    metric: "SINGLE_RUN_ESTIMATED_COST",
    requestedAmount: 0.15,
  });
  if (!costEval.allowed) {
    await releaseReservation({
      reservationId: rDaily.reservationId,
      orgId: input.orgId,
      userId: actorId,
    });
    await releaseReservation({
      reservationId: rConc.reservationId,
      orgId: input.orgId,
      userId: actorId,
    });
    throw new Error("配额限制：单次运行估算成本超过 hard limit");
  }

  let run;
  try {
    run = await db.agentRun.create({
      data: {
        orgId: input.orgId,
        sessionId: input.sessionId,
        userMessageId: input.userMessageId || null,
        runType: input.runType || "conversation",
        status: "queued",
        intent: input.intent || null,
        traceId: trace.traceId,
        parentRunId: trace.parentRunId,
        metadata: jsonValue({
          ...mergedMeta,
          quotaReservationIds: [
            rDaily.reservationId,
            rConc.reservationId,
          ],
        }),
        startedAt: new Date(),
      },
    });
  } catch (err) {
    await releaseReservation({
      reservationId: rDaily.reservationId,
      orgId: input.orgId,
      userId: actorId,
    });
    await releaseReservation({
      reservationId: rConc.reservationId,
      orgId: input.orgId,
      userId: actorId,
    });
    throw err;
  }

  await commitReservation({
    reservationId: rDaily.reservationId,
    orgId: input.orgId,
    userId: actorId,
  });
  // 并发预留保持 RESERVED 至 run 终态；此处先关联 runId
  await db.capabilityQuotaReservation
    .updateMany({
      where: { id: rConc.reservationId, orgId: input.orgId },
      data: { runId: run.id },
    })
    .catch(() => {});

  // 回写 runId 到 metadata（创建后已知）；无父 Run 时自身即 root
  const runWithMeta = await db.agentRun.update({
    where: { id: run.id },
    data: {
      metadata: jsonValue({
        ...mergedMeta,
        runId: run.id,
        rootRunId: rootRunId ?? run.id,
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

  notifyAutopilotRuntime({
    type: "run_created",
    orgId: input.orgId,
    runId: runWithMeta.id,
    userId: session.userId,
  });

  return { run: runWithMeta, reused: false as const };
}

function asMetadataRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

/**
 * Phase 2A：metadata 合并写入（禁止 wholesale 覆盖 correlation）。
 * 用于在既有 metadata 上追加/更新键（如 jobId 回写、审批人记录），
 * 保留 actor/owner/jobId/rootRunId/traceId 等既有 correlation 字段。
 */
export async function mergeAgentRunMetadata(
  orgId: string,
  runId: string,
  patch: Record<string, unknown>,
) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
    select: { id: true, metadata: true },
  });
  if (!run) throw new Error("Run 不存在或跨组织");
  return db.agentRun.update({
    where: { id: runId },
    data: {
      metadata: jsonValue({ ...asMetadataRecord(run.metadata), ...patch }),
    },
  });
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
    select: { id: true, status: true, metadata: true },
  });
  if (!run) throw new Error("Run 不存在或跨组织");
  if (run.status === "cancelled" || run.status === "completed") return run;

  return db.agentRun.update({
    where: { id: runId },
    data: {
      status,
      ...(patch?.model ? { model: patch.model } : {}),
      ...(patch?.intent ? { intent: patch.intent } : {}),
      // Phase 2A Critical Fix：metadata patch 合并而非整体替换，
      // 避免摧毁 actor/owner/jobId/rootRunId/traceId correlation。
      ...(patch?.metadata
        ? {
            metadata: jsonValue({
              ...asMetadataRecord(run.metadata),
              ...patch.metadata,
            }),
          }
        : {}),
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

  notifyAutopilotRuntime({
    type: "run_terminal",
    orgId,
    runId,
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

  notifyAutopilotRuntime({
    type: "run_terminal",
    orgId,
    runId,
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

  notifyAutopilotRuntime({
    type: "run_terminal",
    orgId,
    runId,
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

/** Prisma unique violation（并发 sequence 抢占时的判定依据） */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function appendAgentRunEvent(input: {
  orgId: string;
  runId: string;
  eventType: AgentRunEventType;
  title?: string;
  payload?: Record<string, unknown>;
  visibleToUser?: boolean;
}) {
  // Phase 2B-2：sequence = max+1 的读写窗口在并行 Task（同 run 多个并发
  // append）下会撞 @@unique([runId, sequence])。碰撞时重读重试（有界），
  // 不再把 unique violation 当普通失败吞掉——否则并行批次的事件会静默丢失。
  const MAX_SEQUENCE_RETRIES = 8;
  try {
    const run = await db.agentRun.findFirst({
      where: { id: input.runId, orgId: input.orgId },
      select: { id: true },
    });
    if (!run) return null;

    for (let attempt = 0; ; attempt++) {
      const last = await db.agentRunEvent.findFirst({
        where: { runId: input.runId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const sequence = (last?.sequence ?? 0) + 1;

      try {
        const created = await db.agentRunEvent.create({
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
        notifyAutopilotRuntime({
          type: "event",
          orgId: input.orgId,
          runId: input.runId,
          eventType: input.eventType,
          sequence,
          payload: input.payload ?? null,
        });
        return created;
      } catch (error) {
        if (isUniqueViolation(error) && attempt < MAX_SEQUENCE_RETRIES) {
          continue;
        }
        throw error;
      }
    }
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
