import { db } from "@/lib/db";
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

export async function persistPlanAndSteps(input: {
  orgId: string;
  runId: string;
  plan: PlannerOutput;
}) {
  const { maxAttemptsPerStep } = getRuntimeV2Limits();
  const { orgId, runId, plan } = input;

  await db.$transaction(async (tx) => {
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        planJson: JSON.parse(JSON.stringify(plan)),
        status: "planned",
        runtimeVersion: "v2",
      },
    });

    // 幂等：已有步骤则跳过创建
    const existing = await tx.agentRunStep.count({ where: { runId, orgId } });
    if (existing > 0) return;

    for (const step of plan.steps) {
      const deps = step.dependsOn ?? [];
      await tx.agentRunStep.create({
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
  });

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

export async function refreshReadySteps(orgId: string, runId: string) {
  const steps = await db.agentRunStep.findMany({ where: { orgId, runId } });
  const completed = new Set(
    steps.filter((s) => s.status === "completed" || s.status === "skipped").map((s) => s.stepKey),
  );
  for (const step of steps) {
    if (step.status !== "pending") continue;
    if (dependenciesSatisfied(step.dependsOnJson, completed)) {
      await db.agentRunStep.update({
        where: { id: step.id },
        data: { status: "ready" },
      });
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
