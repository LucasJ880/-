import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  fenceGuardedWrite,
  type RunFence,
} from "@/lib/agent-runtime/lease";
import { getRuntimeV2Limits } from "./flags";
import type { PlannerOutput } from "./schemas";
import { emitRuntimeV2Event } from "./events";

export async function loadRuntimeV2Run(orgId: string, runId: string) {
  return db.agentRun.findFirst({
    where: { id: runId, orgId, runtimeVersion: "v2" },
    include: {
      steps: { orderBy: { createdAt: "asc" } },
      verifications: { orderBy: { attempt: "asc" } },
    },
  });
}

/**
 * plan 持久化的真正写逻辑（client-aware，不自建事务）：
 * planJson / status=planned / runtimeVersion=v2 / 幂等步骤创建。
 * 事务边界由调用方决定：legacy 自开事务；workforce fenced path 由
 * fence.guard 在**同一事务**内先做 leaseExpiresAt token 断言（AgentRun
 * 行锁）再执行本函数——fence 校验与 plan/run/step 写入同一原子 commit。
 */
async function persistPlanAndStepsWithClient(
  client: Prisma.TransactionClient,
  input: { orgId: string; runId: string; plan: PlannerOutput },
): Promise<void> {
  const { maxAttemptsPerStep } = getRuntimeV2Limits();
  const { orgId, runId, plan } = input;

  await client.agentRun.update({
    where: { id: runId },
    data: {
      planJson: JSON.parse(JSON.stringify(plan)),
      status: "planned",
      runtimeVersion: "v2",
    },
  });

  // 幂等：已有步骤则跳过创建（注意：idempotency ≠ fencing，
  // stale worker 保护由 fence 承担，不依赖本检查）
  const existing = await client.agentRunStep.count({
    where: { runId, orgId },
  });
  if (existing > 0) return;

  for (const step of plan.steps) {
    const deps = step.dependsOn ?? [];
    await client.agentRunStep.create({
      data: {
        orgId,
        runId,
        stepKey: step.id,
        title: step.title,
        description: step.description,
        status: deps.length === 0 ? "ready" : "pending",
        dependsOnJson: deps,
        preferredTool: step.preferredTool,
        executionMode: step.executionMode,
        riskLevel: step.riskLevel,
        requiresApproval: step.requiresApproval,
        maxAttempts: maxAttemptsPerStep,
      },
    });
  }
}

export async function persistPlanAndSteps(input: {
  orgId: string;
  runId: string;
  plan: PlannerOutput;
  /** workforce_job：fence 校验与 plan 持久化必须同一原子 commit boundary */
  fence?: RunFence;
}) {
  const { fence, orgId, runId, plan } = input;

  if (fence) {
    // Final BLOCKER 修复：fence.guard 自身开启事务并以条件 updateMany
    // 断言 leaseExpiresAt token（取得 AgentRun 行锁），token 不符抛
    // LostLeaseError 且事务回滚——stale planner result 无法在租约易主后
    // 提交任何 planJson/status/step 写入。这里传入 client-aware 写逻辑，
    // 不嵌套 db.$transaction（避免 AgentRun 行锁死锁）。
    await fence.guard((tx) =>
      persistPlanAndStepsWithClient(tx, { orgId, runId, plan }),
    );
  } else {
    // Legacy runtime_v2 path：行为完全不变
    await db.$transaction((tx) =>
      persistPlanAndStepsWithClient(tx, { orgId, runId, plan }),
    );
  }

  // §9：只有持久化成功才 emit——stale persist 在上方抛 LostLeaseError，
  // 绝不会发出 plan.created
  await emitRuntimeV2Event({
    orgId,
    runId,
    eventType: "plan.created",
    title: "计划已生成",
    payload: {
      objective: plan.objective,
      stepCount: plan.steps.length,
    },
  });
}

export function dependenciesSatisfied(
  dependsOn: unknown,
  completedKeys: Set<string>,
): boolean {
  const deps = Array.isArray(dependsOn)
    ? dependsOn.filter((x): x is string => typeof x === "string")
    : [];
  return deps.every((d) => completedKeys.has(d));
}

/** fence（可选）：workforce_job 下 pending→ready 提升也经防栅栏（stale worker 零写入） */
export async function refreshReadySteps(
  orgId: string,
  runId: string,
  fence?: RunFence,
) {
  const steps = await db.agentRunStep.findMany({ where: { orgId, runId } });
  const completed = new Set(
    steps
      .filter((s) =>
        ["completed", "skipped", "partially_executed"].includes(s.status),
      )
      .map((s) => s.stepKey),
  );
  for (const step of steps) {
    if (step.status !== "pending") continue;
    if (dependenciesSatisfied(step.dependsOnJson, completed)) {
      await fenceGuardedWrite(fence, (c) =>
        c.agentRunStep.update({
          where: { id: step.id },
          data: { status: "ready" },
        }),
      );
      await emitRuntimeV2Event({
        orgId,
        runId,
        eventType: "step.ready",
        title: step.title,
        payload: { stepKey: step.stepKey },
      });
    }
  }
}
