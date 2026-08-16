import type { AgentRunStep, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import { resolveWorkforceExecutionPolicy } from "@/lib/workforce-runtime/execution-policy";
import { resolveExecutionPolicyTool } from "@/lib/workforce-runtime/execution-descriptor";
import { markAgentRunAwaitingApproval } from "@/lib/agent-runtime/pending-link";
import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import {
  fenceGuardedWrite,
  LostLeaseError,
  type RunFence,
} from "@/lib/agent-runtime/lease";
import {
  executeRuntimeV2Tool,
  type RuntimeExecutionBudget,
  type ToolContinuation,
} from "./adapters";
import { emitRuntimeV2Event } from "./events";
import { getRuntimeV2Limits } from "./flags";
import { buildStepOperationKey } from "./idempotency";
import { refreshReadySteps } from "./persist";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";
import { isWorkforceProcessingEnabled } from "@/lib/workforce-runtime/flags";
import {
  buildParallelBatch,
  collectOccupiedResourceKeys,
  getWorkforceMaxParallelTasks,
  type TaskExecutionPolicy,
} from "@/lib/workforce-runtime/parallel";
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
  /**
   * T5-P1.1：工具**正常让出**（本次 serverless 预算用尽，成果已 checkpoint）。
   * 不是失败、不是审批、不消耗重试预算；调用方必须结束本次 invocation 并回队。
   */
  | { status: "yielded"; stepKey: string; phase?: string; ticks?: number }
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
  /** T5-P1.1 §5：server-only serverless 执行预算，注入 AdapterContext 供长工具消费 */
  executionBudget?: RuntimeExecutionBudget;
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
  /** T5-P1.1 §5：server-only serverless 执行预算 */
  executionBudget?: RuntimeExecutionBudget;
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

  const isDurableWorkforceJob = run.runType === WORKFORCE_JOB_RUN_TYPE;

  // Phase 2B-2（§22）：kill-switch 在 slice 内即时生效——总开关关闭后
  // 本轮不做 DAG 推进 / batch selection / Step claim / Handoff 生成，
  // 交还 processor（processor 的 claim/queue gate 会阻止后续 slice）。
  if (isDurableWorkforceJob && !isWorkforceProcessingEnabled()) {
    return { status: "continued" };
  }

  // 超时（Phase 2A：durable workforce_job 不使用 run.startedAt 作为单次执行
  // timeout——Job 可能已存活数小时（等审批/多 slice），改由 workforce processor
  // 在每个 slice 内用 processingStartedAt 控制 per-slice 时间预算）
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

  const readySteps = steps.filter((s) => s.status === "ready");
  const ready = readySteps.slice(0, limits.parallelism);

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

  // ── Phase 2B-2：workforce_job 一律走受控 batch 调度（server policy 分类
  // + Step CAS claim + bounded SAFE_PARALLEL batch + coordinator 独占 Run
  // 状态收敛）。maxParallelTasks=1（production default）时 batch 恒为
  // [队首]，调度语义与单步执行一致；#94 P0 语义（gate 先于工具解析、
  // native synthesis、dependsOn-scoped evidence、synthesis_failed）在
  // batch 路径内 1:1 保持。legacy runtime_v2 走下方原路径，行为零变化。──
  if (isDurableWorkforceJob) {
    return executeWorkforceBatchRound({
      orgId,
      runId,
      userId,
      role,
      membershipRole: membership.role,
      threadId,
      assistantMessageId,
      fence,
      runStartedAt: run.startedAt,
      steps,
      readySteps,
      toolCallsUsed: toolCalls,
      maxToolCalls: limits.maxToolCalls,
      // T5-P0C：batch 路径无 run 对象，server 权威 metadata 由此透传
      runMetadata: meta,
      executionBudget: input.executionBudget,
    });
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
    // T5-P0C-A：执行策略 descriptor 与 planner 可见性解耦。
    // 缺失 → fail-closed，绝不给默认风险（任何默认值都是猜风险）。
    const policyTool = resolveExecutionPolicyTool(toolName!);
    if (!policyTool.ok) {
      return await failStepClosed({
        fence,
        orgId,
        runId,
        stepId: step.id,
        stepKey: step.stepKey,
        stepTitle: step.title,
        errorCode: policyTool.code,
        errorMessage: policyTool.error,
      });
    }
    // T5-P0C：策略输入全部来自 server 权威 run context（不再硬编码 sales）。
    // fail-closed：策略上下文解析失败 → 拒绝执行（绝不"无策略放行"）。
    const policyResult = await resolveWorkforceExecutionPolicy({
      orgId,
      runId,
      userId,
      role,
      runMetadata: meta,
    });
    if (!policyResult.ok) {
      // Segment 2.5：业务域无法证明也走同一条 fail-closed 出口，
      // 但带上可审计的 durable 错误码（work_domain_missing / _ambiguous）。
      return await failStepClosed({
        fence,
        orgId,
        runId,
        stepId: step.id,
        stepKey: step.stepKey,
        stepTitle: step.title,
        errorCode: policyResult.code,
        errorMessage: policyResult.error,
      });
    }
    const execPolicy = policyResult.policy;
    // 重新鉴权（真实 domain + org/module/tool policy 全部参与）
    const decision = canInvokeTool({
      tenant: {
        userId,
        orgId,
        orgRole:
          membership.role === "org_owner" ? "org_admin" : membership.role,
        isPlatformAdmin: role === "admin" || role === "super_admin",
        workspaceIds: execPolicy.workspaceIds,
      },
      hasMembership: true,
      tool: {
        name: toolName!,
        domain: execPolicy.toolDomain,
        // 唯一风险映射（riskLevel + readOnly + requiresApproval），非二值近似
        risk: policyTool.risk,
        allowRoles: execPolicy.allowRoles,
      },
      modulesJson: execPolicy.modulesJson,
      toolPolicy: execPolicy.toolPolicy,
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
    payload: { stepKey: step.stepKey, operationKey, toolCallId: `${step.stepKey}:${attempt}` },
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
        // T5-P1 Segment 2 §8：server-only 写防栅栏。仅服务端注入的活对象，
        // 不改变任何工具的业务参数契约；客户端不可构造、不会被序列化。
        runFence: fence,
        // T5-P1.1 §5：server-only serverless 执行预算（同纪律，不序列化）
        executionBudget: input.executionBudget,
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

  // ── T5-P1.1 §15：正常让出必须在 失败/审批/完成 之前处理 ──
  // native synthesis 结果没有该字段（也不给它开让出能力），显式按可选字段读取
  const continuation = (result as { continuation?: ToolContinuation })
    .continuation;
  if (continuation) {
    // §16：让出不是 retry —— 把本次 claim 的 attemptCount+1 回滚，
    // 否则长标包会被正常切片耗尽 maxAttempts。
    // §18：回 ready、清错误、不写 completedAt、不产 Handoff、不发 step.completed。
    await fenceGuardedWrite(fence, (c) =>
      c.agentRunStep.update({
        where: { id: step.id },
        data: {
          status: "ready",
          attemptCount: step.attemptCount,
          errorCode: null,
          errorMessage: null,
          completedAt: null,
          evidenceJson: jsonValue({
            continuation: {
              reason: continuation.reason,
              phase: continuation.phase ?? null,
              ticks: continuation.ticks ?? null,
            },
          }),
        },
      }),
    );
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "tool.yielded",
      title: executionLabel,
      payload: {
        stepKey: step.stepKey,
        reason: continuation.reason,
        phase: continuation.phase,
        ticks: continuation.ticks,
      },
    });
    return {
      status: "yielded",
      stepKey: step.stepKey,
      phase: continuation.phase,
      ticks: continuation.ticks,
    };
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
      payload: {
        stepKey: step.stepKey,
        error: result.error,
        attempt,
        toolCallId: `${step.stepKey}:${attempt}`,
        errorCode: isNativeSynthesis ? "synthesis_failed" : "tool_failed",
      },
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
    payload: { stepKey: step.stepKey, toolCallId: `${step.stepKey}:${attempt}` },
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

// ═══════════════════════════════════════════════════════════════════════
// Phase 2B-2 — Controlled Parallel Task Execution（workforce_job 专属）
//
// 职责分离（§16）：
// - Task worker（executeClaimedWorkforceStep）只写 Step state / Step result
//   / Handoff（全部 fenced），绝不写 AgentRun.status；
// - Batch coordinator（executeWorkforceBatchRound）负责选 batch、CAS 认领、
//   并发执行、聚合 outcome、唯一决定 Run 下一状态——避免并行 Promise
//   竞写 Job 状态（Task A 置 completed 与 Task B 置 needs_human 竞态）。
//
// #94 P0 语义在本路径 1:1 保持：
// - workforce gate 先于工具解析（native synthesis 无 preferredTool，
//   绝不落 no_tool）；
// - taskKind=synthesis ∧ 无 preferredTool → executeWorkforceSynthesisTask
//  （统一模型出口，失败 errorCode=synthesis_failed）；
// - 契约任务 priorEvidence = dependsOn 声明上游（声明序，scoped）；
// - stale running 回收不在本层（唯一边界 = processor 成功获取 run lease
//   之后，Final Gate §4——round 内绝不 running→ready，P6b）。
// ═══════════════════════════════════════════════════════════════════════

type WorkforceStepRow = AgentRunStep;

type WorkforceStepOutcome =
  | { kind: "continued" }
  /** T5-P1.1：工具正常让出（已 checkpoint），本轮必须结束、Job 回队 */
  | { kind: "yielded"; stepKey: string; phase?: string; ticks?: number }
  /** CAS 未命中：另一 driver 已认领（TASK_ALREADY_CLAIMED），未执行 Tool */
  | { kind: "claim_lost"; stepKey: string }
  | { kind: "awaiting_approval"; stepKey: string; pendingActionIds: string[] }
  | {
      kind: "needs_human";
      stepKey: string;
      errorCode: string;
      errorMessage: string;
      eventTitle: string;
    };

/**
 * Phase 2B-2 fail-closed（§16/§21）：workforce 契约/鉴权失效时只写 Step
 * 终态，不写 Run 状态——Run 级收敛由 batch coordinator 统一决定（并行
 * sibling 的 durable 结果不因本 Task 失败而丢失）。
 */
async function failWorkforceStepOnly(input: {
  fence?: RunFence;
  stepId: string;
  errorCode: string;
  errorMessage: string;
}): Promise<void> {
  await fenceGuardedWrite(input.fence, (c) =>
    c.agentRunStep.update({
      where: { id: input.stepId },
      data: {
        status: "failed",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: new Date(),
      },
    }),
  );
}

/**
 * Workforce Task gate（2B-1 §29 语义 + #94 顺序要求：gate 先于工具解析，
 * 在 CAS 认领之前执行——gate 失败不消耗 attemptCount）：
 * - spec absent → TRUE LEGACY（2B-1 前规划的旧 run）：无 context 放行；
 * - spec invalid / worker 无效 / 上游 Handoff 缺失·损坏·来源不符 → fail-closed。
 */
function evaluateWorkforceTaskGate(input: {
  runId: string;
  step: Pick<WorkforceStepRow, "inputJson" | "dependsOnJson">;
  steps: Array<
    Pick<WorkforceStepRow, "stepKey" | "status" | "inputJson" | "outputJson">
  >;
}):
  | { ok: true; context: WorkforceExecutionContext | null }
  | { ok: false; errorCode: string; errorMessage: string } {
  const specRead = readWorkforceTaskSpec(input.step.inputJson);
  if (specRead.kind === "invalid") {
    return {
      ok: false,
      errorCode: "workforce_task_invalid",
      errorMessage: `Workforce Task spec 损坏：${specRead.error}`,
    };
  }
  if (specRead.kind === "absent") return { ok: true, context: null };

  const spec = specRead.spec;
  // worker 执行期重校验（registry 为 server-authoritative；§9/§13）
  const worker = getWorkforceWorker(spec.worker.workerKey);
  if (!worker || !workerSupportsTaskKind(spec.worker.workerKey, spec.taskKind)) {
    return {
      ok: false,
      errorCode: "workforce_worker_invalid",
      errorMessage: `Worker 无效或不支持该任务类型：${spec.worker.workerKey}/${spec.taskKind}`,
    };
  }
  // Dependency → validated Handoff（§18）：消费顺序恒为 dependsOn 声明序，
  // 与并行完成顺序无关；任一上游 missing / unknown version / malformed /
  // 来源不符 → fail closed
  const upstream = collectUpstreamHandoffs({
    runId: input.runId,
    dependsOnJson: input.step.dependsOnJson,
    steps: input.steps,
  });
  if (!upstream.ok) {
    return {
      ok: false,
      errorCode: upstream.code,
      errorMessage: upstream.error,
    };
  }
  return {
    ok: true,
    context: {
      workerKey: worker.workerKey,
      role: worker.role,
      taskKind: spec.taskKind,
      objective: spec.objective,
      spec,
      upstreamHandoffs: upstream.upstream,
    },
  };
}

/**
 * Batch coordinator（§14/§16/§20/§21 + Final Gate §6）：
 *   classify policies → bounded batch（并行上限 ∩ 剩余工具预算）→
 *   pre-flight（gate 先行）→ CAS claim → 并发执行 → 聚合 outcome →
 *   唯一决定 Run 下一状态。
 */
async function executeWorkforceBatchRound(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string;
  membershipRole: string;
  threadId: string | null;
  assistantMessageId: string | null;
  fence?: RunFence;
  runStartedAt: Date | null;
  steps: WorkforceStepRow[];
  readySteps: WorkforceStepRow[];
  /** 本轮开始时的 attemptCount 总和（= 已消耗工具调用预算） */
  toolCallsUsed: number;
  maxToolCalls: number;
  /** T5-P0C：run metadata（承载 server 权威 workDomain）——batch 路径无 run 对象，须由上游透传 */
  runMetadata?: Record<string, unknown> | null;
  /** T5-P1.1：server-only serverless 执行预算 */
  executionBudget?: RuntimeExecutionBudget;
}): Promise<ExecuteRoundResult> {
  const { orgId, runId, fence } = input;

  // §8/§20 防御：审批窗口内（任一 Step awaiting_approval）绝不启动新
  // batch——Run 收敛 awaiting_approval，等待 2C-1 resume 链路
  if (input.steps.some((s) => s.status === "awaiting_approval")) {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.updateMany({
        where: {
          id: runId,
          status: { notIn: ["cancelled", "failed", "completed"] },
        },
        data: { status: "awaiting_approval" },
      }),
    );
    return { status: "awaiting_approval" };
  }

  // deterministic 选择顺序 = 计划创建序（不依赖 DB 行序）
  const orderedReady = [...input.readySteps].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // Final Gate §6：并行 batch 不得突破既有全局工具调用预算。
  // 轮次入口已保证 remaining >= 1（toolCalls >= max 时 run 已 needs_human）。
  const remainingToolBudget = Math.max(
    0,
    input.maxToolCalls - input.toolCallsUsed,
  );
  if (remainingToolBudget <= 0) {
    return { status: "continued" };
  }
  const effectiveBatchMax = Math.min(
    getWorkforceMaxParallelTasks(),
    remainingToolBudget,
  );

  const occupiedResourceKeys = collectOccupiedResourceKeys(input.steps);
  const batch = buildParallelBatch({
    ready: orderedReady,
    occupiedResourceKeys,
    maxParallelTasks: effectiveBatchMax,
  });
  if (batch.selected.length === 0) {
    // 全部因资源占用被推迟：本轮不启动（占用清除后自然恢复推进）
    return { status: "continued" };
  }

  await fenceGuardedWrite(fence, (c) =>
    c.agentRun.update({
      where: { id: runId },
      data: {
        status: "executing",
        startedAt: input.runStartedAt ?? new Date(),
      },
    }),
  );

  // ── pre-flight（顺序，无工具调用；#94 顺序：gate → synthesis 识别 →
  // no_tool → 重鉴权）。失败只写 Step（run 收敛交 coordinator，§16/§21
  // ——sibling 照常执行并 durable settle）。通过者立即 CAS 认领（§12）。──
  const outcomes: WorkforceStepOutcome[] = [];
  const claimed: Array<{
    row: WorkforceStepRow;
    policy: TaskExecutionPolicy;
    executionLabel: string;
    toolName: string | null;
    isNativeSynthesis: boolean;
    operationKey: string;
    context: WorkforceExecutionContext | null;
  }> = [];

  for (const sel of batch.selected) {
    const step = sel.step;

    // 0. Final Gate §7：ready 但重试预算已耗尽的 Step（verifier REPAIR
    //    可能在不重置 attemptCount 的情况下复活 failed Step）——绝不再
    //    执行，pre-flight 即终态化。否则该 Step 会被 CAS 的 attempt 守卫
    //    永久拒领而滞留 ready，造成跨 slice 活锁。终态化后由 verifier
    //    hard floor（#90A）诚实收敛。
    if (step.attemptCount >= step.maxAttempts) {
      await failWorkforceStepOnly({
        fence,
        stepId: step.id,
        errorCode: "step_attempts_exhausted",
        errorMessage: "任务重试预算已耗尽，不再执行",
      });
      outcomes.push({ kind: "continued" });
      continue;
    }

    // 1. workforce gate 先于工具解析（#94：synthesis 无 preferredTool，
    //    必须在 no_tool 判定之前识别 taskKind）
    const gate = evaluateWorkforceTaskGate({
      runId,
      step,
      steps: input.steps,
    });
    if (!gate.ok) {
      await failWorkforceStepOnly({
        fence,
        stepId: step.id,
        errorCode: gate.errorCode,
        errorMessage: gate.errorMessage,
      });
      outcomes.push({
        kind: "needs_human",
        stepKey: step.stepKey,
        errorCode: gate.errorCode,
        errorMessage: gate.errorMessage,
        eventTitle: "Workforce 任务契约校验失败，需要人工处理",
      });
      continue;
    }

    // 2. Native Synthesis（#94 #89）：taskKind=synthesis ∧ 无 preferredTool
    //    → Runtime 原生执行，绝不 no_tool
    const isNativeSynthesis =
      gate.context?.taskKind === "synthesis" && !step.preferredTool;
    const toolName = step.preferredTool;

    if (!isNativeSynthesis && !toolName) {
      await failWorkforceStepOnly({
        fence,
        stepId: step.id,
        errorCode: "no_tool",
        errorMessage: "步骤未指定工具",
      });
      outcomes.push({ kind: "continued" });
      continue;
    }

    // 3. 执行期重鉴权（非 synthesis；与单步路径一致：写工具按 high risk）
    if (!isNativeSynthesis) {
      // T5-P0C-A：执行策略 descriptor 缺失 → fail-closed（与单步路径同纪律）
      const policyTool = resolveExecutionPolicyTool(toolName!);
      if (!policyTool.ok) {
        await failWorkforceStepOnly({
          fence,
          stepId: step.id,
          errorCode: policyTool.code,
          errorMessage: policyTool.error,
        });
        outcomes.push({
          kind: "needs_human",
          stepKey: step.stepKey,
          errorCode: policyTool.code,
          errorMessage: policyTool.error,
          eventTitle: `步骤「${step.title}」缺少执行策略 descriptor`,
        });
        continue;
      }
      // T5-P0C：与单步路径同源的 server 权威策略上下文（不再硬编码 sales）
      const policyResult = await resolveWorkforceExecutionPolicy({
        orgId,
        runId,
        userId: input.userId,
        role: input.role,
        runMetadata: input.runMetadata ?? null,
      });
      if (!policyResult.ok) {
        await failWorkforceStepOnly({
          fence,
          stepId: step.id,
          errorCode: policyResult.code,
          errorMessage: policyResult.error,
        });
        outcomes.push({
          kind: "needs_human",
          stepKey: step.stepKey,
          errorCode: policyResult.code,
          errorMessage: policyResult.error,
          eventTitle: `步骤「${step.title}」策略上下文不可用`,
        });
        continue;
      }
      const execPolicy = policyResult.policy;
      const decision = canInvokeTool({
        tenant: {
          userId: input.userId,
          orgId,
          orgRole:
            input.membershipRole === "org_owner"
              ? "org_admin"
              : input.membershipRole,
          isPlatformAdmin:
            input.role === "admin" || input.role === "super_admin",
          workspaceIds: execPolicy.workspaceIds,
        },
        hasMembership: true,
        tool: {
          name: toolName!,
          domain: execPolicy.toolDomain,
          risk: policyTool.risk,
          allowRoles: execPolicy.allowRoles,
        },
        modulesJson: execPolicy.modulesJson,
        toolPolicy: execPolicy.toolPolicy,
        maxRisk: "l2_soft",
      });
      if (!decision.ok) {
        await failWorkforceStepOnly({
          fence,
          stepId: step.id,
          errorCode: decision.code,
          errorMessage: decision.error,
        });
        outcomes.push({
          kind: "needs_human",
          stepKey: step.stepKey,
          errorCode: decision.code,
          errorMessage: decision.error,
          eventTitle: "权限变化，需要人工处理",
        });
        continue;
      }
    }
    // synthesis：不调用任何业务工具（无 tool 鉴权对象，不读业务表）；
    // membership 已在本轮入口校验（#94 语义）

    const executionLabel = isNativeSynthesis
      ? WORKFORCE_SYNTHESIS_EXECUTION_LABEL
      : toolName!;

    // ── Step CAS claim（§12/§13 + Final Gate §7）：ready → running 条件
    // 更新，且 attemptCount < maxAttempts（重试预算耗尽的 Step 绝不再
    // 执行）。命中 0 行 = TASK_ALREADY_CLAIMED（另一 driver 已拿走）→
    // 不执行。即使 run-level lease 出现异常边界，此处仍是第二道防线。──
    const operationKey = buildStepOperationKey({
      runId,
      stepKey: step.stepKey,
      toolName: executionLabel,
    });
    const claimedRow = await fenceGuardedWrite(fence, async (c) => {
      const cas = await c.agentRunStep.updateMany({
        where: {
          id: step.id,
          status: "ready",
          attemptCount: { lt: step.maxAttempts },
        },
        data: {
          status: "running",
          attemptCount: { increment: 1 },
          idempotencyKey: operationKey,
          startedAt: new Date(),
        },
      });
      if (cas.count === 0) return null;
      return c.agentRunStep.findUnique({ where: { id: step.id } });
    });
    if (!claimedRow) {
      outcomes.push({ kind: "claim_lost", stepKey: step.stepKey });
      continue;
    }
    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "task.claimed",
      title: step.title,
      payload: {
        stepKey: step.stepKey,
        policy: sel.policy,
        attempt: claimedRow.attemptCount,
        operationKey,
      },
      visibleToUser: false,
    });
    claimed.push({
      row: claimedRow,
      policy: sel.policy,
      executionLabel,
      toolName: toolName ?? null,
      isNativeSynthesis,
      operationKey,
      context: gate.context,
    });
  }

  if (claimed.length > 1) {
    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "parallel.batch_started",
      title: "并行批次开始",
      payload: {
        stepKeys: claimed.map((c) => c.row.stepKey),
        maxParallelTasks: effectiveBatchMax,
      },
      visibleToUser: false,
    });
  }

  // ── bounded 并发执行（§15）：仅 server 分类 + CAS 认领后的批次。
  // allSettled：单个 Task 异常不取消已启动的 sibling，各自独立收敛
  // durable outcome（§21）。──
  const settled =
    claimed.length > 0
      ? await Promise.allSettled(
          claimed.map((c) =>
            executeClaimedWorkforceStep({
              orgId,
              runId,
              userId: input.userId,
              role: input.role,
              threadId: input.threadId,
              assistantMessageId: input.assistantMessageId,
              fence,
              steps: input.steps,
              row: c.row,
              executionLabel: c.executionLabel,
              toolName: c.toolName,
              isNativeSynthesis: c.isNativeSynthesis,
              executionBudget: input.executionBudget,
              operationKey: c.operationKey,
              context: c.context,
            }),
          ),
        )
      : [];

  let lostLease = false;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      outcomes.push(s.value);
      return;
    }
    if (s.reason instanceof LostLeaseError) {
      lostLease = true;
      return;
    }
    // 未预期异常（工具失败已在内部收敛为 outcome）：防御性转 needs_human。
    // Step 可能遗留 running——由 processor 下次成功持锁后的 recovery
    // boundary 回收（Final Gate §4）。
    outcomes.push({
      kind: "needs_human",
      stepKey: claimed[i].row.stepKey,
      errorCode: "workforce_step_exception",
      errorMessage:
        s.reason instanceof Error ? s.reason.message : String(s.reason),
      eventTitle: "任务执行异常，需要人工处理",
    });
  });

  // §17：fence 丢失 → 本 worker 立即放弃，不做任何 Run 级写入（已经
  // durable 落盘的 sibling Step 结果保留；接管方 driver 负责收敛）
  if (lostLease) return { status: "lost_lease" };

  if (claimed.length > 1) {
    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "parallel.batch_completed",
      title: "并行批次结束",
      payload: {
        stepKeys: claimed.map((c) => c.row.stepKey),
        outcomes: settled.map((s) =>
          s.status === "fulfilled" ? s.value.kind : "exception",
        ),
      },
      visibleToUser: false,
    });
  }

  // ── coordinator 统一收敛 Run 状态（§16/§20/§21）：
  // needs_human > awaiting_approval > continued。终态（cancelled/failed/
  // completed）绝不被覆盖（§23：cancel 后的迟到收敛安全落地）。──
  // T5-P1.1 §20：正常让出优先于其它收敛——本轮必须立刻结束、由 processor 回队，
  // 绝不能在同一个 serverless invocation 里再次执行同一个 t3。
  const yielded = outcomes.find(
    (o): o is Extract<WorkforceStepOutcome, { kind: "yielded" }> =>
      o.kind === "yielded",
  );
  if (yielded) {
    return {
      status: "yielded",
      stepKey: yielded.stepKey,
      phase: yielded.phase,
      ticks: yielded.ticks,
    };
  }

  const needsHuman = outcomes.find(
    (o): o is Extract<WorkforceStepOutcome, { kind: "needs_human" }> =>
      o.kind === "needs_human",
  );
  if (needsHuman) {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.updateMany({
        where: {
          id: runId,
          status: { notIn: ["cancelled", "failed", "completed"] },
        },
        data: {
          status: "needs_human",
          errorCode: needsHuman.errorCode,
          errorMessage: needsHuman.errorMessage,
        },
      }),
    );
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "run.needs_human",
      title: needsHuman.eventTitle,
      payload: {
        stepKey: needsHuman.stepKey,
        errorCode: needsHuman.errorCode,
        error: needsHuman.errorMessage,
      },
    });
    return { status: "failed", error: needsHuman.errorMessage };
  }

  const awaiting = outcomes.find(
    (o): o is Extract<WorkforceStepOutcome, { kind: "awaiting_approval" }> =>
      o.kind === "awaiting_approval",
  );
  if (awaiting) {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.updateMany({
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
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "approval.required",
      title: "等待你确认动作",
      payload: {
        stepKey: awaiting.stepKey,
        pendingActionIds: awaiting.pendingActionIds,
      },
    });
    return { status: "awaiting_approval" };
  }

  return { status: "continued" };
}

