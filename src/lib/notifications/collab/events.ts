/**
 * 协作通知 COLLAB-2：任务、工艺单与项目文件事件的文案（design D2、D7–D9，spec notifications/activity-events）
 *
 * 纯函数：写通知时一次算好标题、摘要、事件区分键与 metadata（objectLabel、dueAt），交给 deliver.ts。
 * - 用户输入的文字（任务标题、项目名、评论正文、文件名）命中敏感内容时整段替换；
 *   人名、状态名、阶段名、工艺单编号、日期不替换。
 * - 截止日期按任务所属组织的时区取日期（由调用方传入，缺省 America/Toronto）。
 * - 操作人、离职者与非组织成员由 deliver.ts 统一过滤，这里只给出候选收件人。
 */

import { getLocalTimeParts } from "@/lib/automation/local-time";
import { taskStatusLabel } from "@/lib/tasks/status";
import type { CollabEvent } from "./deliver";
import { mentionSummary } from "./mentions";
import { redactText } from "./redact";

/** 写入后的任务（编辑、创建、批量改状态之后读到的值） */
export interface TaskEventTask {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  creatorId: string | null;
  projectId: string | null;
  dueDate: Date | null;
  updatedAt: Date;
}

export interface TaskEventContext {
  actorId: string;
  actorName: string;
  /** 任务所属组织（经项目）；没有项目或项目不属于组织时为 null */
  orgId: string | null;
  projectName: string | null;
}

/** 按时区取 YYYY-MM-DD */
export function formatLocalDate(date: Date, timeZone: string): string {
  return getLocalTimeParts(date, timeZone).date;
}

