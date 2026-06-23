/**
 * GraderAction → PendingAction 适配器（微信 AI 分身优化阶段 · 第一阶段）
 *
 * 职责：把 Grader 产出的 `GraderAction` 转成现有 `PendingAction` 草稿，
 * 复用现有审批链路（createDraft → PendingAction(pending) → executePendingAction）。
 *
 * 安全红线（不可绕过）：
 * - 绝不直接执行真实写动作；一切副作用都先落 PendingAction，由用户确认后经 executor 执行。
 * - 不自动发邮件 / 不自动改报价 / 不自动提交报价 / 不自动删除数据 / 不对外承诺价格工期。
 * - 不新增第二套 pending action 表，必须复用 src/lib/pending-actions/*。
 * - PendingAction 表暂无 orgId 列：本适配器把 orgId 写进 payload.metadata，
 *   executor 执行前据此做跨组织防护。
 */

import { createDraft } from "@/lib/pending-actions/drafts";
import type {
  PendingActionType,
  PendingActionMetadata,
  InternalNotePayload,
  InternalNoteTargetType,
  ProjectTaskPayload,
  ProjectTaskPriority,
  EmailDraftPayload,
  EmailDraftTargetType,
} from "@/lib/pending-actions/types";
import {
  isUnsupportedPendingActionType,
  SUPPORTED_INTERNAL_NOTE_TARGETS,
  INTERNAL_NOTE_MAX_LEN,
  PROJECT_TASK_TITLE_MAX_LEN,
  PROJECT_TASK_DESC_MAX_LEN,
  EMAIL_DRAFT_SUBJECT_MAX_LEN,
  EMAIL_DRAFT_BODY_MAX_LEN,
} from "@/lib/pending-actions/types";
import type { GraderAction } from "../types";

const INTERNAL_NOTE_TARGETS: readonly InternalNoteTargetType[] = [
  "QUOTE",
  "OPPORTUNITY",
  "CUSTOMER",
  "PROJECT",
];
const GRADER_TYPES = ["DAILY_BRIEF", "CUSTOMER_FOLLOWUP", "QUOTE_RISK", "PROJECT_HEALTH"] as const;
const ISSUE_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** 适配执行上下文 —— 由微信链路 / Grader 调用方提供 */
export interface GraderActionContext {
  orgId: string;
  userId: string;
  /** personal_wechat / wecom / web 等 */
  channel?: string;
  /** 关联业务实体类型（来自 GraderEvidence.sourceType 等） */
  targetType?: string;
  /** 关联业务实体 ID */
  targetId?: string;
  /** 触发的 AI 会话（可选，便于回查） */
  threadId?: string;
  messageId?: string;
}

/** 单条适配结果 */
export interface AdaptedPendingAction {
  ok: boolean;
  /** 创建成功的 PendingAction.id（失败为 undefined） */
  actionId?: string;
  /** 映射到的 PendingAction 类型 */
  pendingType?: PendingActionType;
  /** 用户可读标题（供微信编号展示） */
  title: string;
  /** 用户可读预览 */
  preview: string;
  /** 是否有真实执行器（false=占位降级，确认后 executor 返回 unsupported） */
  executable: boolean;
  /** 占位 / 不支持原因（executable=false 时给出） */
  note?: string;
  /** 适配失败原因（ok=false 时给出，且不会创建草稿） */
  error?: string;
}

/** Grader actionType → 是否允许 + 目标 PendingAction 类型 */
const ALLOWED_ACTION_TYPES: ReadonlySet<GraderAction["actionType"]> = new Set([
  "CREATE_EMAIL_DRAFT",
  "CREATE_CALENDAR_REMINDER",
  "CREATE_PROJECT_TASK",
  "ADD_INTERNAL_NOTE",
  "SUGGEST_STATUS_UPDATE",
]);

function buildMetadata(
  action: GraderAction,
  ctx: GraderActionContext,
): PendingActionMetadata {
  return {
    orgId: ctx.orgId,
    channel: ctx.channel,
    targetType: ctx.targetType,
    targetId: ctx.targetId,
    graderActionType: action.actionType,
  };
}