/**
 * 单个已认领 Task 的执行（§15/§16/§17 + #94 P0 语义）：只写 Step state /
 * result / Handoff（全部 fenced；执行长 await 后先 fence.check）。绝不写
 * AgentRun.status——Run 收敛由 coordinator 统一决定。
 */
async function executeClaimedWorkforceStep(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string;
  threadId: string | null;
  assistantMessageId: string | null;
  fence?: RunFence;
  /** 轮次快照（scoped evidence / gate 已用；上游终态行在 batch 启动前固定） */
  steps: WorkforceStepRow[];
  /** CAS 认领后的最新行（attemptCount 已递增） */
  row: WorkforceStepRow;
  /** 工具名或 synthesis 内部执行标签（事件/幂等/证据统一使用） */
  executionLabel: string;
  toolName: string | null;
  isNativeSynthesis: boolean;
  operationKey: string;
  context: WorkforceExecutionContext | null;
  /** T5-P1.1 §5：server-only serverless 执行预算 */
  executionBudget?: RuntimeExecutionBudget;
}): Promise<WorkforceStepOutcome> {
  const {
    orgId,
    runId,
    fence,
    row,
    executionLabel,
    toolName,
    isNativeSynthesis,
    operationKey,
    context,
  } = input;
  const stepKey = row.stepKey;
  const attempt = row.attemptCount;

  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "step.started",
    title: row.title,
    payload: {
      stepKey,
      toolName: executionLabel,
      attempt,
      operationKey,
      // §24/§37 最小观测（workforce 契约任务才有）
      ...(context
        ? {
            workerKey: context.workerKey,
            taskKind: context.taskKind,
            upstreamStepKeys: context.upstreamHandoffs.map((u) => u.stepKey),
          }
        : {}),
    },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "tool.started",
    title: executionLabel,
    payload: { stepKey, operationKey, toolCallId: `${stepKey}:${attempt}` },
  });

  // #94 P0 #89（§12–§13）：workforce 契约任务（context 存在）的证据消费
  // 收敛为 dependsOn 声明上游（声明序）；true-legacy workforce step
  // （spec absent → context null）保持全量 map，行为不变。
  const priorEvidence = context
    ? scopedEvidenceByDependsOn(input.steps, row.dependsOnJson)
    : asEvidenceMap(input.steps);

  let result;
  try {
    if (isNativeSynthesis) {
      // #94 §16：native synthesis——server-controlled 执行路径，
      // 输入 = gate 校验过的声明上游 Handoff（声明序）
      result = await executeWorkforceSynthesisTask({
        orgId,
        userId: input.userId,
        runId,
        stepKey,
        objective: context!.objective,
        expectedOutput: context!.spec.expectedOutput,
        upstreamHandoffs: context!.upstreamHandoffs,
      });
    } else {
      result = await executeRuntimeV2Tool(toolName!, {
        orgId,
        userId: input.userId,
        role: input.role,
        runId,
        threadId: input.threadId,
        assistantMessageId: input.assistantMessageId,
        stepKey,
        operationKey,
        priorEvidence,
        // §13：Worker 执行上下文注入（不含任何授权语义——Tool 鉴权仍完整
        // 走 canInvokeTool / scopeGuard / 审批链）
        workforce: context ?? undefined,
        // T5-P1 Segment 2 §8：server-only 写防栅栏（同上）
        runFence: fence,
        // T5-P1.1 §5：server-only serverless 执行预算（同上）
        executionBudget: input.executionBudget,
      });
    }
  } catch (err) {
    result = {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 关键 fence 检查点（Phase 2A BLOCKER 1 语义保留）：执行长 await
  // 期间租约可能易主。任何 state mutation 之前重新验证；丢失 → 抛
  // LostLeaseError（allSettled 收集，coordinator 统一放弃）──
  if (fence && !(await fence.check())) {
    throw new LostLeaseError(runId);
  }

  // ── T5-P1.1 §15：并行批路径同样先处理正常让出 ──
  const batchContinuation = (result as { continuation?: ToolContinuation })
    .continuation;
  if (batchContinuation) {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRunStep.update({
        where: { id: row.id },
        data: {
          status: "ready",
          attemptCount: row.attemptCount, // §16：让出不消耗 attempt
          errorCode: null,
          errorMessage: null,
          completedAt: null,
          evidenceJson: jsonValue({
            continuation: {
              reason: batchContinuation.reason,
              phase: batchContinuation.phase ?? null,
              ticks: batchContinuation.ticks ?? null,
            },
          }),
        },
      }),
    );
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "tool.yielded",
      title: executionLabel,
      payload: {
        stepKey,
        reason: batchContinuation.reason,
        phase: batchContinuation.phase,
        ticks: batchContinuation.ticks,
      },
    });
    return {
      kind: "yielded",
      stepKey,
      phase: batchContinuation.phase,
      ticks: batchContinuation.ticks,
    };
  }

  if (!result.ok) {
    const canRetry = attempt < row.maxAttempts;
    await fenceGuardedWrite(fence, (c) =>
      c.agentRunStep.update({
        where: { id: row.id },
        data: canRetry
          ? { status: "ready", errorMessage: result.error }
          : {
              status: "failed",
              // #94 §20：synthesis 失败使用独立 durable errorCode
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
      payload: {
        stepKey,
        error: result.error,
        attempt,
        toolCallId: `${stepKey}:${attempt}`,
        errorCode: isNativeSynthesis ? "synthesis_failed" : "tool_failed",
      },
    });
    return { kind: "continued" };
  }

  if (result.requiresApproval || row.requiresApproval) {
    const pendingIds =
      (result.data?.pendingActionIds as string[] | undefined) ??
      (result.pendingActionId ? [result.pendingActionId] : []);
    await fenceGuardedWrite(fence, (c) =>
      c.agentRunStep.update({
        where: { id: row.id },
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
      // 无可写对象：视为完成跳过。skipped 是 Handoff 终态（2B-1 §33）：
      // workforce 契约任务在同一 fenced 写入内附加信封（保留业务 output）
      const skippedAt = new Date();
      const skippedData: {
        status: string;
        completedAt: Date;
        outputJson?: Prisma.InputJsonValue;
      } = { status: "skipped", completedAt: skippedAt };
      if (context) {
        const skippedHandoff = buildWorkforceHandoffV1({
          runId,
          stepKey,
          workerKey: context.workerKey,
          taskKind: context.taskKind,
          stepStatus: "skipped",
          taskObjective: context.objective,
          businessOutput: result.data ?? {},
          pendingActionIds: pendingIds,
          completedAt: skippedAt,
          upstreamHandoffs: context.upstreamHandoffs,
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
          where: { id: row.id },
          data: skippedData,
        }),
      );
      await emitRuntimeV2Event({
        orgId,
        runId,
        eventType: "step.completed",
        title: `${row.title}（跳过）`,
        payload: { stepKey, skipped: true },
      });
      return { kind: "continued" };
    }
    // Run → awaiting_approval 由 coordinator 统一转换（§8：审批任务单独
    // 成批，转换时机与单步语义等价）
    return { kind: "awaiting_approval", stepKey, pendingActionIds: pendingIds };
  }

  // §31/§32（2B-1 语义不变）：completedAt 唯一取值一次——Step 终态与
  // Handoff.createdAt 共用同一 durable 时间，同一 fenced 原子写入
  const completedAt = new Date();
  let completedOutput: Record<string, unknown> = {
    ...((result.data ?? {}) as Record<string, unknown>),
  };
  if (context) {
    const handoff = buildWorkforceHandoffV1({
      runId,
      stepKey,
      workerKey: context.workerKey,
      taskKind: context.taskKind,
      stepStatus: "completed",
      taskObjective: context.objective,
      businessOutput: result.data ?? {},
      completedAt,
      upstreamHandoffs: context.upstreamHandoffs,
    });
    if (!handoff.ok) {
      const errorMessage = `Handoff 构建失败（${handoff.code}）：${handoff.error}`;
      await failWorkforceStepOnly({
        fence,
        stepId: row.id,
        errorCode: "handoff_build_failed",
        errorMessage,
      });
      return {
        kind: "needs_human",
        stepKey,
        errorCode: "handoff_build_failed",
        errorMessage,
        eventTitle: "Workforce 任务契约校验失败，需要人工处理",
      };
    }
    // namespaced envelope：保留原业务 output，不覆盖 step result
    completedOutput = { ...completedOutput, workforceHandoff: handoff.payload };
  }

  await fenceGuardedWrite(fence, (c) =>
    c.agentRunStep.update({
      where: { id: row.id },
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
    payload: { stepKey, toolCallId: `${stepKey}:${attempt}` },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "step.completed",
    title: row.title,
    payload: {
      stepKey,
      ...(context
        ? {
            workerKey: context.workerKey,
            taskKind: context.taskKind,
            handoffVersion: WORKFORCE_HANDOFF_CONTRACT_VERSION,
          }
        : {}),
    },
  });

  return { kind: "continued" };
}
