import { db } from "@/lib/db";
import { createAgentRun } from "@/lib/agent-runtime/run";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import { emitRuntimeV2Event, userFacingRunLabel } from "./events";
import { executeRuntimeV2Round } from "./executor";
import {
  isAgentRuntimeV2Enabled,
  looksLikeRuntimeV2Goal,
} from "./flags";
import { planAgentRuntimeV2 } from "./planner";
import { persistPlanAndSteps } from "./persist";
import { verifyRuntimeV2Run } from "./verifier";
import { RUNTIME_V2_TOOL_CATALOG } from "./tool-catalog";

export type StartRuntimeV2Input = {
  orgId: string;
  userId: string;
  role: string;
  goal: string;
  channel?: string;
  threadId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
};

export type StartRuntimeV2Result =
  | {
      ok: true;
      runId: string;
      status: string;
      userLabel: string;
      clarification?: undefined;
      report?: string;
    }
  | { ok: false; error: string; clarification?: string };

export function shouldRouteToRuntimeV2(input: {
  orgId: string;
  userId: string;
  role: string;
  goal: string;
}): boolean {
  if (
    !isAgentRuntimeV2Enabled({
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
    })
  ) {
    return false;
  }
  return looksLikeRuntimeV2Goal(input.goal);
}

export async function startAgentRuntimeV2Run(
  input: StartRuntimeV2Input,
): Promise<StartRuntimeV2Result> {
  if (
    !isAgentRuntimeV2Enabled({
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
    })
  ) {
    return { ok: false, error: "AGENT_RUNTIME_V2_DISABLED" };
  }

  const session = await getOrCreateAgentSession({
    orgId: input.orgId,
    userId: input.userId,
    channel: input.channel ?? "web_assistant",
    channelUserId: input.userId,
    channelConversationId: input.threadId ?? null,
  });

  const created = await createAgentRun({
    orgId: input.orgId,
    sessionId: session.id,
    userMessageId: input.userMessageId ?? undefined,
    runType: "runtime_v2",
    intent: "sales_followup_triage",
    metadata: {
      runtimeVersion: "v2",
      goal: input.goal,
      threadId: input.threadId ?? null,
      initiatedByUserId: input.userId,
      assistantMessageId: input.assistantMessageId ?? null,
      channel: input.channel ?? "web_assistant",
    },
  });
  const runId = created.run.id;

  await db.agentRun.update({
    where: { id: runId },
    data: {
      runtimeVersion: "v2",
      status: "planning",
      startedAt: new Date(),
    },
  });

  await emitRuntimeV2Event({
    orgId: input.orgId,
    runId,
    eventType: "plan.started",
    title: "正在理解目标",
    payload: { goal: input.goal },
  });

  const planned = await planAgentRuntimeV2({
    orgId: input.orgId,
    userId: input.userId,
    userRole: input.role,
    channel: input.channel ?? "web",
    goal: input.goal,
    availableTools: RUNTIME_V2_TOOL_CATALOG,
  });

  if (!planned.ok) {
    await db.agentRun.update({
      where: { id: runId },
      data: {
        status: planned.clarification ? "needs_human" : "failed",
        errorMessage: planned.error,
      },
    });
    return {
      ok: false,
      error: planned.error,
      clarification: planned.clarification,
    };
  }

  await persistPlanAndSteps({
    orgId: input.orgId,
    runId,
    plan: planned.plan,
  });

  // 驱动若干轮直到等待审批或需要验证（Serverless 友好：每轮持久化）
  const processed = await processAgentRuntimeV2Run({
    orgId: input.orgId,
    runId,
    userId: input.userId,
    role: input.role,
    threadId: input.threadId,
    maxRounds: 12,
  });

  return {
    ok: true,
    runId,
    status: processed.status,
    userLabel: userFacingRunLabel(processed.status),
    report: processed.report,
  };
}

export async function processAgentRuntimeV2Run(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string;
  threadId?: string | null;
  maxRounds?: number;
}): Promise<{ status: string; report?: string }> {
  const maxRounds = input.maxRounds ?? 8;
  for (let i = 0; i < maxRounds; i++) {
    const run = await db.agentRun.findFirst({
      where: {
        id: input.runId,
        orgId: input.orgId,
        runtimeVersion: "v2",
      },
      select: { status: true },
    });
    if (!run) return { status: "failed", report: "Run not found" };
    if (
      ["completed", "failed", "cancelled", "needs_human", "partially_executed"].includes(
        run.status,
      )
    ) {
      return { status: run.status, report: await buildFinalReport(input.orgId, input.runId) };
    }
    if (run.status === "awaiting_approval") {
      return {
        status: "awaiting_approval",
        report: await buildFinalReport(input.orgId, input.runId),
      };
    }
    if (run.status === "verifying" || run.status === "repairing") {
      await verifyRuntimeV2Run({
        orgId: input.orgId,
        runId: input.runId,
        userId: input.userId,
      });
      continue;
    }

    const round = await executeRuntimeV2Round({
      orgId: input.orgId,
      runId: input.runId,
      userId: input.userId,
      role: input.role,
      threadId: input.threadId,
    });

    if (round.status === "awaiting_approval") {
      return {
        status: "awaiting_approval",
        report: await buildFinalReport(input.orgId, input.runId),
      };
    }
    if (round.status === "ready_for_verification") {
      await verifyRuntimeV2Run({
        orgId: input.orgId,
        runId: input.runId,
        userId: input.userId,
      });
      continue;
    }
    if (round.status === "failed" || round.status === "cancelled") {
      return { status: round.status, report: round.status === "failed" ? round.error : undefined };
    }
  }

  const latest = await db.agentRun.findFirst({
    where: { id: input.runId, orgId: input.orgId },
    select: { status: true },
  });
  return {
    status: latest?.status ?? "executing",
    report: await buildFinalReport(input.orgId, input.runId),
  };
}

