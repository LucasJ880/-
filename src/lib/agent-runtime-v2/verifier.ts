import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getRuntimeV2Limits } from "./flags";
import { emitRuntimeV2Event } from "./events";
import {
  VerifierOutputSchema,
  type PlannerOutput,
  type VerifierOutput,
} from "./schemas";

async function deterministicVerify(input: {
  orgId: string;
  runId: string;
  plan: PlannerOutput;
}): Promise<VerifierOutput> {
  const steps = await db.agentRunStep.findMany({
    where: { orgId: input.orgId, runId: input.runId },
  });

  const satisfied: string[] = [];
  const unsatisfied: string[] = [];
  const evidence: string[] = [];
  const repairs: string[] = [];

  const failedRequired = steps.filter(
    (s) => s.status === "failed" && s.requiresApproval === false,
  );
  if (failedRequired.length > 0) {
    unsatisfied.push("必要只读/分析步骤失败");
    repairs.push("重新执行失败的分析步骤");
    evidence.push(...failedRequired.map((s) => `step:${s.stepKey}:failed`));
  } else {
    satisfied.push("分析步骤无未恢复失败");
  }

  const writeSteps = steps.filter((s) => s.requiresApproval);
  const pendingWrites = writeSteps.filter((s) => s.status === "awaiting_approval");
  if (pendingWrites.length > 0) {
    return {
      verdict: "BLOCKED",
      summary: "仍有写操作等待审批，暂不验证完成",
      satisfiedCriteria: satisfied,
      unsatisfiedCriteria: ["写操作尚未全部决策"],
      evidenceReferences: pendingWrites.map((s) => `step:${s.stepKey}:awaiting`),
      repairInstructions: [],
    };
  }

  // 检查 PendingAction 执行结果
  const pendingIds = writeSteps
    .flatMap((s) => {
      const ev = s.evidenceJson as { pendingActionIds?: string[] } | null;
      return ev?.pendingActionIds ?? (s.pendingActionId ? [s.pendingActionId] : []);
    })
    .filter(Boolean);

  if (pendingIds.length > 0) {
    const actions = await db.pendingAction.findMany({
      where: { id: { in: pendingIds }, orgId: input.orgId },
      select: { id: true, status: true, type: true, resultRef: true },
    });
    const executed = actions.filter((a) => a.status === "executed");
    const rejected = actions.filter((a) => a.status === "rejected");
    const failed = actions.filter((a) => a.status === "failed");
    evidence.push(
      `pending:executed=${executed.length}`,
      `pending:rejected=${rejected.length}`,
      `pending:failed=${failed.length}`,
    );

    for (const a of executed) {
      if (a.type === "grader.email_draft" && !a.resultRef) {
        unsatisfied.push(`Gmail 草稿 ${a.id} 缺少 resultRef`);
        repairs.push("重新创建 Gmail 草稿 PendingAction 并确认执行");
      }
    }
    if (failed.length > 0) {
      unsatisfied.push("部分 PendingAction 执行失败");
      repairs.push("检查失败原因后重试对应写步骤");
    }
    if (executed.length + rejected.length + failed.length === actions.length) {
      satisfied.push("写操作均已决策");
    }
  } else {
    satisfied.push("无待验证写操作或均已跳过");
  }

  const readDone = steps
    .filter((s) => !s.requiresApproval)
    .every((s) => s.status === "completed" || s.status === "skipped");
  if (readDone) satisfied.push("读取与分析步骤完成");
  else unsatisfied.push("仍有未完成的读取/分析步骤");

  if (unsatisfied.length === 0) {
    return {
      verdict: "PASS",
      summary: "确定性检查通过：步骤与审批结果一致",
      satisfiedCriteria: satisfied,
      unsatisfiedCriteria: [],
      evidenceReferences: evidence,
      repairInstructions: [],
    };
  }

  return {
    verdict: "REPAIR",
    summary: "确定性检查发现问题，需要修复",
    satisfiedCriteria: satisfied,
    unsatisfiedCriteria: unsatisfied,
    evidenceReferences: evidence,
    repairInstructions: repairs,
  };
}