function str(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = payload?.[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * 把单个 GraderAction 适配为 PendingAction 草稿。
 * 注意：本函数会真正落库（pending），但绝不执行副作用。
 */
export async function graderActionToPendingAction(
  action: GraderAction,
  ctx: GraderActionContext,
): Promise<AdaptedPendingAction> {
  if (!ctx.orgId || !ctx.userId) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "缺少 orgId / userId，拒绝适配" };
  }
  if (!ALLOWED_ACTION_TYPES.has(action.actionType)) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: `不支持的 actionType: ${action.actionType}` };
  }

  const metadata = buildMetadata(action, ctx);
  const payload = action.payload ?? {};

  switch (action.actionType) {
    case "CREATE_CALENDAR_REMINDER":
      return adaptCalendarReminder(action, ctx, payload, metadata);
    case "SUGGEST_STATUS_UPDATE":
      return adaptStatusUpdate(action, ctx, payload, metadata);
    case "CREATE_EMAIL_DRAFT":
      return adaptEmailDraft(action, ctx, payload);
    case "CREATE_PROJECT_TASK":
      return adaptProjectTask(action, ctx, payload);
    case "ADD_INTERNAL_NOTE":
      return adaptInternalNote(action, ctx, payload);
    default:
      return { ok: false, title: action.label, preview: action.description, executable: false, error: "未知动作类型" };
  }
}

/** 批量适配（最多 limit 个，默认 3，对齐微信端展示上限） */
export async function graderActionsToPendingActions(
  actions: GraderAction[],
  ctx: GraderActionContext,
  options?: { limit?: number },
): Promise<AdaptedPendingAction[]> {
  const limit = options?.limit ?? 3;
  const slice = actions.slice(0, limit);
  const results: AdaptedPendingAction[] = [];
  // 顺序创建，保证 createdAt 顺序与 suggestedActions 顺序一致（微信编号据此对齐）。
  for (const a of slice) {
    results.push(await graderActionToPendingAction(a, ctx));
  }
  return results;
}

// ── 各类型适配 ─────────────────────────────────────────────────

async function adaptCalendarReminder(
  action: GraderAction,
  ctx: GraderActionContext,
  payload: Record<string, unknown>,
  metadata: PendingActionMetadata,
): Promise<AdaptedPendingAction> {
  const title = str(payload, "title") ?? action.label;
  const startTime = str(payload, "startTime");
  if (!startTime) {
    return { ok: false, title, preview: action.description, executable: false, error: "缺少 startTime，无法创建提醒" };
  }
  // 默认时长 30 分钟（提醒类事件无明确结束时间时）
  const endTime = str(payload, "endTime") ?? new Date(new Date(startTime).getTime() + 30 * 60 * 1000).toISOString();

  const draftPayload = {
    title,
    description: str(payload, "description") ?? action.description,
    startTime,
    endTime,
    allDay: payload.allDay === true,
    location: str(payload, "location"),
    reminderMinutes: typeof payload.reminderMinutes === "number" ? payload.reminderMinutes : 15,
    metadata,
  };

  const res = await createDraft({
    type: "calendar.create_event",
    title,
    preview: action.description,
    payload: draftPayload,
    userId: ctx.userId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
  });
  return fromDraftResult(res, "calendar.create_event", title, action.description, true);
}

async function adaptStatusUpdate(
  action: GraderAction,
  ctx: GraderActionContext,
  payload: Record<string, unknown>,
  metadata: PendingActionMetadata,
): Promise<AdaptedPendingAction> {
  const opportunityId = str(payload, "opportunityId");
  if (!opportunityId) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "缺少 opportunityId，无法生成销售状态草稿" };
  }
  const opportunityTitle = str(payload, "opportunityTitle") ?? action.label;
  const customerName = str(payload, "customerName") ?? "";

  // 有 newStage → 阶段推进；有 nextFollowupAt → 跟进时间；否则无法判定。
  const newStage = str(payload, "newStage");
  const nextFollowupAt = str(payload, "nextFollowupAt");

  if (newStage) {
    const draftPayload = {
      opportunityId,
      opportunityTitle,
      customerName,
      previousStage: str(payload, "previousStage") ?? "",
      newStage,
      note: str(payload, "note"),
      metadata,
    };
    const res = await createDraft({
      type: "sales.update_stage",
      title: action.label,
      preview: action.description,
      payload: draftPayload,
      userId: ctx.userId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
    });
    return fromDraftResult(res, "sales.update_stage", action.label, action.description, true);
  }

  if (nextFollowupAt) {
    const draftPayload = {
      opportunityId,
      opportunityTitle,
      customerName,
      previousFollowupAt: str(payload, "previousFollowupAt") ?? null,
      nextFollowupAt,
      note: str(payload, "note"),
      metadata,
    };
    const res = await createDraft({
      type: "sales.update_followup",
      title: action.label,
      preview: action.description,
      payload: draftPayload,
      userId: ctx.userId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
    });
    return fromDraftResult(res, "sales.update_followup", action.label, action.description, true);
  }

  return { ok: false, title: action.label, preview: action.description, executable: false, error: "SUGGEST_STATUS_UPDATE 需提供 newStage 或 nextFollowupAt" };
}

