/**
 * Phase 2B-1 契约真实 fixture 辅助（Final Review FIX 1 之后）
 *
 * 2B-1 起，workforce 计划的每个 Step 都携带 workforceTask spec，且运行时
 * 保证"终态与信封同写"。测试若手工伪造 completed Step（跳过 runtime），
 * 必须同样补上 server builder 产出的真实信封——否则下游消费 gate 会按
 * HANDOFF_MISSING fail-closed（这正是 FIX 1 的目标语义，不是测试要绕过
 * 的东西）。spec absent 的 legacy Step 不需要信封（TRUE LEGACY 放行）。
 */

export async function fabricateContractCompletedStep(input: {
  runId: string;
  stepKey: string;
  businessOutput: Record<string, unknown>;
}): Promise<void> {
  const { db } = await import("@/lib/db");
  const { readWorkforceTaskSpec } = await import("../task-contract");
  const { buildWorkforceHandoffV1 } = await import("../handoff");

  const step = await db.agentRunStep.findFirstOrThrow({
    where: { runId: input.runId, stepKey: input.stepKey },
  });
  const completedAt = new Date();
  const outputJson: Record<string, unknown> = { ...input.businessOutput };

  const spec = readWorkforceTaskSpec(step.inputJson);
  if (spec.kind === "valid") {
    const handoff = buildWorkforceHandoffV1({
      runId: input.runId,
      stepKey: input.stepKey,
      workerKey: spec.spec.worker.workerKey,
      taskKind: spec.spec.taskKind,
      stepStatus: "completed",
      taskObjective: spec.spec.objective,
      businessOutput: input.businessOutput,
      completedAt,
    });
    if (!handoff.ok) {
      throw new Error(
        `fabricateContractCompletedStep: handoff build failed (${handoff.code})`,
      );
    }
    outputJson.workforceHandoff = handoff.payload;
  }

  await db.agentRunStep.updateMany({
    where: { runId: input.runId, stepKey: input.stepKey },
    data: {
      status: "completed",
      attemptCount: 1,
      completedAt,
      outputJson: JSON.parse(JSON.stringify(outputJson)),
    },
  });
}
