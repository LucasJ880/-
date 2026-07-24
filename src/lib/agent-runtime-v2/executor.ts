import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import { markAgentRunAwaitingApproval } from "@/lib/agent-runtime/pending-link";
import { executeRuntimeV2Tool } from "./adapters";
import { emitRuntimeV2Event } from "./events";
import { getRuntimeV2Limits } from "./flags";
import { getRuntimeV2Tool } from "./tool-catalog";
import { refreshReadySteps } from "./persist";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export type ExecuteRoundResult =
  | { status: "continued" }
  | { status: "awaiting_approval" }
  | { status: "ready_for_verification" }
  | { status: "failed"; error: string }
  | { status: "cancelled" };

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
 */
export async function executeRuntimeV2Round(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string;
  threadId?: string | null;
}): Promise<ExecuteRoundResult> {
  const { orgId, runId, userId, role } = input;
  const limits = getRuntimeV2Limits();

  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId, runtimeVersion: "v2" },
  });
  if (!run) return { status: "failed", error: "Run not found" };
  if (run.status === "cancelled") return { status: "cancelled" };
  if (run.status === "awaiting_approval") return { status: "awaiting_approval" };

  // 超时
  if (run.startedAt) {
    const elapsed = Date.now() - run.startedAt.getTime();
    if (elapsed > limits.timeoutMs) {
      await db.agentRun.update({
        where: { id: runId },
        data: { status: "failed", errorCode: "external_timeout", errorMessage: "Runtime V2 timeout" },
      });
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
    await db.agentRun.update({
      where: { id: runId },
      data: {
        status: "needs_human",
        errorCode: "org_forbidden",
        errorMessage: "无企业成员身份，停止执行",
      },
    });
    return { status: "failed", error: "no_membership" };
  }

  await refreshReadySteps(orgId, runId);

  const steps = await db.agentRunStep.findMany({ where: { orgId, runId } });
  const toolCalls = steps.reduce((n, s) => n + s.attemptCount, 0);
  if (toolCalls >= limits.maxToolCalls) {
    await db.agentRun.update({
      where: { id: runId },
      data: { status: "needs_human", errorMessage: "超过最大工具调用次数" },
    });
    return { status: "failed", error: "max_tool_calls" };
  }

  const ready = steps
    .filter((s) => s.status === "ready")
    .slice(0, limits.parallelism);

  if (ready.length === 0) {
    const awaiting = steps.some((s) => s.status === "awaiting_approval");
    if (awaiting) {
      await db.agentRun.update({
        where: { id: runId },
        data: { status: "awaiting_approval" },
      });
      return { status: "awaiting_approval" };
    }
    const pending = steps.some(
      (s) => s.status === "pending" || s.status === "running",
    );
    if (pending) {
      // 依赖未满足但仍有 pending — 可能死锁
      const blocked = steps.filter((s) => s.status === "pending");
      if (blocked.length > 0 && !steps.some((s) => s.status === "ready")) {
        await db.agentRun.update({
          where: { id: runId },
          data: {
            status: "needs_human",
            errorMessage: "步骤依赖无法推进",
          },
        });
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

  await db.agentRun.update({
    where: { id: runId },
    data: { status: "executing", startedAt: run.startedAt ?? new Date() },
  });

  const step = ready[0];
  const toolName = step.preferredTool;
  if (!toolName) {
    await db.agentRunStep.update({
      where: { id: step.id },
      data: {
        status: "failed",
        errorCode: "no_tool",
        errorMessage: "步骤未指定工具",
        completedAt: new Date(),
      },
    });
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
    await db.agentRunStep.update({
      where: { id: step.id },
      data: {
        status: "failed",
        errorCode: decision.code,
        errorMessage: decision.error,
        completedAt: new Date(),
      },
    });
    await db.agentRun.update({
      where: { id: runId },
      data: {
        status: "needs_human",
        errorCode: decision.code,
        errorMessage: decision.error,
      },
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
  const idempotencyKey = `ar2:${runId}:${step.stepKey}:${attempt}`;

  await db.agentRunStep.update({
    where: { id: step.id },
    data: {
      status: "running",
      attemptCount: attempt,
      idempotencyKey,
      startedAt: new Date(),
    },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "step.started",
    title: step.title,
    payload: { stepKey: step.stepKey, toolName, attempt },
  });
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "tool.started",
    title: toolName,
    payload: { stepKey: step.stepKey },
  });

  const priorEvidence = asEvidenceMap(steps);
  let result;
  try {
    result = await executeRuntimeV2Tool(toolName, {
      orgId,
      userId,
      role,
      runId,
      threadId: input.threadId,
      stepKey: step.stepKey,
      priorEvidence,
    });
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!result.ok) {
    const canRetry = attempt < step.maxAttempts;
    await db.agentRunStep.update({
      where: { id: step.id },
      data: canRetry
        ? { status: "ready", errorMessage: result.error }
        : {
            status: "failed",
            errorCode: "tool_failed",
            errorMessage: result.error,
            completedAt: new Date(),
          },
    });
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
    await db.agentRunStep.update({
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
    });
    if (result.data?.skipped) {
      // 无可写对象：视为完成跳过
      await db.agentRunStep.update({
        where: { id: step.id },
        data: { status: "skipped", completedAt: new Date() },
      });
      await emitRuntimeV2Event({
        orgId,
        runId,
        eventType: "step.completed",
        title: `${step.title}（跳过）`,
        payload: { stepKey: step.stepKey, skipped: true },
      });
      return { status: "continued" };
    }
    await markAgentRunAwaitingApproval(orgId, runId);
    await emitRuntimeV2Event({
      orgId,
      runId,
      eventType: "approval.required",
      title: "等待你确认动作",
      payload: { stepKey: step.stepKey, pendingActionIds: pendingIds },
    });
    return { status: "awaiting_approval" };
  }

  await db.agentRunStep.update({
    where: { id: step.id },
    data: {
      status: "completed",
      outputJson: jsonValue(result.data ?? {}),
      evidenceJson: jsonValue({ toolName, ok: true }),
      completedAt: new Date(),
    },
  });
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
