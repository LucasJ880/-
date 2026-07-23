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
import { resumeFlowAfterApproval } from "@/lib/agent-core/skills/flow-runner";
import { getTeamApprovalAccessIds } from "@/lib/marketing/team";

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
  /** Phase 3B-A：收敛后的 Run DTO（无关联则为 null） */
  run?: import("@/lib/assistant/run-status-types").AssistantRunStatusDto | null;
  duplicate?: boolean;
}

// ── 统一收件箱 ───────────────────────────────────────────────────

export async function listApprovalInbox(
  userId: string,
): Promise<ApprovalInboxItem[]> {
  const access = await getTeamApprovalAccessIds(userId);
  const [pendingActions, approvalRequests] = await Promise.all([
    db.pendingAction.findMany({
      where: {
        OR: [
          { createdById: userId, orgId: null, projectId: null, approverUserId: null },
          { approverUserId: userId },
          ...(access.orgIds.length ? [{ orgId: { in: access.orgIds } }] : []),
          ...(access.projectIds.length ? [{ projectId: { in: access.projectIds } }] : []),
        ],
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
        projectId: true,
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
        source: { threadId: a.threadId, projectId: a.projectId ?? undefined },
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

async function reconcileAfterPendingAction(input: {
  actionId: string;
  orgId: string | null | undefined;
  userId: string;
  outcome: "executed" | "rejected" | "failed" | "expired";
}): Promise<import("@/lib/assistant/run-status-types").AssistantRunStatusDto | null> {
  const action = await db.pendingAction.findUnique({
    where: { id: input.actionId },
    select: { agentRunId: true, orgId: true, type: true },
  });
  const orgId = action?.orgId || input.orgId;
  if (!action?.agentRunId || !orgId) return null;
  try {
    const { reconcileAssistantRunFromPendingActions } = await import(
      "@/lib/assistant/reconcile-run"
    );
    const recon = await reconcileAssistantRunFromPendingActions({
      orgId,
      runId: action.agentRunId,
      triggeredByUserId: input.userId,
      reason: `pending_action_${input.outcome}`,
      triggerAction: {
        id: input.actionId,
        type: action.type,
        outcome: input.outcome,
      },
    });
    return recon.run;
  } catch (e) {
    console.error("[approval.port] reconcile failed:", e);
    return null;
  }
}

export async function approveApprovalItem(
  kind: ApprovalKind,
  id: string,
  ctx: ApprovalDecisionContext,
): Promise<ApprovalDecisionResult> {
  if (kind === "pending_action") {
    const before = await db.pendingAction.findUnique({
      where: { id },
      select: { agentRunId: true, orgId: true, status: true, type: true },
    });

    // 幂等：已终态 → 收敛并返回既有结果，不重复副作用
    if (
      before &&
      (before.status === "executed" ||
        before.status === "failed" ||
        before.status === "rejected")
    ) {
      const run = await reconcileAfterPendingAction({
        actionId: id,
        orgId: before.orgId || ctx.orgId,
        userId: ctx.userId,
        outcome:
          before.status === "executed"
            ? "executed"
            : before.status === "rejected"
              ? "rejected"
              : "failed",
      });
      return {
        ok: before.status === "executed" || before.status === "rejected",
        status: before.status,
        duplicate: true,
        message:
          before.status === "executed"
            ? "该动作此前已执行"
            : before.status === "rejected"
              ? "该动作此前已取消"
              : "该动作此前已失败",
        run,
      };
    }

    const result = await executePendingAction(id, {
      userId: ctx.userId,
      role: ctx.role,
      orgId: ctx.orgId,
    });

    const after = await db.pendingAction.findUnique({
      where: { id },
      select: { status: true },
    });
    const outcome: "executed" | "failed" | "expired" =
      after?.status === "executed"
        ? "executed"
        : result.error?.includes("过期")
          ? "expired"
          : "failed";

    const run = await reconcileAfterPendingAction({
      actionId: id,
      orgId: before?.orgId || ctx.orgId,
      userId: ctx.userId,
      outcome: result.ok ? "executed" : outcome,
    });

    // 主管 AI：批准后尝试从 AgentRun.supervisorState 恢复（读取 DB 审批状态）
    if (result.ok && before?.agentRunId && before.orgId) {
      try {
        const { loadSupervisorState, resumeSupervisorAfterApproval } =
          await import("@/lib/agent-supervisor");
        const state = await loadSupervisorState(before.orgId, before.agentRunId);
        if (state && state.status === "waiting_for_approval") {
          const resumed = await resumeSupervisorAfterApproval({
            orgId: before.orgId,
            runId: before.agentRunId,
            userId: ctx.userId,
            userRole: ctx.role ?? undefined,
          });
          return {
            ok: result.ok,
            status: result.ok ? "executed" : "failed",
            resultRef: result.resultRef,
            message: [result.message, resumed.text].filter(Boolean).join("\n\n"),
            error: result.error,
            run,
          };
        }
      } catch {
        /* 恢复失败不回滚已批准动作 */
      }
    }
    return {
      ok: result.ok,
      status: result.ok ? "executed" : after?.status === "failed" ? "failed" : "failed",
      resultRef: result.resultRef,
      message: result.message,
      error: result.error,
      run,
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
  const resumed = await resumeFlowAfterApproval(approval.taskId);
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
    const before = await db.pendingAction.findUnique({
      where: { id },
      select: { agentRunId: true, orgId: true, status: true },
    });

    if (before && before.status === "rejected") {
      const run = await reconcileAfterPendingAction({
        actionId: id,
        orgId: before.orgId || ctx.orgId,
        userId: ctx.userId,
        outcome: "rejected",
      });
      return {
        ok: true,
        status: "rejected",
        duplicate: true,
        message: "该动作此前已取消",
        run,
      };
    }

    const result = await rejectPendingAction(
      id,
      { userId: ctx.userId, role: ctx.role, orgId: ctx.orgId },
      ctx.note,
    );

    const run = await reconcileAfterPendingAction({
      actionId: id,
      orgId: before?.orgId || ctx.orgId,
      userId: ctx.userId,
      outcome: result.ok ? "rejected" : "failed",
    });

    // 主管 AI：拒绝后同样恢复，且不得把拒绝当作已执行
    if (result.ok && before?.agentRunId && before.orgId) {
      try {
        const { loadSupervisorState, resumeSupervisorAfterApproval } =
          await import("@/lib/agent-supervisor");
        const state = await loadSupervisorState(before.orgId, before.agentRunId);
        if (state && state.status === "waiting_for_approval") {
          const resumed = await resumeSupervisorAfterApproval({
            orgId: before.orgId,
            runId: before.agentRunId,
            userId: ctx.userId,
            userRole: ctx.role ?? undefined,
          });
          return {
            ok: result.ok,
            status: "rejected",
            message: [
              "已拒绝，动作未执行",
              resumed.text,
            ]
              .filter(Boolean)
              .join("\n\n"),
            error: result.error,
            run,
          };
        }
      } catch {
        /* 恢复失败不改变拒绝结果 */
      }
    }
    return {
      ok: result.ok,
      status: result.ok ? "rejected" : "failed",
      error: result.error,
      run,
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

// ── 超时处理（approval-timeout cron 统一入口） ───────────────────

const APPROVAL_BATCH_SIZE = 200;
const STALE_APPROVAL_HOURS = 48;

export interface ExpireOverdueResult {
  expiredPendingActions: number;
  escalatedApprovals: number;
  staleApprovals: number;
  remindedApprovals: number;
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
    take: APPROVAL_BATCH_SIZE,
  });
  for (const approval of overdue) {
    await escalateApproval(
      approval.id,
      approval.task.createdById,
      approval.task.projectId,
    );
  }

  // 3) 无 deadline 但滞留超过 48h 的步骤级审批：发提醒（不改状态、幂等）
  const staleSince = new Date(
    now.getTime() - STALE_APPROVAL_HOURS * 60 * 60 * 1000,
  );
  const stale = await db.approvalRequest.findMany({
    where: {
      status: "pending",
      deadlineAt: null,
      createdAt: { lte: staleSince },
    },
    include: {
      task: { select: { intent: true, createdById: true, projectId: true } },
      step: { select: { title: true } },
    },
    orderBy: { createdAt: "asc" },
    take: APPROVAL_BATCH_SIZE,
  });

  let reminded = 0;
  for (const approval of stale) {
    const targetUserId = approval.approverUserId ?? approval.task.createdById;
    const existingReminder = await db.notification.findFirst({
      where: { sourceKey: `approval_remind_${approval.id}` },
    });
    if (existingReminder) continue;

    await db.notification.create({
      data: {
        userId: targetUserId,
        type: "agent_approval",
        category: "agent",
        title: `审批提醒：「${approval.step.title}」已等待超过 ${STALE_APPROVAL_HOURS} 小时`,
        summary: `任务：${approval.task.intent}`,
        projectId: approval.task.projectId ?? null,
        entityType: "approval_request",
        entityId: approval.id,
        priority: "high",
        sourceKey: `approval_remind_${approval.id}`,
      },
    });
    reminded++;
  }

  return {
    expiredPendingActions: expired.count,
    escalatedApprovals: overdue.length,
    staleApprovals: stale.length,
    remindedApprovals: reminded,
  };
}
