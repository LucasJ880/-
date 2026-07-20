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
  | "calendar.create_event"
  // ── Grader 内部备注（已接入真实执行器，写入对应业务对象）──
  | "grader.internal_note"
  // ── Grader 项目任务（已接入真实执行器，创建 Task）──
  | "grader.project_task"
  // ── Grader 邮件草稿（已接入真实执行器，创建 Gmail 草稿，绝不发送）──
  | "grader.email_draft"
  // ── Growth Center 活动启用（审批后从 awaiting_approval → active）──
  | "marketing.activate_campaign"
  // ── 市场研究报告生成的 30 天计划（Leader 审批后创建 Project Task）──
  | "marketing.approve_research_plan"
  // ── 营销 Phase2：写入已确认 Product Marketing Context（绝不自动）──
  | "marketing.propose_context_update"
  // ── 营销 Phase2：创建活动草稿（status=draft，不投放）──
  | "marketing.create_campaign_draft";

/** 暂未接入真实执行器的占位动作类型（executor 会安全降级返回 unsupported） */
export const UNSUPPORTED_PENDING_ACTION_TYPES: readonly PendingActionType[] = [];

export function isUnsupportedPendingActionType(type: string): boolean {
  return (UNSUPPORTED_PENDING_ACTION_TYPES as readonly string[]).includes(type);
}

/**
 * Grader 适配器写入 PendingAction.payload.metadata 的统一结构。
 * 因 PendingAction 表暂无 orgId 列，orgId 通过此 metadata 携带，
 * 供 executor 做跨组织防护与审计。
 */
export interface PendingActionMetadata {
  orgId: string;
  channel?: string;
  targetType?: string;
  targetId?: string;
  /** 源 GraderAction.actionType，便于回溯 */
  graderActionType?: string;
  /** AgentSkill 来源链（可选） */
  source?: string;
  skillId?: string;
  skillSlug?: string;
  skillExecutionId?: string;
  agentRunId?: string;
  proposalIndex?: number;
  idempotencyKey?: string;
}

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

// ── 内部备注（grader.internal_note） ──────────────────────────

export type InternalNoteTargetType =
  | "QUOTE"
  | "OPPORTUNITY"
  | "CUSTOMER"
  | "PROJECT";

/** executor 已接入真实写入的 targetType（白名单；其余安全返回 unsupported） */
export const SUPPORTED_INTERNAL_NOTE_TARGETS: readonly InternalNoteTargetType[] = [
  "QUOTE",
  "OPPORTUNITY",
  "CUSTOMER",
  "PROJECT",
];

export const INTERNAL_NOTE_MAX_LEN = 2000;

export interface InternalNotePayload {
  targetType: InternalNoteTargetType;
  targetId: string;
  /** 备注正文（执行器会截断到 INTERNAL_NOTE_MAX_LEN） */
  note: string;
  reason?: string;
  source?: "GRADER";
  graderType?: "DAILY_BRIEF" | "CUSTOMER_FOLLOWUP" | "QUOTE_RISK" | "PROJECT_HEALTH";
  metadata: {
    orgId: string;
    issueCategory?: string;
    issueSeverity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    quoteId?: string;
    opportunityId?: string;
    customerId?: string;
    projectId?: string;
  };
}

// ── 项目任务（grader.project_task） ───────────────────────────

export const PROJECT_TASK_TITLE_MAX_LEN = 160;
export const PROJECT_TASK_DESC_MAX_LEN = 2000;

export type ProjectTaskPriority = "low" | "medium" | "high" | "urgent";

export interface ProjectTaskPayload {
  projectId: string;
  title: string;
  description?: string;
  reason?: string;
  priority?: ProjectTaskPriority;
  /** ISO 8601；缺省则不设截止 */
  dueAt?: string;
  /** 指派对象；缺省时 executor 回退到项目 owner / 当前用户 */
  assigneeId?: string;
  source?: "GRADER";
  graderType?: "PROJECT_HEALTH" | "DAILY_BRIEF" | "CUSTOMER_FOLLOWUP" | "QUOTE_RISK";
  metadata: {
    orgId: string;
    issueCategory?: string;
    issueSeverity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    projectId?: string;
  };
}

// ── 邮件草稿（grader.email_draft） ────────────────────────────

export const EMAIL_DRAFT_SUBJECT_MAX_LEN = 200;
export const EMAIL_DRAFT_BODY_MAX_LEN = 10000;

export type EmailDraftTargetType = "CUSTOMER" | "OPPORTUNITY" | "QUOTE" | "PROJECT";

export interface EmailDraftPayload {
  to?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyToMessageId?: string;
  threadId?: string;
  targetType?: EmailDraftTargetType;
  targetId?: string;
  source?: "GRADER" | "AGENT";
  graderType?: "DAILY_BRIEF" | "CUSTOMER_FOLLOWUP" | "QUOTE_RISK" | "PROJECT_HEALTH";
  metadata: {
    orgId: string;
    issueCategory?: string;
    issueSeverity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    customerId?: string;
    opportunityId?: string;
    quoteId?: string;
    projectId?: string;
  };
}

export interface MarketingActivateCampaignPayload {
  campaignId: string;
  metadata: PendingActionMetadata & { orgId: string };
}

export interface MarketingApproveResearchPlanPayload {
  planId: string;
  researchRunId: string;
  projectId: string;
  requestedById: string;
  metadata: PendingActionMetadata & { orgId: string };
}

export interface MarketingProposeContextUpdatePayload {
  /** 完整或补丁后的 Product Marketing Context */
  context: Record<string, unknown>;
  reason?: string;
  metadata: PendingActionMetadata & { orgId: string };
}

export interface MarketingCreateCampaignDraftPayload {
  name: string;
  objective: string;
  product?: string;
  geography?: string;
  offer?: string;
  primaryConversion: string;
  budget?: number;
  currency?: string;
  metadata: PendingActionMetadata & { orgId: string };
}

export type PendingActionPayload =
  | ({ type: "sales.update_followup" } & SalesUpdateFollowupPayload)
  | ({ type: "sales.update_stage" } & SalesUpdateStagePayload)
  | ({ type: "calendar.create_event" } & CalendarCreateEventPayload)
  | ({ type: "grader.internal_note" } & InternalNotePayload)
  | ({ type: "grader.project_task" } & ProjectTaskPayload)
  | ({ type: "grader.email_draft" } & EmailDraftPayload)
  | ({ type: "marketing.activate_campaign" } & MarketingActivateCampaignPayload)
  | ({ type: "marketing.approve_research_plan" } & MarketingApproveResearchPlanPayload)
  | ({ type: "marketing.propose_context_update" } & MarketingProposeContextUpdatePayload)
  | ({ type: "marketing.create_campaign_draft" } & MarketingCreateCampaignDraftPayload);

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
