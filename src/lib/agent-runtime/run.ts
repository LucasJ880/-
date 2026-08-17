/**
 * AgentRun / AgentRunEvent — 任务与真实进度
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type {
  AgentErrorCode,
  AgentRunEventType,
  AgentRunStatus,
  AgentRunTerminalStatus,
} from "./types";
import { ACTIVE_RUN_STATUSES, AGENT_RUN_TERMINAL_STATUSES } from "./types";
import {
  createTraceContext,
  traceContextToMetadata,
} from "@/lib/capabilities/trace-context";
import {
  runtimeContextToRunMetadata,
  readRootRunIdFromUnknown,
  type AIRuntimeContext,
} from "@/lib/ai/runtime-context";
import { enqueueAutopilotTelemetryOutbox } from "@/lib/autopilot/outbox";

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
    run = await db.$transaction(async (tx) => {
      const created = await tx.agentRun.create({
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
      // 新建 run：本事务的 INSERT 已对该 AgentRun 行持有排他锁，
      // 其它事务此刻还看不到该行（未提交），故不存在并发竞争者 ——
      // 这里的 outbox→event 顺序与 canonical lock order 不冲突。
      // appendAgentRunEventInTx 内部会再取一次同行 FOR UPDATE（同事务内 no-op）。
      await enqueueAutopilotTelemetryOutbox(tx, {
        orgId: input.orgId,
        agentRunId: created.id,
        noticeType: "run_created",
      });
      await appendAgentRunEventInTx(tx, {
        orgId: input.orgId,
        runId: created.id,
        eventType: "run.started",
        title: "任务已创建",
        visibleToUser: true,
        payload: {
          schemaVersion: 1,
          userMessageId: input.userMessageId || null,
        },
      });
      return created;
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

const AGENT_RUN_TERMINAL_EVENT: Record<
  AgentRunTerminalStatus,
  AgentRunEventType
> = {
  completed: "run.completed",
  failed: "run.failed",
  cancelled: "run.cancelled",
};

function isAgentRunTerminalStatus(status: string): boolean {
  return (AGENT_RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

async function loadLockedAgentRun(
  tx: Prisma.TransactionClient,
  orgId: string,
  runId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(
    Prisma.sql`
      SELECT id, status
      FROM "AgentRun"
      WHERE id = ${runId} AND "orgId" = ${orgId}
      FOR UPDATE
    `,
  );
  if (rows.length === 0) throw new Error("Run 不存在或跨组织");
  const run = await tx.agentRun.findFirst({
    where: { id: runId, orgId },
  });
  if (!run) throw new Error("Run 不存在或跨组织");
  return run;
}

/**
 * 事件追加路径的 per-run 序列化闸（canonical lock order 的第一步）。
 *
 * 与 {@link loadLockedAgentRun} 取**同一把锁**（AgentRun 行 `FOR UPDATE`），
 * 但语义不同：run 不存在 / 跨 org 时**返回 null 而不抛错** —— 保持
 * appendAgentRunEventInTx 既有的 fail-closed「静默不写事件」契约
 * （跨 org 追加必须零事件零 outbox，见 A1-P0 E2E case 10）。
 *
 * 为什么必须先取这把锁（40P01 根因）：
 * `AgentRunEvent.runId` 与 `AutopilotTelemetryOutbox.agentRunId` 都对 AgentRun 有 FK，
 * PostgreSQL 在插入子行时会对父行取隐式 `FOR KEY SHARE`。修复前：
 *   - terminal 路径：显式 `FOR UPDATE`（强锁）**先**取；
 *   - 普通 append 路径：**完全不取** AgentRun 锁，直到插入子行时才隐式取 `FOR KEY SHARE`（弱锁、晚取）。
 * 两条路径以**不同强度、不同时机**触碰同一批资源（AgentRun 行 / `(runId,sequence)` 唯一槽 /
 * outbox `idempotencyKey` 唯一槽），`FOR UPDATE` 与 `FOR KEY SHARE` 互斥，
 * 交错即可形成等待环 → 40P01。
 *
 * 统一为「先 AgentRun FOR UPDATE」后，同一 run 的所有事件生产者串行化：
 * 序列号分配不再有并发窗口，锁顺序全局一致，环不可能形成。
 * 锁粒度是**单行**，不同 run 互不阻塞（见 SEQ-DEADLOCK-05）。
 */
