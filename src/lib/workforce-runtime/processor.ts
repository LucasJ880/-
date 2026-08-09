/**
 * Workforce Job durable processor（Phase 2A §13–14）
 *
 * find eligible → 原子 claim → runtimeFromRunMetadata 恢复身份 →
 * 重新校验 execution principal（当前 membership，非 metadata 快照）→
 * bounded V2 rounds（每轮前续租；复用 processAgentRuntimeV2Run，勿重写
 * Planner/Executor/Verifier）→ still runnable 则 queued+nextAttemptAt /
 * waiting human 则 awaiting_approval|needs_human / complete 则 completed /
 * retryable 则 queued+backoff / exhausted 则 failed。
 *
 * Timeout 语义（§12）：per-slice（processingStartedAt 于本次调用内），
 * 不使用也不重置 Job.startedAt；executor 已对 workforce_job 跳过
 * startedAt 全局超时。
 */

import { db } from "@/lib/db";
import { appendAgentRunEvent, failAgentRun } from "@/lib/agent-runtime/run";
import {
  claimRunLease,
  renewRunLease,
  fencedRunUpdate,
  type RunLeaseHandle,
} from "@/lib/agent-runtime/lease";
import {
  runtimeFromRunMetadata,
  runtimeContextToTelemetry,
} from "@/lib/ai/runtime-context";
import {
  WORKFORCE_JOB_RUN_TYPE,
  WORKFORCE_ACTIVE_STATUSES,
} from "./constants";

export const WORKFORCE_LEASE_MS = 3 * 60_000;
export const WORKFORCE_MAX_ATTEMPTS = 5;
/** 单 slice 时间预算（严格小于租约；配合每轮续租） */
export const WORKFORCE_SLICE_BUDGET_MS = 45_000;
/** 单 slice 最多推进的 V2 round 数（禁止 while(true)） */
export const WORKFORCE_MAX_ROUNDS_PER_SLICE = 6;
const RETRY_BACKOFF_MS = [15_000, 60_000, 180_000, 600_000];
const CONTINUATION_DELAY_MS = 2_000;

const ACTIVE_STATUSES = [...WORKFORCE_ACTIVE_STATUSES];

export type WorkforceSliceResult =
  | { claimed: false }
  | {
      claimed: true;
      status: string;
      report?: string;
      lostLease?: boolean;
      retryScheduled?: boolean;
    };

function backoffMs(attempts: number): number {
  const idx = Math.max(0, Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1));
  return RETRY_BACKOFF_MS[idx] ?? 60_000;
}

function metaOf(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

/** retryable 失败：fenced 回队 + backoff；attempts 耗尽 → failed */
async function requeueWorkforceJobAfterError(input: {
  orgId: string;
  runId: string;
  lease: RunLeaseHandle;
  /** claim 后的 attempts（已递增） */
  attempts: number;
  maxAttempts: number;
  error: unknown;
}): Promise<WorkforceSliceResult> {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);
  const exhausted = input.attempts >= input.maxAttempts;

  if (exhausted) {
    const done = await fencedRunUpdate({
      lease: input.lease,
      allowedFromStatuses: ACTIVE_STATUSES,
      data: {
        status: "failed",
        errorCode: "model_failed",
        errorMessage: message.slice(0, 2000),
        leaseExpiresAt: null,
        nextAttemptAt: null,
        completedAt: new Date(),
      },
    });
    if (done) {
      await appendAgentRunEvent({
        orgId: input.orgId,
        runId: input.runId,
        eventType: "job.failed",
        title: "Workforce Job 失败（重试次数耗尽）",
        payload: { attempts: input.attempts, exhausted: true },
        visibleToUser: true,
      });
    }
    return { claimed: true, status: "failed", lostLease: !done };
  }

  const requeued = await fencedRunUpdate({
    lease: input.lease,
    allowedFromStatuses: ACTIVE_STATUSES,
    data: {
      status: "queued",
      leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() + backoffMs(input.attempts)),
      errorCode: "model_failed",
      errorMessage: message.slice(0, 2000),
    },
  });
  if (requeued) {
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "job.queued",
      title: "Workforce Job 失败重试排队",
      payload: { retry: true, attempts: input.attempts },
      visibleToUser: false,
    });
  }
  return {
    claimed: true,
    status: "queued",
    retryScheduled: requeued,
    lostLease: !requeued,
  };
}

/**
 * 认领并推进单个 workforce_job 一个 slice。
 * 并发安全：claim 原子（最多一个 worker 成功）；slice 内每轮续租（fenced），
 * 续租失败立即放弃且不再写入任何状态。
 */
