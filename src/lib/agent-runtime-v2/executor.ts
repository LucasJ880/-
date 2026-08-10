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
import { readWorkforceTaskSpec } from "@/lib/workforce-runtime/task-contract";
import {
  buildWorkforceHandoffV1,
  collectUpstreamHandoffs,
  WORKFORCE_HANDOFF_CONTRACT_VERSION,
  type WorkforceExecutionContext,
} from "@/lib/workforce-runtime/handoff";
import {
  getWorkforceWorker,
  workerSupportsTaskKind,
} from "@/lib/workforce-runtime/workers";
import {
  executeWorkforceSynthesisTask,
  WORKFORCE_SYNTHESIS_EXECUTION_LABEL,
} from "@/lib/workforce-runtime/synthesis";

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
 * P0 #89（§12–§13）：workforce 契约任务的 priorEvidence 收敛——
 * 只包含 step.dependsOn 声明的上游输出，且按声明序构建（map 插入序 =
 * 依赖声明序，非完成序/DB 行序）。未声明的 Step 即使已完成也不可见。
 */
function scopedEvidenceByDependsOn(
  steps: Array<{ stepKey: string; outputJson: unknown }>,
  dependsOnJson: unknown,
): Record<string, unknown> {
  const deps = Array.isArray(dependsOnJson)
    ? dependsOnJson.filter((x): x is string => typeof x === "string")
    : [];
  const byKey = new Map(steps.map((s) => [s.stepKey, s]));
  const out: Record<string, unknown> = {};
  for (const key of deps) {
    const s = byKey.get(key);
    if (s?.outputJson && typeof s.outputJson === "object") {
      out[key] = s.outputJson;
    }
  }
  return out;
}

/**
 * Phase 2B-1 fail-closed 终止（§29）：workforce 契约失效（worker 无效 /
 * handoff 无效 / 上游缺失）→ step failed + run needs_human。
 * 与既有 canInvokeTool 失败分支同构：fenced 写入 + run.needs_human 事件。
 */