async function lockAgentRunForAppend(
  tx: Prisma.TransactionClient,
  orgId: string,
  runId: string,
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "AgentRun"
      WHERE id = ${runId} AND "orgId" = ${orgId}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

async function applyAgentRunTerminalInTx(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    runId: string;
    status: (typeof AGENT_RUN_TERMINAL_STATUSES)[number];
    title: string;
    payload?: Record<string, unknown>;
    data: {
      completedAt?: Date;
      cancelledAt?: Date;
      latencyMs?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    };
  },
) {
  const run = await loadLockedAgentRun(tx, input.orgId, input.runId);
  if (isAgentRunTerminalStatus(run.status)) return run;

  const next = await tx.agentRun.update({
    where: { id: input.runId },
    data: {
      status: input.status,
      completedAt: input.data.completedAt ?? null,
      ...(input.data.cancelledAt ? { cancelledAt: input.data.cancelledAt } : {}),
      latencyMs: input.data.latencyMs ?? null,
      ...(input.data.errorCode !== undefined
        ? { errorCode: input.data.errorCode }
        : {}),
      ...(input.data.errorMessage !== undefined
        ? { errorMessage: input.data.errorMessage }
        : {}),
    },
  });
  await appendAgentRunEventInTx(tx, {
    orgId: input.orgId,
    runId: input.runId,
    eventType: AGENT_RUN_TERMINAL_EVENT[input.status],
    title: input.title,
    payload: input.payload,
    visibleToUser: true,
  });
  await enqueueAutopilotTelemetryOutbox(tx, {
    orgId: input.orgId,
    agentRunId: input.runId,
    noticeType: "run_terminal",
  });
  return next;
}

export async function completeAgentRun(orgId: string, runId: string) {
  return withAgentRunEventSequenceRetry(async () => {
    return db.$transaction(async (tx) => {
      const run = await loadLockedAgentRun(tx, orgId, runId);
      if (isAgentRunTerminalStatus(run.status)) return run;
      const completedAt = new Date();
      const latencyMs = run.startedAt
        ? completedAt.getTime() - run.startedAt.getTime()
        : null;
      return applyAgentRunTerminalInTx(tx, {
        orgId,
        runId,
        status: "completed",
        title: "任务完成",
        payload: { latencyMs },
        data: { completedAt, latencyMs },
      });
    });
  });
}