export async function processWorkforceJobSlice(
  runId: string,
  opts?: { sliceBudgetMs?: number; maxRounds?: number; leaseMs?: number },
): Promise<WorkforceSliceResult> {
  const leaseMs = opts?.leaseMs ?? WORKFORCE_LEASE_MS;
  const claim = await claimRunLease({
    runId,
    allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
    leaseMs,
    maxAttempts: WORKFORCE_MAX_ATTEMPTS,
    reclaimableStatuses: ACTIVE_STATUSES,
    // §12：不重置 Job.startedAt；错误信息保留供审计
    resetStartedAt: false,
    clearError: false,
  });
  if (!claim.ok) return { claimed: false };
  let lease = claim.lease;

  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const orgId = run.orgId;
  const meta = metaOf(run.metadata);

  // §5：从行 + metadata 恢复受信 correlation（identity，非授权快照）
  const runtime = runtimeFromRunMetadata(run);
  const correlation = runtimeContextToTelemetry(runtime);

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "job.claimed",
    title: "Workforce Job 已认领",
    payload: {
      attempts: run.attempts,
      leaseExpiresAt: lease.leaseExpiresAt.toISOString(),
      correlation,
    },
    visibleToUser: false,
  });

  // §5/§17–18：resume 必须重新走当前 membership 校验，
  // 禁止信任 metadata 中的历史角色/权限（复用 V2 principal 解析）
  const { resolveRuntimeV2Principal } = await import(
    "@/lib/agent-runtime-v2/principal"
  );
  const principal = await resolveRuntimeV2Principal({ orgId, runId });
  if (!principal.ok) {
    const parked = await fencedRunUpdate({
      lease,
      allowedFromStatuses: ACTIVE_STATUSES,
      data: {
        status: "needs_human",
        errorCode: principal.code,
        errorMessage: principal.error,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    if (parked) {
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "job.waiting_human",
        title: "执行主体身份失效，需要人工处理",
        payload: { code: principal.code, correlation },
        visibleToUser: true,
      });
    }
    return { claimed: true, status: "needs_human", lostLease: !parked };
  }

  // §12：per-slice timeout —— 只看本次调用的耗时，与 Job 年龄无关
  const processingStartedAt = Date.now();
  const sliceBudgetMs = opts?.sliceBudgetMs ?? WORKFORCE_SLICE_BUDGET_MS;
  const maxRounds = opts?.maxRounds ?? WORKFORCE_MAX_ROUNDS_PER_SLICE;

  try {
    // 首个 slice：规划（planner 只产出计划，不执行工具）
    if (!run.planJson) {
      const goal = typeof meta.goal === "string" ? meta.goal.trim() : "";
      if (!goal) {
        await fencedRunUpdate({
          lease,
          allowedFromStatuses: ACTIVE_STATUSES,
          data: { leaseExpiresAt: null, nextAttemptAt: null },
        });
        await failAgentRun(orgId, runId, {
          code: "db_error",
          message: "workforce_job 缺少 goal，无法规划",
        });
        await appendAgentRunEvent({
          orgId,
          runId,
          eventType: "job.failed",
          title: "Workforce Job 失败（缺少 goal）",
          payload: { correlation },
          visibleToUser: true,
        });
        return { claimed: true, status: "failed" };
      }

      const { planAgentRuntimeV2 } = await import(
        "@/lib/agent-runtime-v2/planner"
      );
      const planned = await planAgentRuntimeV2({
        orgId,
        userId: principal.userId,
        userRole: principal.role,
        channel: runtime.channel ?? "workforce",
        goal,
      });
      if (!planned.ok) {
        if (planned.clarification) {
          const parked = await fencedRunUpdate({
            lease,
            allowedFromStatuses: ACTIVE_STATUSES,
            data: {
              status: "needs_human",
              errorMessage: planned.clarification.slice(0, 2000),
              leaseExpiresAt: null,
              nextAttemptAt: null,
            },
          });
          if (parked) {
            await appendAgentRunEvent({
              orgId,
              runId,
              eventType: "job.waiting_human",
              title: "需要补充信息后继续",
              payload: { clarification: planned.clarification, correlation },
              visibleToUser: true,
            });
          }
          return { claimed: true, status: "needs_human", lostLease: !parked };
        }
        throw new Error(planned.error);
      }

      const renewedAfterPlan = await renewRunLease({
        lease,
        activeStatuses: ACTIVE_STATUSES,
      });
      if (!renewedAfterPlan.ok) {
        return { claimed: true, status: "lost_lease", lostLease: true };
      }
      lease = renewedAfterPlan.lease;

      const { persistPlanAndSteps } = await import(
        "@/lib/agent-runtime-v2/persist"
      );
      await persistPlanAndSteps({ orgId, runId, plan: planned.plan });
    }

    const { processAgentRuntimeV2Run } = await import(
      "@/lib/agent-runtime-v2/process"
    );

    for (let round = 0; round < maxRounds; round++) {
      // per-slice 时间预算：超出即交还队列，绝不因 Job 年龄判失败
      if (Date.now() - processingStartedAt > sliceBudgetMs) break;

      // §10：每个 V2 round 前续租（fenced）；失败=租约被接管，立即放弃
      const renewed = await renewRunLease({
        lease,
        activeStatuses: ACTIVE_STATUSES,
      });
      if (!renewed.ok) {
        return { claimed: true, status: "lost_lease", lostLease: true };
      }
      lease = renewed.lease;
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "job.lease_renewed",
        title: "租约续期",
        payload: {
          leaseExpiresAt: lease.leaseExpiresAt.toISOString(),
          round,
          correlation,
        },
        visibleToUser: false,
      });

      const result = await processAgentRuntimeV2Run({
        orgId,
        runId,
        userId: principal.userId,
        role: principal.role,
        threadId: runtime.threadId ?? null,
        maxRounds: 1,
      });

      if (
        result.status === "completed" ||
        result.status === "partially_executed"
      ) {
        await fencedRunUpdate({
          lease,
          data: { leaseExpiresAt: null, nextAttemptAt: null },
        });
        await appendAgentRunEvent({
          orgId,
          runId,
          eventType: "job.completed",
          title: "Workforce Job 已完成",
          payload: { status: result.status, correlation },
          visibleToUser: true,
        });
        return { claimed: true, status: result.status, report: result.report };
      }

      if (result.status === "failed" || result.status === "cancelled") {
        await fencedRunUpdate({
          lease,
          data: { leaseExpiresAt: null, nextAttemptAt: null },
        });
        if (result.status === "failed") {
          await appendAgentRunEvent({
            orgId,
            runId,
            eventType: "job.failed",
            title: "Workforce Job 失败",
            payload: { report: result.report, correlation },
            visibleToUser: true,
          });
        }
        return { claimed: true, status: result.status, report: result.report };
      }

      if (
        result.status === "awaiting_approval" ||
        result.status === "needs_human"
      ) {
        await fencedRunUpdate({
          lease,
          data: { leaseExpiresAt: null, nextAttemptAt: null },
        });
        await appendAgentRunEvent({
          orgId,
          runId,
          eventType: "job.waiting_human",
          title:
            result.status === "awaiting_approval"
              ? "等待审批后继续"
              : "需要人工处理",
          payload: { status: result.status, correlation },
          visibleToUser: true,
        });
        return { claimed: true, status: result.status, report: result.report };
      }
      // 其余（executing/planned/verifying/repairing 等）：继续下一轮
    }

    // 时间片/轮次用尽但仍可继续 → fenced 交还队列（checkpoint 已由 V2 每轮持久化）
    const requeued = await fencedRunUpdate({
      lease,
      allowedFromStatuses: ACTIVE_STATUSES,
      data: {
        status: "queued",
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + CONTINUATION_DELAY_MS),
      },
    });
    if (requeued) {
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "job.queued",
        title: "本时间片结束，交还队列继续",
        payload: { continuation: true, correlation },
        visibleToUser: false,
      });
    }
    return { claimed: true, status: "queued", lostLease: !requeued };
  } catch (error) {
    const latest = await db.agentRun.findUnique({
      where: { id: runId },
      select: { attempts: true },
    });
    return requeueWorkforceJobAfterError({
      orgId,
      runId,
      lease,
      attempts: latest?.attempts ?? run.attempts,
      maxAttempts: WORKFORCE_MAX_ATTEMPTS,
      error,
    });
  }
}

