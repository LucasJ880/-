/**
 * PR4 — 待审批动作（PendingAction）类型定义
 *
 * AI 工具生成的"写入草稿"先落在 PendingAction 表里，
 * 用户在聊天里点"批准"后再由 executor 真正执行副作用。
 */

// ── 支持的动作类型 ─────────────────────────────────────────────

export type PendingActionType =
  | "sales.update_followup"
  | "sales.update_stage"
  | "calendar.create_event";

export type PendingActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

// ── 各类动作的 payload schema ──────────────────────────────────

export interface SalesUpdateFollowupPayload {
  opportunityId: string;
  opportunityTitle: string;
  customerName: string;
  previousFollowupAt: string | null;
  nextFollowupAt: string; // ISO 8601
  note?: string;
}

export interface SalesUpdateStagePayload {
  opportunityId: string;
  opportunityTitle: string;
  customerName: string;
  previousStage: string;
  newStage: string;
  note?: string;
}

export interface CalendarCreateEventPayload {
  title: string;
  description?: string;
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  allDay?: boolean;
  location?: string;
  reminderMinutes?: number;
}

export type PendingActionPayload =
  | ({ type: "sales.update_followup" } & SalesUpdateFollowupPayload)
  | ({ type: "sales.update_stage" } & SalesUpdateStagePayload)
  | ({ type: "calendar.create_event" } & CalendarCreateEventPayload);

// ── 工具返回给 AI 的"草稿已创建"结构 ───────────────────────────

export interface PendingApprovalResult {
  status: "pending_approval";
  actionId: string;
  type: PendingActionType;
  title: string;
  preview: string;
  hint: string;
}

export function toPendingApprovalResult(action: {
  id: string;
  type: string;
  title: string;
  preview: string;
}): PendingApprovalResult {
  return {
    status: "pending_approval",
    actionId: action.id,
    type: action.type as PendingActionType,
    title: action.title,
    preview: action.preview,
    hint: "草稿已生成。请在回复中告知用户正在等待他们的确认，不要重复调用工具。",
  };
}