export async function failAgentRun(
  orgId: string,
  runId: string,
  error: { code: AgentErrorCode; message: string },
) {
  return withAgentRunEventSequenceRetry(async () => {
    return db.$transaction(async (tx) => {
      const run = await loadLockedAgentRun(tx, orgId, runId);
      if (isAgentRunTerminalStatus(run.status)) return run;
      const completedAt = new Date();
      const latencyMs = run.startedAt
        ? completedAt.getTime() - run.startedAt.getTime()
        : null;
      return applyAgentRunTerminalInTx(tx, {
        orgId,
        runId,
        status: "failed",
        title: "任务失败",
        payload: { code: error.code },
        data: {
          completedAt,
          latencyMs,
          errorCode: error.code,
          errorMessage: error.message.slice(0, 2000),
        },
      });
    });
  });
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

  return withAgentRunEventSequenceRetry(async () => {
    return db.$transaction(async (tx) => {
      const current = await loadLockedAgentRun(tx, orgId, runId);
      if (isAgentRunTerminalStatus(current.status)) return current;
      const completedAt = new Date();
      const latencyMs = current.startedAt
        ? completedAt.getTime() - current.startedAt.getTime()
        : null;
      return applyAgentRunTerminalInTx(tx, {
        orgId,
        runId,
        status: "cancelled",
        title:
          rejectedPending > 0
            ? `任务已取消，并拒绝 ${rejectedPending} 个待确认动作`
            : "任务已取消",
        payload: { rejectedPending },
        data: {
          completedAt,
          cancelledAt: completedAt,
          latencyMs,
        },
      });
    });
  });
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
export function isAgentRunEventSequenceConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export const AGENT_RUN_EVENT_SEQUENCE_MAX_RETRIES = 8;

/**
 * Canonical bounded retry for AgentRunEvent @@unique([runId, sequence]).
 * Postgres aborts the interactive transaction on unique violation — retry
 * the WHOLE work() (a fresh $transaction), never catch P2002 inside the
 * already-aborted TX.
 *
 * ── P2002 与 40P01 的关系（刻意不合并处理）──
 * `P2002` = 唯一键冲突：两事务算出同一 sequence，后者插入失败。
 * `40P01` = 死锁：两事务互相等待对方的锁，PostgreSQL 主动杀掉其中一个。
 * 二者是不同故障，**不可用同一个 retry 掩盖**。
 *
 * 本次修复（per-run `FOR UPDATE` 序列化）解决的是 **lock correctness**：
 * 同一 run 的事件生产者被串行化后，序列号分配不再有并发窗口，
 * 因此 P2002 与 40P01 在同 run 路径上都不应再出现。
 *
 * 保留本 retry 的理由是**纵深防御**，不是修复手段：
 * 它仍覆盖非本模块路径（如历史数据/外部直写）可能残留的唯一冲突。
 * **刻意不把 40P01 加入 allowlist** —— 若死锁再次出现，那是锁协议被破坏的信号，
 * 必须让它冒出来被发现，而不是被静默重试掩盖。
 */
export async function withAgentRunEventSequenceRetry<T>(
  work: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (
        isAgentRunEventSequenceConflict(error) &&
        attempt < AGENT_RUN_EVENT_SEQUENCE_MAX_RETRIES
      ) {
        continue;
      }
      throw error;
    }
  }
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

    return await withAgentRunEventSequenceRetry(() =>
      db.$transaction((tx) => appendAgentRunEventInTx(tx, input)),
    );
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

export async function appendAgentRunEventInTx(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    runId: string;
    eventType: AgentRunEventType;
    title?: string;
    payload?: Record<string, unknown>;
    visibleToUser?: boolean;
  },
) {
  // CANONICAL LOCK ORDER（所有同 run 事件生产者必须一致）：
  //   ① AgentRun 行 FOR UPDATE  →  ② 定序 max(sequence)  →  ③ 建 AgentRunEvent  →  ④ 入 outbox
  // 修复前此处是**无锁**存在性读，导致 ②③ 之间存在并发窗口（多事务算出同一 sequence），
  // 且与 terminal 路径的显式 FOR UPDATE 形成锁强度/时序不一致 → 40P01。
  //
  // 幂等性：terminal 路径（applyAgentRunTerminalInTx）在外层已持有同一行的 FOR UPDATE，
  // 同一事务内重复取锁是 no-op，不会自锁、不改变既有 terminal 语义。
  const run = await lockAgentRunForAppend(tx, input.orgId, input.runId);
  if (!run) return null;

  const last = await tx.agentRunEvent.findFirst({
    where: { runId: input.runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  const created = await tx.agentRunEvent.create({
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
  await enqueueAutopilotTelemetryOutbox(tx, {
    orgId: input.orgId,
    agentRunId: input.runId,
    noticeType: "event",
    agentEventId: created.id,
    sequence,
    sourceEventType: input.eventType,
  });
  return created;
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
