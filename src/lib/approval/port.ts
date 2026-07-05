/**
 * ApprovalPort — 统一审批服务层（A-P3：Agent 三栈合并）
 *
 * 统一两套审批机制的创建后生命周期（列表 / 确认 / 拒绝 / 超时）：
 * - PendingAction    对话草稿审批（agent-core / Grader / 微信数字确认）
 * - ApprovalRequest  AgentTask 步骤级审批（旧编排栈，含 deadline / escalation）
 *
 * 两张表保留各自语义，本层只做端口收敛：
 * 微信数字确认、助手 inbox、agent-tasks 审批卡三个入口统一经此层进出。
 * 底层执行仍复用 pending-actions/executor 与 agent/approval（不重复实现副作用）。
 */

import { db } from "@/lib/db";
import {
  executePendingAction,
  rejectPendingAction,
} from "@/lib/pending-actions/executor";
import {
  resolveApproval,
  getPendingApprovals,
  escalateApproval,
} from "@/lib/agent/approval";
import { resumeAfterApproval } from "@/lib/agent/executor";

export type ApprovalKind = "pending_action" | "approval_request";

/** 统一收件箱条目（两张表归一后的最小公共视图） */
export interface ApprovalInboxItem {
  kind: ApprovalKind;
  id: string;
  title: string;
  preview: string;
  /** pending_action 的 type / approval_request 的 actionType */
  actionType: string;
  riskLevel: string | null;
  status: string;
  createdAt: Date;
  /** 到期时间：PendingAction.expiresAt / ApprovalRequest.deadlineAt */
  dueAt: Date | null;
  /** 来源定位信息 */
  source: {
    threadId?: string | null;
    taskId?: string;
    stepId?: string;
    projectId?: string;
    projectName?: string;
  };
}

export interface ApprovalDecisionContext {
  userId: string;
  role: string | null | undefined;
  /** 跨组织防护（微信链路必传，见 executor） */
  orgId?: string | null;
  note?: string;
  acceptedWithRisk?: boolean;
}

export interface ApprovalDecisionResult {
  ok: boolean;
  status?: string;
  resultRef?: string;
  message?: string;
  error?: string;
}

// ── 统一收件箱 ───────────────────────────────────────────────────

export async function listApprovalInbox(
  userId: string,
): Promise<ApprovalInboxItem[]> {
  const [pendingActions, approvalRequests] = await Promise.all([
    db.pendingAction.findMany({
      where: {
        createdById: userId,
        status: "pending",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        title: true,
        preview: true,
        status: true,
        threadId: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
    getPendingApprovals(userId),
  ]);

  const items: ApprovalInboxItem[] = [
    ...pendingActions.map(
      (a): ApprovalInboxItem => ({
        kind: "pending_action",
        id: a.id,
        title: a.title,
        preview: a.preview,
        actionType: a.type,
        riskLevel: null,
        status: a.status,
        createdAt: a.createdAt,
        dueAt: a.expiresAt,
        source: { threadId: a.threadId },
      }),
    ),
    ...approvalRequests.map(
      (r): ApprovalInboxItem => ({
        kind: "approval_request",
        id: r.id,
        title: r.step.title,
        preview: r.riskReason ?? r.previewJson ?? "",
        actionType: r.actionType,
        riskLevel: r.riskLevel,
        status: "pending",
        createdAt: r.createdAt,
        dueAt: null,
        source: {
          taskId: r.taskId,
          stepId: r.stepId,
          projectId: r.task.project.id,
          projectName: r.task.project.name,
        },
      }),
    ),
  ];

  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ── 确认 / 拒绝 ─────────────────────────────────────────────────

export async function approveApprovalItem(
  kind: ApprovalKind,
  id: string,
  ctx: ApprovalDecisionContext,
): Promise<ApprovalDecisionResult> {
  if (kind === "pending_action") {
    const result = await executePendingAction(id, {
      userId: ctx.userId,
      role: ctx.role,
      orgId: ctx.orgId,
    });
    return {
      ok: result.ok,
      status: result.ok ? "executed" : "failed",
      resultRef: result.resultRef,
      message: result.message,
      error: result.error,
    };
  }

  const approval = await db.approvalRequest.findFirst({
    where: { id, status: "pending" },
    select: { id: true, taskId: true },
  });
  if (!approval) {
    return { ok: false, error: "无待处理的审批请求" };
  }

  await resolveApproval({
    approvalId: approval.id,
    decision: "approved",
    userId: ctx.userId,
    note: ctx.note,
    acceptedWithRisk: ctx.acceptedWithRisk,
  });

  // 步骤级审批通过后自动恢复任务执行（旧编排栈语义）
  const resumed = await resumeAfterApproval(approval.taskId);
  return {
    ok: true,
    status: resumed.status,
    resultRef: approval.taskId,
    message: resumed.reason,
  };
}

export async function rejectApprovalItem(
  kind: ApprovalKind,
  id: string,
  ctx: ApprovalDecisionContext,
): Promise<ApprovalDecisionResult> {
  if (kind === "pending_action") {
    const result = await rejectPendingAction(
      id,
      { userId: ctx.userId, role: ctx.role, orgId: ctx.orgId },
      ctx.note,
    );
    return {
      ok: result.ok,
      status: result.ok ? "rejected" : "failed",
      error: result.error,
    };
  }

  const approval = await db.approvalRequest.findFirst({
    where: { id, status: "pending" },
    select: { id: true, taskId: true },
  });
  if (!approval) {
    return { ok: false, error: "无待处理的审批请求" };
  }

  await resolveApproval({
    approvalId: approval.id,
    decision: "rejected",
    userId: ctx.userId,
    note: ctx.note,
  });
  await db.agentTask.update({
    where: { id: approval.taskId },
    data: { status: "rejected" },
  });

  return { ok: true, status: "rejected", resultRef: approval.taskId };
}

// ── 超时处理（cron 入口，A-P4 切换 approval-timeout 时调用） ─────

export interface ExpireOverdueResult {
  expiredPendingActions: number;
  escalatedApprovals: number;
}

export async function expireOverdueApprovals(
  now = new Date(),
): Promise<ExpireOverdueResult> {
  // 1) 过期的对话草稿：批量标记 failed（与 executor 单个过期语义一致）
  const expired = await db.pendingAction.updateMany({
    where: { status: "pending", expiresAt: { lte: now } },
    data: { status: "failed", failureReason: "已过期" },
  });

  // 2) 超过 deadline 的步骤级审批：逐个升级 + 通知（复用现有 escalation）
  const overdue = await db.approvalRequest.findMany({
    where: { status: "pending", deadlineAt: { lte: now } },
    select: {
      id: true,
      task: { select: { createdById: true, projectId: true } },
    },
    orderBy: { deadlineAt: "asc" },
    take: 50,
  });
  for (const approval of overdue) {
    await escalateApproval(
      approval.id,
      approval.task.createdById,
      approval.task.projectId,
    );
  }

  return {
    expiredPendingActions: expired.count,
    escalatedApprovals: overdue.length,
  };
}