async function failStepClosed(input: {
  fence?: RunFence;
  orgId: string;
  runId: string;
  stepId: string;
  stepKey: string;
  stepTitle: string;
  errorCode: string;
  errorMessage: string;
}): Promise<ExecuteRoundResult> {
  const { fence, orgId, runId } = input;
  await fenceGuardedWrite(fence, async (c) => {
    await c.agentRunStep.update({
      where: { id: input.stepId },
      data: {
        status: "failed",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: new Date(),
      },
    });
    await c.agentRun.update({
      where: { id: runId },
      data: {
        status: "needs_human",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "run.needs_human",
    title: "Workforce 任务契约校验失败，需要人工处理",
    payload: {
      stepKey: input.stepKey,
      errorCode: input.errorCode,
      error: input.errorMessage,
    },
  });
  return { status: "failed", error: input.errorMessage };
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
              // P0：durable errorCode 补全（此前为 null/残留旧值）
              errorCode: "blocked_graph",
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

  // ── Phase 2B-1 Workforce Task gate（仅 workforce_job 且 step 携带
  // workforceTask spec；legacy runtime_v2 与旧 workforce run 不受影响）──
  // 失败一律 fail-closed：step failed + run needs_human（§29），
  // 不做 fallback worker / 动态 replan（2B-3 边界）。
  // P0 #89：gate 必须先于工具解析——synthesis 任务没有 preferredTool，
  // 需要在 no_tool 判定之前识别 taskKind 并进入 Runtime 原生执行。
  let workforceContext: WorkforceExecutionContext | null = null;
  if (isDurableWorkforceJob) {
    const specRead = readWorkforceTaskSpec(step.inputJson);
    if (specRead.kind === "invalid") {
      return failStepClosed({
        fence,
        orgId,
        runId,
        stepId: step.id,
        stepKey: step.stepKey,
        stepTitle: step.title,
        errorCode: "workforce_task_invalid",
        errorMessage: `Workforce Task spec 损坏：${specRead.error}`,
      });
    }
    if (specRead.kind === "valid") {
      const spec = specRead.spec;
      // worker 执行期重校验（registry 为 server-authoritative；§9/§13）
      const worker = getWorkforceWorker(spec.worker.workerKey);
      if (!worker || !workerSupportsTaskKind(spec.worker.workerKey, spec.taskKind)) {
        return failStepClosed({
          fence,
          orgId,
          runId,
          stepId: step.id,
          stepKey: step.stepKey,
          stepTitle: step.title,
          errorCode: "workforce_worker_invalid",
          errorMessage: `Worker 无效或不支持该任务类型：${spec.worker.workerKey}/${spec.taskKind}`,
        });
      }
      // Dependency → validated Handoff（§22–24）：任一上游 handoff
      // missing / unknown version / malformed / 来源不符 → fail closed
      const upstream = collectUpstreamHandoffs({
        runId,
        dependsOnJson: step.dependsOnJson,
        steps,
      });
      if (!upstream.ok) {
        return failStepClosed({
          fence,
          orgId,
          runId,
          stepId: step.id,
          stepKey: step.stepKey,
          stepTitle: step.title,
          errorCode: upstream.code,
          errorMessage: upstream.error,
        });
      }
      workforceContext = {
        workerKey: worker.workerKey,
        role: worker.role,
        taskKind: spec.taskKind,
        objective: spec.objective,
        spec,
        upstreamHandoffs: upstream.upstream,
      };
    }
  }

  // P0 #89 Native Synthesis（§16–§17）：taskKind=synthesis 是 Runtime
  // 一等执行语义——不需要 preferredTool，绝不产生 no_tool 失败。
  // 执行优先级：synthesis 步骤显式声明了可执行工具时仍走该工具
  // （如模型把确定性聚合器 sales_prioritize_followups 绑为 synthesis，
  // 保留其结构化输出供下游写任务消费，与 2B-1 §44 冻结行为一致）；
  // 未声明工具 → native synthesis（本 P0 修复的 no_tool 死亡路径）。
  const isNativeSynthesis =
    workforceContext?.taskKind === "synthesis" && !step.preferredTool;

  const toolName = step.preferredTool;
  if (!isNativeSynthesis && !toolName) {
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

  // 事件/幂等中的执行标识：工具名，或 synthesis 内部执行标签（非工具，
  // 永不进入 Planner catalog）
  const executionLabel = isNativeSynthesis
    ? WORKFORCE_SYNTHESIS_EXECUTION_LABEL
    : toolName!;

  if (!isNativeSynthesis) {
    const descriptor = getRuntimeV2Tool(toolName!);
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
        name: toolName!,
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
  }
  // synthesis：不调用任何业务工具（无 tool 鉴权对象，不读业务表）；
  // membership 已在本轮入口校验，模型调用配额与遥测由统一 Model Runtime
  // 承担（§22/§44）。输入仅为上方 gate 校验过的声明上游 Handoff。

  const attempt = step.attemptCount + 1;
  // 业务幂等不含 attempt；Step 表仅记录稳定 operationKey 供审计
  const operationKey = buildStepOperationKey({
    runId,
    stepKey: step.stepKey,
    toolName: executionLabel,
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
    payload: {
      stepKey: step.stepKey,
      toolName: executionLabel,
      attempt,
      operationKey,
      // §37 最小观测增强（workforce 任务才有）
      ...(workforceContext
        ? {
            workerKey: workforceContext.workerKey,
            taskKind: workforceContext.taskKind,
            upstreamStepKeys: workforceContext.upstreamHandoffs.map(
              (u) => u.stepKey,
            ),
          }
        : {}),
    },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "tool.started",
    title: executionLabel,
    payload: { stepKey: step.stepKey, operationKey },
  });

  // P0 #89（§12–§13）：workforce 契约任务（spec valid）的证据消费收敛为
  // dependsOn 声明上游（声明序）；legacy runtime_v2 与 true-legacy
  // workforce step（spec absent）保持全量 map，行为不变。
  const priorEvidence = workforceContext
    ? scopedEvidenceByDependsOn(steps, step.dependsOnJson)
    : asEvidenceMap(steps);
  let result;
  try {
    if (isNativeSynthesis) {
      // §16：native synthesis——server-controlled 执行路径，
      // 输入 = gate 校验过的声明上游 Handoff（声明序）
      result = await executeWorkforceSynthesisTask({
        orgId,
        userId,
        runId,
        stepKey: step.stepKey,
        objective: workforceContext!.objective,
        expectedOutput: workforceContext!.spec.expectedOutput,
        upstreamHandoffs: workforceContext!.upstreamHandoffs,
      });
    } else {
      result = await executeRuntimeV2Tool(toolName!, {
        orgId,
        userId,
        role,
        runId,
        threadId,
        assistantMessageId,
        stepKey: step.stepKey,
        operationKey,
        priorEvidence,
        // §13：Worker 执行上下文注入（workforce 任务专属；只含必要内容，
        // 不含任何授权语义——Tool 鉴权仍完整走 canInvokeTool/审批链）
        workforce: workforceContext ?? undefined,
      });
    }
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
              // synthesis 失败使用独立 durable errorCode（fail closed，
              // 不做字符串拼接降级；§20）
              errorCode: isNativeSynthesis ? "synthesis_failed" : "tool_failed",
              errorMessage: result.error,
              completedAt: new Date(),
            },
      }),
    );
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "tool.failed",
      title: executionLabel,
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
      // 无可写对象：视为完成跳过。skipped 是 Handoff 终态（§33）：
      // workforce 任务在同一 fenced 写入内附加信封（保留业务 output）
      const skippedAt = new Date();
      const skippedData: {
        status: string;
        completedAt: Date;
        outputJson?: Prisma.InputJsonValue;
      } = { status: "skipped", completedAt: skippedAt };
      if (workforceContext) {
        const skippedHandoff = buildWorkforceHandoffV1({
          runId,
          stepKey: step.stepKey,
          workerKey: workforceContext.workerKey,
          taskKind: workforceContext.taskKind,
          stepStatus: "skipped",
          taskObjective: workforceContext.objective,
          businessOutput: result.data ?? {},
          pendingActionIds: pendingIds,
          completedAt: skippedAt,
          upstreamHandoffs: workforceContext.upstreamHandoffs,
        });
        if (skippedHandoff.ok) {
          skippedData.outputJson = jsonValue({
            ...((result.data ?? {}) as Record<string, unknown>),
            workforceHandoff: skippedHandoff.payload,
          });
        }
      }
      await fenceGuardedWrite(fence, (c) =>
        c.agentRunStep.update({
          where: { id: step.id },
          data: skippedData,
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

  // §31/§32：completedAt 唯一取值一次——Step 终态与 Handoff.createdAt 共用
  // 同一 durable 时间，且 Handoff 与 Step 结果在同一 fenced 原子写入内持久化
  const completedAt = new Date();
  let completedOutput: Record<string, unknown> = {
    ...((result.data ?? {}) as Record<string, unknown>),
  };
  if (workforceContext) {
    const handoff = buildWorkforceHandoffV1({
      runId,
      stepKey: step.stepKey,
      workerKey: workforceContext.workerKey,
      taskKind: workforceContext.taskKind,
      stepStatus: "completed",
      taskObjective: workforceContext.objective,
      businessOutput: result.data ?? {},
      completedAt,
      upstreamHandoffs: workforceContext.upstreamHandoffs,
    });
    if (!handoff.ok) {
      return failStepClosed({
        fence,
        orgId,
        runId,
        stepId: step.id,
        stepKey: step.stepKey,
        stepTitle: step.title,
        errorCode: "handoff_build_failed",
        errorMessage: `Handoff 构建失败（${handoff.code}）：${handoff.error}`,
      });
    }
    // §20：namespaced envelope，保留原业务 output，不覆盖 step result
    completedOutput = { ...completedOutput, workforceHandoff: handoff.payload };
  }

  await fenceGuardedWrite(fence, (c) =>
    c.agentRunStep.update({
      where: { id: step.id },
      data: {
        status: "completed",
        outputJson: jsonValue(completedOutput),
        evidenceJson: jsonValue({ toolName: executionLabel, ok: true }),
        completedAt,
      },
    }),
  );
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "tool.completed",
    title: executionLabel,
    payload: { stepKey: step.stepKey },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "step.completed",
    title: step.title,
    payload: {
      stepKey: step.stepKey,
      ...(workforceContext
        ? {
            workerKey: workforceContext.workerKey,
            taskKind: workforceContext.taskKind,
            handoffVersion: WORKFORCE_HANDOFF_CONTRACT_VERSION,
          }
        : {}),
    },
  });

  return { status: "continued" };
}