async function adaptInternalNote(
  action: GraderAction,
  ctx: GraderActionContext,
  payload: Record<string, unknown>,
): Promise<AdaptedPendingAction> {
  const rawTarget = (str(payload, "targetType") ?? "").toUpperCase();
  const targetType = (INTERNAL_NOTE_TARGETS as readonly string[]).includes(rawTarget)
    ? (rawTarget as InternalNoteTargetType)
    : undefined;
  const targetId =
    str(payload, "targetId") ??
    str(payload, "quoteId") ??
    str(payload, "opportunityId") ??
    str(payload, "customerId");
  const note = str(payload, "note") ?? action.description;

  if (!targetType) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "internal note 缺少有效 targetType" };
  }
  if (!targetId) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "internal note 缺少 targetId" };
  }
  if (!note) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "internal note 缺少 note" };
  }

  const severityRaw = str(payload, "issueSeverity");
  const issueSeverity = (ISSUE_SEVERITIES as readonly string[]).includes(severityRaw ?? "")
    ? (severityRaw as InternalNotePayload["metadata"]["issueSeverity"])
    : undefined;
  const graderTypeRaw = str(payload, "graderType");
  const graderType = (GRADER_TYPES as readonly string[]).includes(graderTypeRaw ?? "")
    ? (graderTypeRaw as InternalNotePayload["graderType"])
    : undefined;

  const notePayload: InternalNotePayload = {
    targetType,
    targetId,
    note: note.slice(0, INTERNAL_NOTE_MAX_LEN),
    reason: str(payload, "reason"),
    source: "GRADER",
    graderType,
    metadata: {
      orgId: ctx.orgId,
      issueCategory: str(payload, "issueCategory"),
      issueSeverity,
      quoteId: str(payload, "quoteId"),
      opportunityId: str(payload, "opportunityId"),
      customerId: str(payload, "customerId"),
      projectId: str(payload, "projectId"),
    },
  };

  const res = await createDraft({
    type: "grader.internal_note",
    title: action.label,
    preview: action.description,
    payload: notePayload as unknown as Record<string, unknown>,
    userId: ctx.userId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
  });

  const supported = (SUPPORTED_INTERNAL_NOTE_TARGETS as readonly string[]).includes(targetType);
  const adapted = fromDraftResult(res, "grader.internal_note", action.label, action.description, supported);
  if (!adapted.ok) return adapted;
  if (!supported) {
    adapted.note = `${targetType} 内部备注暂未接入真实写入，仅作建议。`;
  }
  return adapted;
}

const PROJECT_TASK_PRIORITIES: readonly ProjectTaskPriority[] = ["low", "medium", "high", "urgent"];

async function adaptProjectTask(
  action: GraderAction,
  ctx: GraderActionContext,
  payload: Record<string, unknown>,
): Promise<AdaptedPendingAction> {
  const projectId = str(payload, "projectId");
  const title = (str(payload, "title") ?? action.label)?.slice(0, PROJECT_TASK_TITLE_MAX_LEN);

  if (!projectId) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "项目任务缺少 projectId" };
  }
  if (!title) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "项目任务缺少 title" };
  }

  const severityRaw = str(payload, "issueSeverity");
  const issueSeverity = (ISSUE_SEVERITIES as readonly string[]).includes(severityRaw ?? "")
    ? (severityRaw as ProjectTaskPayload["metadata"]["issueSeverity"])
    : undefined;

  // 优先用显式 priority；否则按风险等级推导（HIGH→high / CRITICAL→urgent）
  const priorityRaw = str(payload, "priority");
  let priority: ProjectTaskPriority | undefined = (PROJECT_TASK_PRIORITIES as readonly string[]).includes(priorityRaw ?? "")
    ? (priorityRaw as ProjectTaskPriority)
    : undefined;
  if (!priority) {
    if (issueSeverity === "CRITICAL") priority = "urgent";
    else if (issueSeverity === "HIGH") priority = "high";
  }

  const graderTypeRaw = str(payload, "graderType");
  const graderType = (GRADER_TYPES as readonly string[]).includes(graderTypeRaw ?? "")
    ? (graderTypeRaw as ProjectTaskPayload["graderType"])
    : "PROJECT_HEALTH";

  const description = (str(payload, "description") ?? str(payload, "reason") ?? action.description)?.slice(
    0,
    PROJECT_TASK_DESC_MAX_LEN,
  );

  const taskPayload: ProjectTaskPayload = {
    projectId,
    title,
    description,
    reason: str(payload, "reason"),
    priority,
    dueAt: str(payload, "dueAt"),
    source: "GRADER",
    graderType,
    metadata: {
      orgId: ctx.orgId,
      issueCategory: str(payload, "issueCategory") ?? "project_health",
      issueSeverity,
      projectId,
    },
  };

  const res = await createDraft({
    type: "grader.project_task",
    title: action.label,
    preview: action.description,
    payload: taskPayload as unknown as Record<string, unknown>,
    userId: ctx.userId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
  });
  return fromDraftResult(res, "grader.project_task", action.label, action.description, true);
}