async function modelVerify(input: {
  orgId: string;
  userId: string;
  plan: PlannerOutput;
  deterministic: VerifierOutput;
}): Promise<VerifierOutput> {
  if (input.deterministic.verdict !== "PASS") return input.deterministic;
  try {
    const text = await createCompletion({
      systemPrompt:
        "你是青砚 Agent Runtime Verifier。只根据给定证据判断是否完成用户目标。不得臆造证据。仅输出 JSON：verdict(PASS|REPAIR|NEEDS_HUMAN|BLOCKED), summary, satisfiedCriteria[], unsatisfiedCriteria[], evidenceReferences[], repairInstructions[]。",
      userPrompt: JSON.stringify({
        objective: input.plan.objective,
        criteria: input.plan.completionCriteria,
        deterministic: input.deterministic,
      }),
      temperature: 0,
      maxTokens: 800,
      orgId: input.orgId,
      userId: input.userId,
    });
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return input.deterministic;
    const parsed = VerifierOutputSchema.safeParse(JSON.parse(m[0]));
    if (!parsed.success) return input.deterministic;
    // 模型不得在证据不足时升级为 PASS
    if (
      parsed.data.verdict === "PASS" &&
      input.deterministic.evidenceReferences.length === 0
    ) {
      return {
        ...parsed.data,
        verdict: "NEEDS_HUMAN",
        summary: "证据不足，不能判定完成",
      };
    }
    return parsed.data;
  } catch {
    return input.deterministic;
  }
}

export async function verifyRuntimeV2Run(input: {
  orgId: string;
  runId: string;
  userId: string;
}): Promise<VerifierOutput> {
  const run = await db.agentRun.findFirst({
    where: { id: input.runId, orgId: input.orgId, runtimeVersion: "v2" },
  });
  if (!run?.planJson) {
    return {
      verdict: "NEEDS_HUMAN",
      summary: "缺少计划，无法验证",
      satisfiedCriteria: [],
      unsatisfiedCriteria: ["planJson missing"],
      evidenceReferences: [],
      repairInstructions: [],
    };
  }

  await db.agentRun.update({
    where: { id: input.runId },
    data: { status: "verifying" },
  });
  await emitRuntimeV2Event({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "verification.started",
    title: "正在验证执行结果",
  });

  const plan = run.planJson as unknown as PlannerOutput;
  const deterministic = await deterministicVerify({
    orgId: input.orgId,
    runId: input.runId,
    plan,
  });
  const final = await modelVerify({
    orgId: input.orgId,
    userId: input.userId,
    plan,
    deterministic,
  });

  const prior = await db.agentRunVerification.count({
    where: { orgId: input.orgId, runId: input.runId },
  });
  const attempt = prior + 1;
  await db.agentRunVerification.create({
    data: {
      orgId: input.orgId,
      runId: input.runId,
      attempt,
      verdict: final.verdict,
      summary: final.summary,
      satisfiedCriteriaJson: final.satisfiedCriteria,
      unsatisfiedCriteriaJson: final.unsatisfiedCriteria,
      evidenceReferencesJson: final.evidenceReferences,
      repairInstructionsJson: final.repairInstructions,
    },
  });

  const { maxRepairs } = getRuntimeV2Limits();

  if (final.verdict === "PASS") {
    await db.agentRun.update({
      where: { id: input.runId },
      data: { status: "completed", completedAt: new Date() },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "verification.passed",
      title: "验证通过",
      payload: { summary: final.summary },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "run.completed",
      title: "任务已完成",
      payload: { summary: final.summary },
    });
    return final;
  }

  if (final.verdict === "BLOCKED") {
    await db.agentRun.update({
      where: { id: input.runId },
      data: { status: "awaiting_approval" },
    });
    return final;
  }

  if (final.verdict === "REPAIR" && attempt <= maxRepairs) {
    await db.agentRun.update({
      where: { id: input.runId },
      data: { status: "repairing" },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "verification.repair_required",
      title: "发现未完成项，正在修复",
      payload: { attempt, instructions: final.repairInstructions },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "repair.started",
      title: `修复轮次 ${attempt}`,
    });
    // 最小 repair：将 failed 的非审批步骤重置为 ready
    await db.agentRunStep.updateMany({
      where: {
        orgId: input.orgId,
        runId: input.runId,
        status: "failed",
        requiresApproval: false,
      },
      data: { status: "ready", errorCode: null, errorMessage: null },
    });
    await db.agentRun.update({
      where: { id: input.runId },
      data: { status: "executing" },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "repair.completed",
      title: "已安排修复重试",
    });
    return final;
  }

  await db.agentRun.update({
    where: { id: input.runId },
    data: {
      status: "needs_human",
      errorMessage: final.summary,
    },
  });
  await emitRuntimeV2Event({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "verification.needs_human",
    title: "需要人工处理",
    payload: { summary: final.summary, attempt },
  });
  await emitRuntimeV2Event({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "run.needs_human",
    title: "需要人工处理",
  });
  return final;
}
