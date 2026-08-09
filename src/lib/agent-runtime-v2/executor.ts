import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import { markAgentRunAwaitingApproval } from "@/lib/agent-runtime/pending-link";
import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import {
  fenceGuardedWrite,
  LostLeaseError,
  type RunFence,
} from "@/lib/agent-runtime/lease";
import { executeRuntimeV2Tool } from "./adapters";
import { emitRuntimeV2Event } from "./events";
import { getRuntimeV2Limits } from "./flags";
import { buildStepOperationKey } from "./idempotency";
import { getRuntimeV2Tool } from "./tool-catalog";
import { refreshReadySteps } from "./persist";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export type ExecuteRoundResult =
  | { status: "continued" }
  | { status: "awaiting_approval" }
  | { status: "ready_for_verification" }
  | { status: "failed"; error: string }
  | { status: "cancelled" }
  /** fence 丢失（租约被其他 worker 接管）：本 worker 未写入任何状态，必须立即放弃 */
  | { status: "lost_lease" };

function asEvidenceMap(
  steps: Array<{ stepKey: string; outputJson: unknown }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of steps) {
    if (s.outputJson && typeof s.outputJson === "object") {
      out[s.stepKey] = s.outputJson;
    }
  }
  return out;
}

/**
 * 每轮只执行一个 ready step（parallelism=1），持久化后返回。
 *
 * fence（可选，Phase 2A Final）：workforce_job 由 processor 传入 RunFence，
 * 所有 AgentRun / AgentRunStep 状态写入经原子防栅栏；fence 丢失返回
 * lost_lease 且不写任何状态。不传 fence 时（legacy runtime_v2）行为不变。
 */
export async function executeRuntimeV2Round(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string;
  threadId?: string | null;
  fence?: RunFence;
}): Promise<ExecuteRoundResult> {
  try {
    return await executeRoundGuarded(input);
  } catch (err) {
    if (err instanceof LostLeaseError) return { status: "lost_lease" };
    throw err;
  }
}

