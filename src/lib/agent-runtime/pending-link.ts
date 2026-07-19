/**
 * PendingAction ↔ AgentRun 联动
 */

import { db } from "@/lib/db";
import {
  appendAgentRunEvent,
  completeAgentRun,
  updateAgentRunStatus,
} from "./run";

/** 草稿创建后：Run 进入 awaiting_approval */
export async function markAgentRunAwaitingApproval(
  orgId: string,
  agentRunId: string,
) {
  const run = await db.agentRun.findFirst({
    where: { id: agentRunId, orgId },
    select: { id: true, status: true },
  });
  if (!run) return;
  if (
    run.status === "cancelled" ||
    run.status === "failed" ||
    run.status === "completed"
  ) {
    return;
  }

  await updateAgentRunStatus(orgId, agentRunId, "awaiting_approval");
  await appendAgentRunEvent({
    orgId,
    runId: agentRunId,
    eventType: "approval.required",
    title: "等待你确认待审批动作",
    visibleToUser: true,
  });
}

/** 取消 Run 时：拒绝该 Run 下未决 PendingAction（不自动执行） */
export async function rejectPendingActionsForAgentRun(input: {
  orgId: string;
  agentRunId: string;
  userId?: string;
  reason?: string;
}): Promise<number> {
  const pending = await db.pendingAction.findMany({
    where: {
      agentRunId: input.agentRunId,
      status: "pending",
      OR: [
        { orgId: input.orgId },
        // 旧数据可能把 org 只放在 payload；仍限制 createdBy 同会话用户可选
        { orgId: null },
      ],
    },
    select: { id: true, orgId: true, createdById: true },
  });

  let rejected = 0;
  const now = new Date();
  for (const a of pending) {
    // 跨组织防护：有 orgId 则必须匹配
    if (a.orgId && a.orgId !== input.orgId) continue;
    await db.pendingAction.update({
      where: { id: a.id },
      data: {
        status: "rejected",
        decidedAt: now,
        decidedById: input.userId || a.createdById,
        failureReason: input.reason || "关联任务已取消，待确认动作已拒绝",
      },
    });
    rejected++;
  }

  return rejected;
}

/**
 * 完成 Run 前：若仍有未决审批，则保持 awaiting_approval，不标 completed
 */
export async function completeAgentRunRespectingApprovals(
  orgId: string,
  agentRunId: string,
) {
  const pendingCount = await db.pendingAction.count({
    where: {
      agentRunId,
      status: "pending",
      OR: [{ orgId }, { orgId: null }],
    },
  });

  if (pendingCount > 0) {
    await markAgentRunAwaitingApproval(orgId, agentRunId);
    return { completed: false as const, pendingCount };
  }

  await completeAgentRun(orgId, agentRunId);
  return { completed: true as const, pendingCount: 0 };
}

/** 审批处理完后：若该 Run 无未决草稿，则标 completed */
export async function maybeCompleteAgentRunAfterApproval(input: {
  orgId: string | null | undefined;
  agentRunId: string | null | undefined;
}) {
  if (!input.orgId || !input.agentRunId) return;

  const run = await db.agentRun.findFirst({
    where: { id: input.agentRunId, orgId: input.orgId },
    select: { id: true, status: true },
  });
  if (!run) return;
  if (run.status === "cancelled" || run.status === "failed") return;

  const pendingCount = await db.pendingAction.count({
    where: {
      agentRunId: input.agentRunId,
      status: "pending",
    },
  });
  if (pendingCount > 0) return;

  if (run.status === "awaiting_approval" || run.status === "running") {
    await completeAgentRun(input.orgId, input.agentRunId);
  }
}
