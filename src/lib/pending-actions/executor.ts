/**
 * PR4 — PendingAction 执行器
 *
 * 用户点"批准"时调用。职责：
 * - 再次做权限校验（防止 action 过期或用户角色变化后越权）
 * - 按 type 分发到真实 DB 写入
 * - 更新 PendingAction 状态
 * - 写审计日志
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { canSeeResource } from "@/lib/rbac/data-scope";
import type {
  PendingActionType,
  SalesUpdateFollowupPayload,
  SalesUpdateStagePayload,
  CalendarCreateEventPayload,
} from "./types";

interface ExecuteContext {
  userId: string;
  role: string | null | undefined;
}

export interface ExecuteResult {
  ok: boolean;
  resultRef?: string;
  message?: string;
  error?: string;
}

/** 对外入口 —— 按 id 取草稿并执行 */
export async function executePendingAction(
  actionId: string,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const action = await db.pendingAction.findUnique({
    where: { id: actionId },
  });
  if (!action) {
    return { ok: false, error: "草稿不存在" };
  }

  if (action.createdById !== ctx.userId) {
    return { ok: false, error: "无权操作该草稿" };
  }

  if (action.status !== "pending" && action.status !== "approved") {
    return {
      ok: false,
      error: `该草稿状态为 ${action.status}，不能重复执行`,
    };
  }

  if (action.expiresAt.getTime() < Date.now()) {
    await db.pendingAction.update({
      where: { id: actionId },
      data: { status: "failed", failureReason: "已过期" },
    });
    return { ok: false, error: "草稿已过期" };
  }

  // 标记为 approved（进入执行态），避免并发重复执行
  await db.pendingAction.update({
    where: { id: actionId },
    data: { status: "approved", decidedAt: new Date() },
  });

  let exec: ExecuteResult;
  try {
    switch (action.type as PendingActionType) {
      case "sales.update_followup":
        exec = await execSalesUpdateFollowup(
          action.payload as unknown as SalesUpdateFollowupPayload,
          ctx,
        );
        break;
      case "sales.update_stage":
        exec = await execSalesUpdateStage(
          action.payload as unknown as SalesUpdateStagePayload,
          ctx,
        );
        break;
      case "calendar.create_event":
        exec = await execCalendarCreateEvent(
          action.payload as unknown as CalendarCreateEventPayload,
          ctx,
        );
        break;
      default:
        exec = { ok: false, error: `未知动作类型 ${action.type}` };
    }
  } catch (err) {
    exec = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (exec.ok) {
    await db.pendingAction.update({
      where: { id: actionId },
      data: {
        status: "executed",
        executedAt: new Date(),
        resultRef: exec.resultRef,
      },
    });
    await logAudit({
      userId: ctx.userId,
      action: "ai_draft_approve",
      targetType: "pending_action",
      targetId: actionId,
      afterData: {
        type: action.type,
        resultRef: exec.resultRef,
      },
    });
  } else {
    await db.pendingAction.update({
      where: { id: actionId },
      data: { status: "failed", failureReason: exec.error },
    });
    await logAudit({
      userId: ctx.userId,
      action: "ai_draft_fail",
      targetType: "pending_action",
      targetId: actionId,
      afterData: { error: exec.error },
    });
  }

  return exec;
}

/** 对外入口 —— 用户点"拒绝" */
export async function rejectPendingAction(
  actionId: string,
  ctx: ExecuteContext,
  reason?: string,
): Promise<ExecuteResult> {
  const action = await db.pendingAction.findUnique({
    where: { id: actionId },
  });
  if (!action) return { ok: false, error: "草稿不存在" };
  if (action.createdById !== ctx.userId) {
    return { ok: false, error: "无权操作该草稿" };
  }
  if (action.status !== "pending") {
    return { ok: false, error: `该草稿状态为 ${action.status}，不能拒绝` };
  }

  await db.pendingAction.update({
    where: { id: actionId },
    data: {
      status: "rejected",
      decidedAt: new Date(),
      failureReason: reason ?? undefined,
    },
  });

  await logAudit({
    userId: ctx.userId,
    action: "ai_draft_reject",
    targetType: "pending_action",
    targetId: actionId,
    afterData: { reason },
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 各类动作的具体执行
// ─────────────────────────────────────────────────────────────

async function execSalesUpdateFollowup(
  payload: SalesUpdateFollowupPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const opp = await db.salesOpportunity.findUnique({
    where: { id: payload.opportunityId },
    select: {
      id: true,
      createdById: true,
      assignedToId: true,
      nextFollowupAt: true,
    },
  });
  if (!opp) return { ok: false, error: "商机不存在" };

  if (
    !canSeeResource(ctx.role, ctx.userId, {
      createdById: opp.createdById,
      assignedToId: opp.assignedToId,
    })
  ) {
    return { ok: false, error: "无权修改该商机" };
  }

  await db.salesOpportunity.update({
    where: { id: opp.id },
    data: { nextFollowupAt: new Date(payload.nextFollowupAt) },
  });

  await logAudit({
    userId: ctx.userId,
    action: "update",
    targetType: "sales_opportunity",
    targetId: opp.id,
    beforeData: { nextFollowupAt: opp.nextFollowupAt },
    afterData: { nextFollowupAt: payload.nextFollowupAt, via: "ai_draft" },
  });

  return { ok: true, resultRef: opp.id, message: "已更新下次跟进时间" };
}

async function execSalesUpdateStage(
  payload: SalesUpdateStagePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const opp = await db.salesOpportunity.findUnique({
    where: { id: payload.opportunityId },
    select: {
      id: true,
      createdById: true,
      assignedToId: true,
      stage: true,
    },
  });
  if (!opp) return { ok: false, error: "商机不存在" };

  if (
    !canSeeResource(ctx.role, ctx.userId, {
      createdById: opp.createdById,
      assignedToId: opp.assignedToId,
    })
  ) {
    return { ok: false, error: "无权修改该商机" };
  }

  await db.salesOpportunity.update({
    where: { id: opp.id },
    data: { stage: payload.newStage },
  });

  await logAudit({
    userId: ctx.userId,
    action: "update",
    targetType: "sales_opportunity",
    targetId: opp.id,
    beforeData: { stage: opp.stage },
    afterData: { stage: payload.newStage, via: "ai_draft" },
  });

  return { ok: true, resultRef: opp.id, message: "已推进商机阶段" };
}

async function execCalendarCreateEvent(
  payload: CalendarCreateEventPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const event = await db.calendarEvent.create({
    data: {
      userId: ctx.userId,
      title: payload.title,
      description: payload.description,
      startTime: new Date(payload.startTime),
      endTime: new Date(payload.endTime),
      allDay: payload.allDay ?? false,
      location: payload.location,
      reminderMinutes: payload.reminderMinutes ?? 15,
      source: "qingyan",
    },
    select: { id: true },
  });

  await logAudit({
    userId: ctx.userId,
    action: "create",
    targetType: "calendar_event",
    targetId: event.id,
    afterData: { ...payload, via: "ai_draft" },
  });

  return { ok: true, resultRef: event.id, message: "已创建日历事件" };
}
