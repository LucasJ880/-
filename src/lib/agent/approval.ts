/**
 * 审批服务 — 管理人工授权节点
 */

import { db } from "@/lib/db";
import type { ApprovalDecision, RiskLevel } from "./types";

interface CreateApprovalInput {
  taskId: string;
  stepId: string;
  actionType: string;
  riskLevel: RiskLevel;
  riskReason?: string;
  previewData?: Record<string, unknown>;
  approverUserId?: string;
  projectId?: string;
}

const DEADLINE_HOURS: Record<string, number> = {
  low: 72,
  medium: 48,
  high: 24,
};

export async function createApproval(input: CreateApprovalInput): Promise<string> {
  const deadlineHours = DEADLINE_HOURS[input.riskLevel] ?? 48;
  const deadlineAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

  const approval = await db.approvalRequest.create({
    data: {
      taskId: input.taskId,
      stepId: input.stepId,
      actionType: input.actionType,
      riskLevel: input.riskLevel,
      riskReason: input.riskReason ?? null,
      previewJson: input.previewData ? JSON.stringify(input.previewData) : null,
      approverUserId: input.approverUserId ?? null,
      status: "pending",
      deadlineAt,
    },
  });

  // 推送通知给审批人（或项目所有成员）
  if (input.approverUserId) {
    await db.notification.create({
      data: {
        userId: input.approverUserId,
        type: "agent_approval",
        category: "agent",
        title: `AI 任务待审批：${input.actionType}`,
        summary: input.riskReason ?? `风险等级：${input.riskLevel}`,
        projectId: input.projectId ?? null,
        entityType: "approval_request",
        entityId: approval.id,
        priority: input.riskLevel === "high" ? "high" : "medium",
        sourceKey: `approval_${approval.id}`,
      },
    });
  }

  return approval.id;
}

interface ResolveApprovalInput {
  approvalId: string;
  decision: ApprovalDecision;
  userId: string;
  note?: string;
  acceptedWithRisk?: boolean;
}

export async function resolveApproval(
  input: ResolveApprovalInput
): Promise<{ taskId: string; stepId: string }> {
  const approval = await db.approvalRequest.update({
    where: { id: input.approvalId },
    data: {
      status: input.decision === "skipped" ? "approved" : input.decision,
      decidedAt: new Date(),
      decidedBy: input.userId,
      decisionNote: input.note ?? null,
      acceptedWithRisk: input.acceptedWithRisk ?? false,
    },
  });

  // 更新步骤状态
  const stepStatus =
    input.decision === "approved" || input.decision === "skipped"
      ? "approved"
      : "rejected";

  await db.agentTaskStep.update({
    where: { id: approval.stepId },
    data: {
      status: stepStatus,
      approvedBy: input.decision !== "rejected" ? input.userId : null,
      approvedAt: input.decision !== "rejected" ? new Date() : null,
      rejectionNote: input.decision === "rejected" ? input.note ?? null : null,
    },
  });

  return { taskId: approval.taskId, stepId: approval.stepId };
}

export async function getPendingApprovals(
  userId: string
): Promise<
  Array<{
    id: string;
    taskId: string;
    stepId: string;
    actionType: string;
    riskLevel: string;
    riskReason: string | null;
    previewJson: string | null;
    createdAt: Date;
    task: { intent: string; project: { id: string; name: string } };
    step: { title: string; agentName: string };
  }>
> {
  return db.approvalRequest.findMany({
    where: {
      status: "pending",
      OR: [
        { approverUserId: userId },
        { approverUserId: null },
      ],
    },
    include: {
      task: {
        select: {
          intent: true,
          project: { select: { id: true, name: true } },
        },
      },
      step: {
        select: { title: true, agentName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 审批超时升级：标记为 escalated，通知项目所有者
 */
export async function escalateApproval(
  approvalId: string,
  creatorUserId: string,
  projectId: string | null
): Promise<void> {
  await db.approvalRequest.update({
    where: { id: approvalId },
    data: { status: "escalated" },
  });

  await db.notification.create({
    data: {
      userId: creatorUserId,
      type: "agent_approval",
      category: "agent",
      title: "审批已超时升级",
      summary: "审批请求已超过截止时间，请尽快处理或取消任务",
      projectId: projectId ?? null,
      entityType: "approval_request",
      entityId: approvalId,
      priority: "urgent",
      sourceKey: `approval_escalate_${approvalId}`,
    },
  });
}
