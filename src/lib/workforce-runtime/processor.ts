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
import {
  appendAgentRunEvent,
  mergeAgentRunMetadata,
} from "@/lib/agent-runtime/run";
import { getRuntimeV2Limits } from "@/lib/agent-runtime-v2/flags";
import { PLAN_SOURCE } from "./server-plan";
import { WORKFORCE_TASK_CONTRACT_WRITE_VERSION } from "./task-contract";
import {
  claimRunLease,
  renewRunLease,
  fencedRunUpdate,
  createRunFence,
  LostLeaseError,
  type RunLeaseHandle,
} from "@/lib/agent-runtime/lease";
import { startLeaseHeartbeat } from "./lease-heartbeat";
import { plannerVisibleRuntimeV2Tools } from "@/lib/agent-runtime-v2/tool-catalog";
import {
  runtimeFromRunMetadata,
  runtimeContextToTelemetry,
} from "@/lib/ai/runtime-context";
import {
  WORKFORCE_JOB_RUN_TYPE,
  WORKFORCE_ACTIVE_STATUSES,
} from "./constants";
import { isWorkforceProcessingEnabled } from "./flags";

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
  // Kill-switch：总开关关闭时不 claim、不写任何状态；job 原状保留
  if (!isWorkforceProcessingEnabled()) return { claimed: false };

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
  // T5-P1 §9：心跳持有 holder——round 之间的显式续租只覆盖 round 边界，
  // 单个 round 内部的长 await（工具/synthesis）此前完全没有保活。
  // 心跳与防栅栏写入经 holder.runExclusive 互斥（见 lease-heartbeat.ts）。
  const heartbeat = startLeaseHeartbeat({
    lease: claim.lease,
    activeStatuses: ACTIVE_STATUSES,
  });
  const holder = heartbeat.holder;
  // BLOCKER 1：fence 传入 V2 执行路径——executor/verifier 的所有
  // AgentRun/AgentRunStep/AgentRunVerification 写入经原子防栅栏
  const fence = createRunFence(holder);
  try {
    return await runClaimedSlice();
  } finally {
    heartbeat.stop();
  }

  async function runClaimedSlice(): Promise<WorkforceSliceResult> {

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
      leaseExpiresAt: holder.lease.leaseExpiresAt.toISOString(),
      correlation,
    },
    visibleToUser: false,
  });

  // ── Phase 2B-2 Final Gate §4/§7：stale-running Task recovery ──
  // 唯一回收边界 = 本 processor 成功 acquire/reclaim Run lease 之后：
  // 此刻的 running Step 只能属于已失去租约的旧 worker（其迟到写入被
  // RunFence 阻断，零污染）。attemptCount < maxAttempts → fenced 回收为
  // ready（经 Step CAS 重新认领执行）；attemptCount >= maxAttempts →
  // 终态 failed，绝不再执行。普通 executor round 绝不做 running→ready
  // 重置——那会破坏 Step CAS 的 double-driver 第二道防线（P6b）。
  const staleRunning = await db.agentRunStep.findMany({
    where: { orgId, runId, status: "running" },
  });
  if (staleRunning.length > 0) {
    const recoverable = staleRunning.filter(
      (s) => s.attemptCount < s.maxAttempts,
    );
    const exhausted = staleRunning.filter(
      (s) => s.attemptCount >= s.maxAttempts,
    );
    if (recoverable.length > 0) {
      await fence.guard((tx) =>
        tx.agentRunStep.updateMany({
          where: {
            id: { in: recoverable.map((s) => s.id) },
            status: "running",
          },
          data: { status: "ready" },
        }),
      );
    }
    for (const s of exhausted) {
      await fence.guard((tx) =>
        tx.agentRunStep.updateMany({
          where: { id: s.id, status: "running" },
          data: {
            status: "failed",
            errorCode: "stale_running_exhausted",
            errorMessage:
              "旧 worker 遗留的执行已达重试预算上限，终止且不再重跑",
            completedAt: new Date(),
          },
        }),
      );
    }
  }

  // §5/§17–18：resume 必须重新走当前 membership 校验，
  // 禁止信任 metadata 中的历史角色/权限（复用 V2 principal 解析）
  const { resolveRuntimeV2Principal } = await import(
    "@/lib/agent-runtime-v2/principal"
  );
  const principal = await resolveRuntimeV2Principal({ orgId, runId });
  if (!principal.ok) {
    // BLOCKER 2：waiting human 是正常 park——重置 attempts（retry budget）
    const parked = await fencedRunUpdate({
      lease: holder.lease,
      allowedFromStatuses: ACTIVE_STATUSES,
      data: {
        status: "needs_human",
        errorCode: principal.code,
        errorMessage: principal.error,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        attempts: 0,
      },
    });
    if (parked) {
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "job.waiting_human",
        title: "执行主体身份失效，需要人工处理",
        payload: {
          code: principal.code,
          // Phase 2C-1（§18）：结构化人工要求，标注等待类型（可恢复）
          humanRequirement: { type: "PERMISSION_CHANGED", detail: principal.code },
          correlation,
        },
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
        // BLOCKER 1.6：终态转换本身必须 fenced 且检查结果——
        // fence 丢失（其他 worker 已接管）直接 LOST_LEASE，禁止 failAgentRun
        const failedWritten = await fencedRunUpdate({
          lease: holder.lease,
          allowedFromStatuses: ACTIVE_STATUSES,
          data: {
            status: "failed",
            errorCode: "db_error",
            errorMessage: "workforce_job 缺少 goal，无法规划",
            leaseExpiresAt: null,
            nextAttemptAt: null,
            completedAt: new Date(),
          },
        });
        if (!failedWritten) {
          return { claimed: true, status: "lost_lease", lostLease: true };
        }
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
      const { workforceWorkerRosterForPlanner } = await import("./workers");
      // T1B（§12）：按 workDomain 解析规划期工具白名单（规划输入选择，
      // 非执行语义）。无 workDomain / 未注册域 → undefined → 既有默认
      // 投影，行为不变。
      const { resolveWorkforcePlannerToolsForJob } = await import("./scope");
      const scopedTools = await resolveWorkforcePlannerToolsForJob(meta);
      const planned = await planAgentRuntimeV2({
        orgId,
        userId: principal.userId,
        userRole: principal.role,
        channel: runtime.channel ?? "workforce",
        goal,
        availableTools: scopedTools,
        // Phase 2B-1（§10）：planner 只能从 server-owned 名单"提议" workerKey
        workerRoster: workforceWorkerRosterForPlanner(),
      });
      if (!planned.ok) {
        if (planned.clarification) {
          const parked = await fencedRunUpdate({
            lease: holder.lease,
            allowedFromStatuses: ACTIVE_STATUSES,
            data: {
              status: "needs_human",
              // 持久化等待原因（FIX 2）：manual resume 白名单据此 fail-closed
              errorCode: "clarification_required",
              errorMessage: planned.clarification.slice(0, 2000),
              leaseExpiresAt: null,
              nextAttemptAt: null,
              attempts: 0,
            },
          });
          if (parked) {
            await appendAgentRunEvent({
              orgId,
              runId,
              eventType: "job.waiting_human",
              title: "需要补充信息后继续",
              payload: {
                clarification: planned.clarification,
                humanRequirement: {
                  type: "CLARIFICATION_REQUIRED",
                  detail: planned.clarification.slice(0, 500),
                },
                correlation,
              },
              visibleToUser: true,
            });
          }
          return { claimed: true, status: "needs_human", lostLease: !parked };
        }
        throw new Error(planned.error);
      }

      // Phase 2B-1（§10–§12）：LLM proposed workerKey → server registry
      // validation → sanitized assignment。unknown workerKey / 非法 taskKind
      // → FAIL VALIDATION，走现有 planner failure path（throw → 退避重试，
      // 重规划或 attempts 耗尽 failed；planJson 未持久化，不产生半成品计划）。
      // T5-P0A §4：LLM 计划与 server-authored 计划共用同一条验证链
      // （compileWorkforcePlan = Zod/工具白名单 → DAG 结构 → task spec）。
      // 绝不允许两侧各写一套标准；本轮为该链补上依赖闭包/环检测，
      // LLM 路径同样受益（此前悬空依赖只会在 executor 表现为 blocked_graph 卡死）。
      const { compileWorkforcePlan } = await import("./plan-compile");
      const compiledPlan = compileWorkforcePlan({
        raw: planned.plan,
        // 工具白名单必须与 planner **实际使用**的投影一致：
        // resolveWorkforcePlannerToolsForJob 对非 tender 域返回 undefined
        // （fail-safe：planner 自己回落 plannerVisibleRuntimeV2Tools），
        // 这里若传空数组，sanitizePlannerOutput 会把每个 preferredTool 当作
        // 越权工具剥掉 → 所有步骤以 no_tool「步骤未指定工具」失败。
        tools: scopedTools ?? plannerVisibleRuntimeV2Tools(),
        maxSteps: getRuntimeV2Limits().maxSteps,
      });
      if (!compiledPlan.ok) {
        throw new Error(`${compiledPlan.code}: ${compiledPlan.error}`);
      }
      const adapted = { plan: compiledPlan.compiled.plan };

      // §5/§28：计划来源可观测（LLM 路径显式标记；server 路径在 job.ts 写入）
      await mergeAgentRunMetadata(orgId, runId, {
        planSource: PLAN_SOURCE.LLM_PLANNER,
        taskContractVersion: WORKFORCE_TASK_CONTRACT_WRITE_VERSION,
        planTaskCount: compiledPlan.compiled.taskCount,
        // T5 §G 最小可观测：planner 的模型调用次数（template 计划为 0）。
        // 只做计数标注，不改动任何计费语义（AiUsageLedger 不受影响）。
        plannerLlmCalls: planned.source === "model" ? 1 : 0,
      }).catch(() => {});

      // §10 + BLOCKER 1：planner（长 await）之后、persist 之前重新验证租约
      const renewedAfterPlan = await renewRunLease({
        lease: holder.lease,
        activeStatuses: ACTIVE_STATUSES,
      });
      if (!renewedAfterPlan.ok) {
        return { claimed: true, status: "lost_lease", lostLease: true };
      }
      holder.lease = renewedAfterPlan.lease;

      const { persistPlanAndSteps } = await import(
        "@/lib/agent-runtime-v2/persist"
      );
      // Final BLOCKER 修复：persist 经 RunFence——token 断言（AgentRun 行锁）
      // 与 planJson/status/steps 创建在同一事务 commit。不再依赖
      // "刚 renew 过所以安全"：renew 与 persist 之间若租约易主，
      // fence.guard 抛 LostLeaseError，零写入、不发 plan.created。
      await persistPlanAndSteps({ orgId, runId, plan: adapted.plan, fence });
    }

    const { processAgentRuntimeV2Run } = await import(
      "@/lib/agent-runtime-v2/process"
    );

    for (let round = 0; round < maxRounds; round++) {
      // per-slice 时间预算：超出即交还队列，绝不因 Job 年龄判失败
      if (Date.now() - processingStartedAt > sliceBudgetMs) break;

      // §10：每个 V2 round 前续租（fenced）；失败=租约被接管，立即放弃
      const renewed = await renewRunLease({
        lease: holder.lease,
        activeStatuses: ACTIVE_STATUSES,
      });
      if (!renewed.ok) {
        return { claimed: true, status: "lost_lease", lostLease: true };
      }
      holder.lease = renewed.lease;
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "job.lease_renewed",
        title: "租约续期",
        payload: {
          leaseExpiresAt: holder.lease.leaseExpiresAt.toISOString(),
          round,
          correlation,
        },
        visibleToUser: false,
      });

      // BLOCKER 1：fence 随 V2 执行路径下传——executor tool 长 await 后、
      // verifier model call 后、所有 run/step/verification 写入均被防栅栏
      const result = await processAgentRuntimeV2Run({
        orgId,
        runId,
        userId: principal.userId,
        role: principal.role,
        threadId: runtime.threadId ?? null,
        maxRounds: 1,
        fence,
      });

      // fence 丢失（V2 内部检测）：本 worker 未写入任何状态，立即放弃
      if (result.status === "lost_lease") {
        return { claimed: true, status: "lost_lease", lostLease: true };
      }

      if (
        result.status === "completed" ||
        result.status === "partially_executed"
      ) {
        const cleaned = await fencedRunUpdate({
          lease: holder.lease,
          data: { leaseExpiresAt: null, nextAttemptAt: null },
        });
        if (cleaned) {
          await appendAgentRunEvent({
            orgId,
            runId,
            eventType: "job.completed",
            title: "Workforce Job 已完成",
            payload: { status: result.status, correlation },
            visibleToUser: true,
          });
        }
        return {
          claimed: true,
          status: result.status,
          report: result.report,
          lostLease: !cleaned,
        };
      }

      if (result.status === "failed" || result.status === "cancelled") {
        const cleaned = await fencedRunUpdate({
          lease: holder.lease,
          data: { leaseExpiresAt: null, nextAttemptAt: null },
        });
        if (cleaned && result.status === "failed") {
          await appendAgentRunEvent({
            orgId,
            runId,
            eventType: "job.failed",
            title: "Workforce Job 失败",
            payload: { report: result.report, correlation },
            visibleToUser: true,
          });
        }
        return {
          claimed: true,
          status: result.status,
          report: result.report,
          lostLease: !cleaned,
        };
      }

      if (
        result.status === "awaiting_approval" ||
        result.status === "needs_human"
      ) {
        // BLOCKER 2：waiting human 是"有效进展"——重置 attempts
        const parked = await fencedRunUpdate({
          lease: holder.lease,
          data: { leaseExpiresAt: null, nextAttemptAt: null, attempts: 0 },
        });
        if (parked) {
          await appendAgentRunEvent({
            orgId,
            runId,
            eventType: "job.waiting_human",
            title:
              result.status === "awaiting_approval"
                ? "等待审批后继续"
                : "需要人工处理",
            payload: {
              status: result.status,
              // Phase 2C-1（§18）：结构化人工要求（审批 / 冲突需人裁决）
              humanRequirement: {
                type:
                  result.status === "awaiting_approval"
                    ? "APPROVAL_REQUIRED"
                    : "CONFLICT_REQUIRES_HUMAN",
              },
              correlation,
            },
            visibleToUser: true,
          });
        }
        return {
          claimed: true,
          status: result.status,
          report: result.report,
          lostLease: !parked,
        };
      }
      // 其余（executing/planned/verifying/repairing 等）：继续下一轮
    }

    // 时间片/轮次用尽但仍可继续 → fenced 交还队列（checkpoint 已由 V2 每轮持久化）
    // BLOCKER 2：正常 continuation 是"有效进展"——重置 attempts。
    // attempts = consecutive retry/crash/recovery budget，不是 total slices：
    // 正常长 Job 可推进任意多个 slice；crash reclaim / retryable failure
    // 不走本分支，attempts 继续累计。
    const requeued = await fencedRunUpdate({
      lease: holder.lease,
      allowedFromStatuses: ACTIVE_STATUSES,
      data: {
        status: "queued",
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + CONTINUATION_DELAY_MS),
        attempts: 0,
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
    // fence 丢失（如 persistPlanAndSteps 的 fenced path）≠ retryable failure：
    // 本 worker 零写入，新 worker 已接管，不消耗 attempts、不 requeue
    if (error instanceof LostLeaseError) {
      return { claimed: true, status: "lost_lease", lostLease: true };
    }
    const latest = await db.agentRun.findUnique({
      where: { id: runId },
      select: { attempts: true },
    });
    return requeueWorkforceJobAfterError({
      orgId,
      runId,
      lease: holder.lease,
      attempts: latest?.attempts ?? run.attempts,
      maxAttempts: WORKFORCE_MAX_ATTEMPTS,
      error,
    });
  }
  }
}

/** cron / worker 批量消费（§13） */
export async function processQueuedWorkforceJobs(limit = 2): Promise<{
  processed: number;
  runIds: string[];
  exhaustedFailed: number;
}> {
  // Kill-switch：总开关关闭 → 整体暂停消费（含 exhausted 清扫）。
  // 已排队 job 保持 queued 原状，不失败、不清理、不改状态；开关恢复后继续。
  if (!isWorkforceProcessingEnabled()) {
    return { processed: 0, runIds: [], exhaustedFailed: 0 };
  }

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