const EMAIL_DRAFT_TARGETS: readonly EmailDraftTargetType[] = ["CUSTOMER", "OPPORTUNITY", "QUOTE", "PROJECT"];

async function adaptEmailDraft(
  action: GraderAction,
  ctx: GraderActionContext,
  payload: Record<string, unknown>,
): Promise<AdaptedPendingAction> {
  const subject = str(payload, "subject");
  const body = str(payload, "body");
  if (!subject) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "邮件草稿缺少 subject" };
  }
  if (!body) {
    return { ok: false, title: action.label, preview: action.description, executable: false, error: "邮件草稿缺少 body" };
  }

  const targetRaw = (str(payload, "targetType") ?? "").toUpperCase();
  const targetType = (EMAIL_DRAFT_TARGETS as readonly string[]).includes(targetRaw)
    ? (targetRaw as EmailDraftTargetType)
    : undefined;
  const targetId =
    str(payload, "targetId") ??
    str(payload, "customerId") ??
    str(payload, "opportunityId") ??
    str(payload, "quoteId") ??
    str(payload, "projectId");

  const severityRaw = str(payload, "issueSeverity");
  const issueSeverity = (ISSUE_SEVERITIES as readonly string[]).includes(severityRaw ?? "")
    ? (severityRaw as EmailDraftPayload["metadata"]["issueSeverity"])
    : undefined;
  const graderTypeRaw = str(payload, "graderType");
  const graderType = (GRADER_TYPES as readonly string[]).includes(graderTypeRaw ?? "")
    ? (graderTypeRaw as EmailDraftPayload["graderType"])
    : undefined;

  const draftPayload: EmailDraftPayload = {
    to: str(payload, "to"),
    cc: str(payload, "cc"),
    bcc: str(payload, "bcc"),
    subject: subject.slice(0, EMAIL_DRAFT_SUBJECT_MAX_LEN),
    body: body.slice(0, EMAIL_DRAFT_BODY_MAX_LEN),
    targetType,
    targetId,
    source: "GRADER",
    graderType,
    metadata: {
      orgId: ctx.orgId,
      issueCategory: str(payload, "issueCategory"),
      issueSeverity,
      customerId: str(payload, "customerId"),
      opportunityId: str(payload, "opportunityId"),
      quoteId: str(payload, "quoteId"),
      projectId: str(payload, "projectId"),
    },
  };

  const res = await createDraft({
    type: "grader.email_draft",
    title: action.label,
    preview: action.description,
    payload: draftPayload as unknown as Record<string, unknown>,
    userId: ctx.userId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
  });
  return fromDraftResult(res, "grader.email_draft", action.label, action.description, true);
}

// ── 工具 ───────────────────────────────────────────────────────

function fromDraftResult(
  res: { success: boolean; data?: unknown; error?: string },
  pendingType: PendingActionType,
  title: string,
  preview: string,
  executable: boolean,
): AdaptedPendingAction {
  if (!res.success) {
    return { ok: false, pendingType, title, preview, executable: false, error: res.error ?? "草稿创建失败" };
  }
  const data = res.data as { actionId?: string } | undefined;
  return {
    ok: true,
    actionId: data?.actionId,
    pendingType,
    title,
    preview,
    executable: executable && !isUnsupportedPendingActionType(pendingType),
  };
}