/** cron / worker 批量消费（§13） */
export async function processQueuedWorkforceJobs(limit = 2): Promise<{
  processed: number;
  runIds: string[];
  exhaustedFailed: number;
}> {
  const now = new Date();

  // 租约过期且尝试耗尽 → failed（不再被认领）
  const exhausted = await db.agentRun.findMany({
    where: {
      runType: WORKFORCE_JOB_RUN_TYPE,
      status: { in: ACTIVE_STATUSES },
      attempts: { gte: WORKFORCE_MAX_ATTEMPTS },
      leaseExpiresAt: { lte: now },
    },
    select: { id: true, orgId: true },
  });
  if (exhausted.length > 0) {
    await db.agentRun.updateMany({
      where: {
        id: { in: exhausted.map((r) => r.id) },
        runType: WORKFORCE_JOB_RUN_TYPE,
        status: { in: ACTIVE_STATUSES },
        attempts: { gte: WORKFORCE_MAX_ATTEMPTS },
        leaseExpiresAt: { lte: now },
      },
      data: {
        status: "failed",
        errorCode: "external_timeout",
        errorMessage: "Workforce Job 租约超时且已达最大尝试次数",
        leaseExpiresAt: null,
        nextAttemptAt: null,
        completedAt: now,
      },
    });
    for (const r of exhausted) {
      await appendAgentRunEvent({
        orgId: r.orgId,
        runId: r.id,
        eventType: "job.failed",
        title: "Workforce Job 失败（超时且重试耗尽）",
        payload: { exhausted: true },
        visibleToUser: true,
      });
    }
  }

  const eligible = await db.agentRun.findMany({
    where: {
      runType: WORKFORCE_JOB_RUN_TYPE,
      attempts: { lt: WORKFORCE_MAX_ATTEMPTS },
      OR: [
        {
          status: "queued",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: { in: ACTIVE_STATUSES },
          leaseExpiresAt: { lte: now },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 5)),
    select: { id: true },
  });

  let processed = 0;
  for (const r of eligible) {
    const result = await processWorkforceJobSlice(r.id);
    if (result.claimed) processed++;
  }
  return {
    processed,
    runIds: eligible.map((r) => r.id),
    exhaustedFailed: exhausted.length,
  };
}