/** 指派通知的摘要：`项目「…」` 与 `截止 YYYY-MM-DD`，存在的段用 ` · ` 连接；两段都没有为 null */
export function taskSummary(input: {
  projectName: string | null;
  dueDate: Date | null;
  timeZone: string;
}): string | null {
  const parts: string[] = [];
  if (input.projectName) parts.push(`项目「${redactText(input.projectName)}」`);
  if (input.dueDate) parts.push(`截止 ${formatLocalDate(input.dueDate, input.timeZone)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function taskLabel(title: string): string {
  return `任务「${redactText(title)}」`;
}

/** 邮件里的对象名与截止时间（design D9、D16） */
function taskMetadata(task: Pick<TaskEventTask, "title" | "dueDate">): Record<string, unknown> {
  return {
    objectLabel: taskLabel(task.title),
    ...(task.dueDate ? { dueAt: task.dueDate.toISOString() } : {}),
  };
}

function taskEventBase(task: Pick<TaskEventTask, "id" | "projectId">, ctx: TaskEventContext) {
  return {
    entityType: "task",
    entityId: task.id,
    orgId: ctx.orgId,
    projectId: task.projectId,
    actorId: ctx.actorId,
  };
}

// ── 指派 ──────────────────────────────────────────────────────

/**
 * 负责人是否有变化：编辑时前后不同（含变为空）；创建时负责人不为空且不是创建人。
 * 调用方据此决定要不要再去查组织与时区。
 */
export function assignmentChanged(input: {
  kind: "create" | "update";
  beforeAssigneeId: string | null;
  afterAssigneeId: string | null;
  creatorId: string | null;
}): boolean {
  if (input.kind === "create") {
    return !!input.afterAssigneeId && input.afterAssigneeId !== input.creatorId;
  }
  return (input.beforeAssigneeId ?? null) !== (input.afterAssigneeId ?? null);
}

export function taskAssignedEvents(input: {
  kind: "create" | "update";
  /** 编辑前的负责人；创建时为 null */
  beforeAssigneeId: string | null;
  task: TaskEventTask;
  /** 新负责人的姓名（用于"已改派给 {新负责人}"） */
  newAssigneeName: string | null;
  ctx: TaskEventContext;
  timeZone: string;
}): CollabEvent[] {
  const { kind, task, ctx } = input;
  const before = kind === "create" ? null : input.beforeAssigneeId;
  if (
    !assignmentChanged({
      kind,
      beforeAssigneeId: before,
      afterAssigneeId: task.assigneeId,
      creatorId: task.creatorId,
    })
  ) {
    return [];
  }

  const summary = taskSummary({ projectName: ctx.projectName, dueDate: task.dueDate, timeZone: input.timeZone });
  const common = {
    type: "task_assigned",
    summary,
    ...taskEventBase(task, ctx),
    eventKey: kind === "create" ? "created" : String(task.updatedAt.getTime()),
    metadata: taskMetadata(task),
  };

  const events: CollabEvent[] = [];
  if (task.assigneeId) {
    events.push({
      ...common,
      priority: "high",
      title: `${ctx.actorName} 把${taskLabel(task.title)}指派给你`,
      recipientIds: [task.assigneeId],
    });
  }
  if (before) {
    const newName = input.newAssigneeName?.trim() || "新负责人";
    events.push({
      ...common,
      priority: "medium",
      title: task.assigneeId
        ? `${taskLabel(task.title)}已改派给 ${newName}`
        : `${taskLabel(task.title)}已取消指派`,
      recipientIds: [before],
    });
  }
  return events;
}

// ── 状态 ──────────────────────────────────────────────────────

/** 状态变化时通知创建人；状态没变返回 null。状态名与任务页一致，无法识别的原样显示。 */
export function taskStatusEvent(input: {
  beforeStatus: string;
  task: TaskEventTask;
  ctx: TaskEventContext;
  /** 批量改状态 */
  batch: boolean;
}): CollabEvent | null {
  const { task, ctx } = input;
  if (input.beforeStatus === task.status) return null;
  return {
    type: "task_status",
    priority: "medium",
    title: `${taskLabel(task.title)}：${taskStatusLabel(input.beforeStatus)} → ${taskStatusLabel(task.status)}`,
    summary: input.batch ? `${ctx.actorName} 批量修改了状态` : `${ctx.actorName} 修改了状态`,
    ...taskEventBase(task, ctx),
    eventKey: `${task.status}.${task.updatedAt.getTime()}`,
    recipientIds: [task.creatorId],
    metadata: taskMetadata(task),
  };
}

// ── 评论 ──────────────────────────────────────────────────────

/** 通知负责人与创建人；这条评论已经 @ 的人收提及通知，不再收评论通知 */
export function taskCommentEvent(input: {
  commentId: string;
  content: string;
  task: Pick<TaskEventTask, "id" | "title" | "assigneeId" | "creatorId" | "projectId" | "dueDate">;
  mentionIds: readonly string[];
  ctx: TaskEventContext;
}): CollabEvent {
  const { task, ctx } = input;
  const mentioned = new Set(input.mentionIds);
  return {
    type: "task_comment",
    priority: "medium",
    title: `${ctx.actorName} 评论了${taskLabel(task.title)}`,
    summary: mentionSummary(input.content),
    ...taskEventBase(task, ctx),
    eventKey: input.commentId,
    recipientIds: [task.assigneeId, task.creatorId].filter(
      (id): id is string => !!id && !mentioned.has(id),
    ),
    metadata: taskMetadata(task),
  };
}

// ── 工艺单阶段 ────────────────────────────────────────────────

/** 发 order_stage 的四个阶段与通知里的阶段名（spec「工艺单阶段通知」） */
export const ORDER_STAGE_LABELS: Readonly<Record<string, string>> = {
  confirmed: "已确认",
  in_production: "开始生产",
  ready: "备货完成",
  scheduled: "已排期",
};

export function isOrderStage(status: string): boolean {
  return Object.prototype.hasOwnProperty.call(ORDER_STAGE_LABELS, status);
}

/** 写入后的工艺单 */
export interface OrderEventOrder {
  id: string;
  code: string;
  status: string;
  projectId: string | null;
  updatedAt: Date;
  /** 安装预约时间（安排安装时写入） */
  expectedInstallDate: Date | null;
  /** 工艺单上的安装日期文本（YYYY-MM-DD） */
  installDate: string | null;
}

/** 安装日期：有预约时间时按组织时区取日期，否则用工艺单上的日期文本 */
function orderInstallDate(order: OrderEventOrder, timeZone: string): string | null {
  if (order.expectedInstallDate) return formatLocalDate(order.expectedInstallDate, timeZone);
  const text = order.installDate?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** 状态变为四个阶段之一且与原状态不同时返回事件；其他情况返回 null */
export function orderStageEvent(input: {
  beforeStatus: string;
  order: OrderEventOrder;
  /** 创建人、商机负责人与下一阶段负责角色（recipients.ts 算好） */
  recipientIds: ReadonlyArray<string | null | undefined>;
  ctx: { actorId: string; actorName: string; orgId: string | null };
  timeZone: string;
}): CollabEvent | null {
  const { order, ctx } = input;
  if (input.beforeStatus === order.status || !isOrderStage(order.status)) return null;
  const stage = ORDER_STAGE_LABELS[order.status];
  const installDate = order.status === "scheduled" ? orderInstallDate(order, input.timeZone) : null;
  return {
    type: "order_stage",
    priority: "medium",
    title: `工艺单 ${order.code}：${stage}`,
    summary: `${ctx.actorName} 推进到「${stage}」${installDate ? ` · 安装日期 ${installDate}` : ""}`,
    entityType: "blinds_order",
    entityId: order.id,
    eventKey: `${order.status}.${order.updatedAt.getTime()}`,
    orgId: ctx.orgId,
    projectId: order.projectId,
    actorId: ctx.actorId,
    recipientIds: input.recipientIds,
    metadata: { objectLabel: `工艺单 ${order.code}` },
  };
}

// ── 项目文件上传 ──────────────────────────────────────────────

const UPLOAD_SUMMARY_FILES = 3;

/** 一次上传请求一条 project_update；没有上传成功的文件时返回 null */
export function projectFilesEvent(input: {
  projectId: string;
  projectName: string;
  orgId: string | null;
  actorId: string;
  actorName: string;
  /** 本次上传成功的文档，按上传顺序 */
  documents: ReadonlyArray<{ id: string; title: string }>;
  /** active 项目成员与项目负责人（recipients.ts 算好） */
  recipientIds: ReadonlyArray<string | null | undefined>;
}): CollabEvent | null {
  const { documents } = input;
  if (documents.length === 0) return null;
  const names = documents
    .slice(0, UPLOAD_SUMMARY_FILES)
    .map((d) => redactText(d.title))
    .join("、");
  const project = `项目「${redactText(input.projectName)}」`;
  return {
    type: "project_update",
    priority: "medium",
    title: `${input.actorName} 在${project}上传了 ${documents.length} 个文件`,
    summary: documents.length > UPLOAD_SUMMARY_FILES ? `${names} 等` : names,
    entityType: "project_files",
    entityId: input.projectId,
    eventKey: `upload.${documents[0].id}`,
    orgId: input.orgId,
    projectId: input.projectId,
    actorId: input.actorId,
    recipientIds: input.recipientIds,
    metadata: { objectLabel: `${project}文件` },
  };
}