/** 审批决策后恢复 V2 Run */
export async function resumeRuntimeV2AfterApproval(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string;
}): Promise<{ status: string; report?: string }> {
  const steps = await db.agentRunStep.findMany({
    where: { orgId: input.orgId, runId: input.runId, status: "awaiting_approval" },
  });

  for (const step of steps) {
    const ids =
      (step.evidenceJson as { pendingActionIds?: string[] } | null)
        ?.pendingActionIds ??
      (step.pendingActionId ? [step.pendingActionId] : []);
    if (ids.length === 0) continue;
    const actions = await db.pendingAction.findMany({
      where: { id: { in: ids }, orgId: input.orgId },
      select: { id: true, status: true },
    });
    const allDecided = actions.every((a) =>
      ["executed", "rejected", "failed"].includes(a.status),
    );
    if (!allDecided) continue;

    const anyExecuted = actions.some((a) => a.status === "executed");
    const allRejected = actions.every((a) => a.status === "rejected");
    await db.agentRunStep.update({
      where: { id: step.id },
      data: {
        status: allRejected ? "skipped" : anyExecuted ? "completed" : "failed",
        completedAt: new Date(),
        outputJson: JSON.parse(
          JSON.stringify({
            ...(typeof step.outputJson === "object" && step.outputJson
              ? step.outputJson
              : {}),
            approvalStatuses: actions,
          }),
        ),
      },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "approval.resolved",
      title: step.title,
      payload: { stepKey: step.stepKey, actions },
    });
  }

  const stillAwaiting = await db.agentRunStep.count({
    where: {
      orgId: input.orgId,
      runId: input.runId,
      status: "awaiting_approval",
    },
  });
  if (stillAwaiting === 0) {
    await db.agentRun.update({
      where: { id: input.runId },
      data: { status: "executing" },
    });
  }

  return processAgentRuntimeV2Run({
    orgId: input.orgId,
    runId: input.runId,
    userId: input.userId,
    role: input.role,
    maxRounds: 12,
  });
}

export async function buildFinalReport(
  orgId: string,
  runId: string,
): Promise<string> {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
    include: {
      steps: true,
      verifications: { orderBy: { attempt: "desc" }, take: 1 },
    },
  });
  if (!run) return "未找到运行记录";

  const plan = run.planJson as { summary?: string; objective?: string } | null;
  const prioritize = run.steps.find((s) => s.stepKey === "s5_prioritize");
  const prioritized =
    (
      prioritize?.outputJson as {
        prioritized?: Array<{ customerName: string; reason?: string }>;
        selectedCount?: number;
      } | null
    )?.prioritized ?? [];

  const writeSteps = run.steps.filter((s) => s.requiresApproval);
  const awaiting = writeSteps.filter((s) => s.status === "awaiting_approval").length;
  const completedWrites = writeSteps.filter((s) => s.status === "completed").length;
  const skippedWrites = writeSteps.filter((s) => s.status === "skipped").length;

  const lines: string[] = [];
  lines.push(plan?.summary ?? plan?.objective ?? "销售跟进处理");
  lines.push("");
  if (prioritized.length > 0) {
    lines.push(
      `已选出 ${prioritized.length} 个高优先级客户：${prioritized
        .map((p) => p.customerName)
        .join("、")}`,
    );
  }
  lines.push(
    `写操作：等待确认 ${awaiting}，已执行 ${completedWrites}，跳过 ${skippedWrites}`,
  );
  if (run.status === "awaiting_approval") {
    lines.push("");
    lines.push("上述动作正在等待确认。确认后我会验证任务/日期/草稿是否真实创建，再给出最终报告。");
  }
  if (run.verifications[0]) {
    lines.push("");
    lines.push(`验证：${run.verifications[0].verdict} — ${run.verifications[0].summary}`);
  }
  if (run.status === "needs_human") {
    lines.push("");
    lines.push("需要人工处理未完成项，请查看步骤详情。");
  }
  return lines.join("\n");
}

export async function getRuntimeV2WorkbenchView(orgId: string, runId: string) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId, runtimeVersion: "v2" },
    include: {
      steps: { orderBy: { createdAt: "asc" } },
      verifications: { orderBy: { attempt: "asc" } },
      events: {
        where: { visibleToUser: true },
        orderBy: { sequence: "asc" },
        take: 40,
      },
    },
  });
  if (!run) return null;
  return {
    runId: run.id,
    status: run.status,
    userLabel: userFacingRunLabel(run.status),
    objective:
      (run.planJson as { objective?: string } | null)?.objective ?? null,
    summary: (run.planJson as { summary?: string } | null)?.summary ?? null,
    steps: run.steps.map((s) => ({
      stepKey: s.stepKey,
      title: s.title,
      status: s.status,
      toolName: s.preferredTool,
      requiresApproval: s.requiresApproval,
      attemptCount: s.attemptCount,
      errorMessage: s.errorMessage,
    })),
    verifications: run.verifications.map((v) => ({
      attempt: v.attempt,
      verdict: v.verdict,
      summary: v.summary,
    })),
    events: run.events.map((e) => ({
      sequence: e.sequence,
      eventType: e.eventType,
      title: e.title,
    })),
    report: await buildFinalReport(orgId, runId),
  };
}