async function executeRoundGuarded(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string;
  threadId?: string | null;
  fence?: RunFence;
}): Promise<ExecuteRoundResult> {
  const { orgId, runId, userId, role, fence } = input;
  const limits = getRuntimeV2Limits();

  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId, runtimeVersion: "v2" },
  });
  if (!run) return { status: "failed", error: "Run not found" };
  const meta = (run.metadata ?? {}) as Record<string, unknown>;
  const threadId =
    input.threadId ??
    (typeof meta.threadId === "string" ? meta.threadId : null);
  const assistantMessageId =
    typeof meta.assistantMessageId === "string"
      ? meta.assistantMessageId
      : null;
  if (run.status === "cancelled") return { status: "cancelled" };
  if (run.status === "awaiting_approval") return { status: "awaiting_approval" };

  // 超时（Phase 2A：durable workforce_job 不使用 run.startedAt 作为单次执行
  // timeout——Job 可能已存活数小时（等审批/多 slice），改由 workforce processor
  // 在每个 slice 内用 processingStartedAt 控制 per-slice 时间预算）
  const isDurableWorkforceJob = run.runType === WORKFORCE_JOB_RUN_TYPE;
  if (!isDurableWorkforceJob && run.startedAt) {
    const elapsed = Date.now() - run.startedAt.getTime();
    if (elapsed > limits.timeoutMs) {
      await fenceGuardedWrite(fence, (c) =>
        c.agentRun.update({
          where: { id: runId },
          data: { status: "failed", errorCode: "external_timeout", errorMessage: "Runtime V2 timeout" },
        }),
      );
      await emitRuntimeV2Event({
        orgId,
        runId,
        eventType: "run.failed",
        title: "运行超时",
      });
      return { status: "failed", error: "timeout" };
    }
  }

  const membership = await getOrgMembership(userId, orgId);
  if (!membership || membership.status !== "active") {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.update({
        where: { id: runId },
        data: {
          status: "needs_human",
          errorCode: "org_forbidden",
          errorMessage: "无企业成员身份，停止执行",
        },
      }),
    );
    return { status: "failed", error: "no_membership" };
  }

  await refreshReadySteps(orgId, runId, fence);

  const steps = await db.agentRunStep.findMany({ where: { orgId, runId } });
  const toolCalls = steps.reduce((n, s) => n + s.attemptCount, 0);
  if (toolCalls >= limits.maxToolCalls) {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.update({
        where: { id: runId },
        data: { status: "needs_human", errorMessage: "超过最大工具调用次数" },
      }),
    );
    return { status: "failed", error: "max_tool_calls" };
  }

  const ready = steps
    .filter((s) => s.status === "ready")
    .slice(0, limits.parallelism);

  if (ready.length === 0) {
    const awaiting = steps.some((s) => s.status === "awaiting_approval");
    if (awaiting) {
      await fenceGuardedWrite(fence, (c) =>
        c.agentRun.update({
          where: { id: runId },
          data: { status: "awaiting_approval" },
        }),
      );
      return { status: "awaiting_approval" };
    }
    const pending = steps.some(
      (s) => s.status === "pending" || s.status === "running",
    );
    if (pending) {
      // 依赖未满足但仍有 pending — 可能死锁
      const blocked = steps.filter((s) => s.status === "pending");
      if (blocked.length > 0 && !steps.some((s) => s.status === "ready")) {
        await fenceGuardedWrite(fence, (c) =>
          c.agentRun.update({
            where: { id: runId },
            data: {
              status: "needs_human",
              errorMessage: "步骤依赖无法推进",
            },
          }),
        );
        return { status: "failed", error: "blocked_graph" };
      }
      return { status: "continued" };
    }
    const failed = steps.some((s) => s.status === "failed");
    if (failed) {
      return { status: "ready_for_verification" };
    }
    return { status: "ready_for_verification" };
  }

  await fenceGuardedWrite(fence, (c) =>
    c.agentRun.update({
      where: { id: runId },
      data: { status: "executing", startedAt: run.startedAt ?? new Date() },
    }),
  );

  const step = ready[0];
  const toolName = step.preferredTool;
  if (!toolName) {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRunStep.update({
        where: { id: step.id },
        data: {
          status: "failed",
          errorCode: "no_tool",
          errorMessage: "步骤未指定工具",
          completedAt: new Date(),
        },
      }),
    );
    return { status: "continued" };
  }

  const descriptor = getRuntimeV2Tool(toolName);
  // 重新鉴权（写工具按 high risk 检查 membership + 模块）
  const decision = canInvokeTool({
    tenant: {
      userId,
      orgId,
      orgRole:
        membership.role === "org_owner" ? "org_admin" : membership.role,
      isPlatformAdmin: role === "admin" || role === "super_admin",
    },
    hasMembership: true,
    tool: {
      name: toolName,
      domain: "sales",
      risk: descriptor?.requiresApproval ? "l2_soft" : "l0_read",
      allowRoles: ["admin", "sales"],
    },
    modulesJson: undefined,
    maxRisk: "l2_soft",
  });
  if (!decision.ok) {
    await fenceGuardedWrite(fence, async (c) => {
      await c.agentRunStep.update({
        where: { id: step.id },
        data: {
          status: "failed",
          errorCode: decision.code,
          errorMessage: decision.error,
          completedAt: new Date(),
        },
      });
      await c.agentRun.update({
        where: { id: runId },
        data: {
          status: "needs_human",
          errorCode: decision.code,
          errorMessage: decision.error,
        },
      });
    });
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "run.needs_human",
      title: "权限变化，需要人工处理",
      payload: { stepKey: step.stepKey, error: decision.error },
    });
    return { status: "failed", error: decision.error };
  }

  const attempt = step.attemptCount + 1;
  // 业务幂等不含 attempt；Step 表仅记录稳定 operationKey 供审计
  const operationKey = buildStepOperationKey({
    runId,
    stepKey: step.stepKey,
    toolName,
  });

  await fenceGuardedWrite(fence, (c) =>
    c.agentRunStep.update({
      where: { id: step.id },
      data: {
        status: "running",
        attemptCount: attempt,
        idempotencyKey: operationKey,
        startedAt: new Date(),
      },
    }),
  );
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "step.started",
    title: step.title,
    payload: { stepKey: step.stepKey, toolName, attempt, operationKey },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "tool.started",
    title: toolName,
    payload: { stepKey: step.stepKey, operationKey },
  });

  const priorEvidence = asEvidenceMap(steps);
  let result;
  try {
    result = await executeRuntimeV2Tool(toolName, {
      orgId,
      userId,
      role,
      runId,
      threadId,
      assistantMessageId,
      stepKey: step.stepKey,
      operationKey,
      priorEvidence,
    });
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 关键 fence 检查点（Phase 2A Final BLOCKER 1）──
  // executeRuntimeV2Tool 是潜在长 await：期间租约可能过期并被其他 worker
  // 接管。工具返回后、任何 state mutation 之前重新验证 lease ownership；
  // fence 丢失立即 LOST_LEASE，下面所有写入均不会发生（guard 内还有原子断言，
  // 此处先行探测避免 stale 事件写入）。
  if (fence && !(await fence.check())) {
    throw new LostLeaseError(runId);
  }

  if (!result.ok) {
    const canRetry = attempt < step.maxAttempts;
    await fenceGuardedWrite(fence, (c) =>
      c.agentRunStep.update({
        where: { id: step.id },
        data: canRetry
          ? { status: "ready", errorMessage: result.error }
          : {
              status: "failed",
              errorCode: "tool_failed",
              errorMessage: result.error,
              completedAt: new Date(),
            },
      }),
    );
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "tool.failed",
      title: toolName,
      payload: { stepKey: step.stepKey, error: result.error, attempt },
    });
    return { status: "continued" };
  }

  if (result.requiresApproval || step.requiresApproval) {
    const pendingIds =
      (result.data?.pendingActionIds as string[] | undefined) ??
      (result.pendingActionId ? [result.pendingActionId] : []);
    await fenceGuardedWrite(fence, (c) =>
      c.agentRunStep.update({
        where: { id: step.id },
        data: {
          status: "awaiting_approval",
          outputJson: jsonValue(result.data ?? {}),
          evidenceJson: jsonValue({
            pendingActionIds: pendingIds,
            skipped: result.data?.skipped === true,
          }),
          pendingActionId: result.pendingActionId ?? pendingIds[0] ?? null,
        },
      }),
    );
    if (result.data?.skipped) {
      // 无可写对象：视为完成跳过
      await fenceGuardedWrite(fence, (c) =>
        c.agentRunStep.update({
          where: { id: step.id },
          data: { status: "skipped", completedAt: new Date() },
        }),
      );
      await emitRuntimeV2Event({
        orgId,
        runId,
        eventType: "step.completed",
        title: `${step.title}（跳过）`,
        payload: { stepKey: step.stepKey, skipped: true },
      });
      return { status: "continued" };
    }
    if (fence) {
      // approval transition 必须 fenced：等价 markAgentRunAwaitingApproval，
      // 但状态写入在防栅栏事务内（终态 run 不覆盖）
      await fence.guard((tx) =>
        tx.agentRun.updateMany({
          where: {
            id: runId,
            status: { notIn: ["cancelled", "failed", "completed"] },
          },
          data: { status: "awaiting_approval" },
        }),
      );
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "approval.required",
        title: "等待你确认待审批动作",
        visibleToUser: true,
      });
    } else {
      await markAgentRunAwaitingApproval(orgId, runId);
    }
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "approval.required",
      title: "等待你确认动作",
      payload: { stepKey: step.stepKey, pendingActionIds: pendingIds },
    });
    return { status: "awaiting_approval" };
  }

  await fenceGuardedWrite(fence, (c) =>
    c.agentRunStep.update({
      where: { id: step.id },
      data: {
        status: "completed",
        outputJson: jsonValue(result.data ?? {}),
        evidenceJson: jsonValue({ toolName, ok: true }),
        completedAt: new Date(),
      },
    }),
  );
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "tool.completed",
    title: toolName,
    payload: { stepKey: step.stepKey },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "step.completed",
    title: step.title,
    payload: { stepKey: step.stepKey },
  });

  return { status: "continued" };
}
