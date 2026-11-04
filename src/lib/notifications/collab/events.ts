/**
 * 协作通知 COLLAB-2：任务事件的文案与收件人（design D2、D9，spec notifications/activity-events）
 *
 * 纯函数：写通知时一次算好标题、摘要、事件区分键与 metadata（objectLabel、dueAt），交给 deliver.ts。
 * - 用户输入的文字（任务标题、项目名、评论正文）命中敏感内容时整段替换；人名、状态名、日期不替换。
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
