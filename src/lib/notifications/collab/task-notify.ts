/**
 * 协作通知 COLLAB-2：任务事件接线（design D1、D6、D9）
 *
 * 任务各接口在写库成功之后 await 这里的函数：补齐任务所属组织、项目名与组织时区，
 * 用 events.ts 算出事件，再逐个交给统一投递入口 deliver.ts。
 * 每个函数都不向外抛错：任何一步出错只记 console.error，业务请求照常返回原有的成功响应。
 */

import { db } from "@/lib/db";
import { AUTOMATION_TIMEZONE, loadOrgTimezone } from "@/lib/automation/registry";
import { deliverCollabNotification, type CollabEvent } from "./deliver";
import {
  assignmentChanged,
  taskAssignedEvents,
  taskCommentEvent,
  taskStatusEvent,
  type TaskEventContext,
  type TaskEventTask,
} from "./events";
import { taskCommentMentionEvent } from "./mentions";

interface Actor {
  id: string;
  name: string;
}

/** 写入后的任务，带新负责人姓名（创建与编辑接口的返回里都有） */
type TaskWithAssignee = TaskEventTask & { assignee?: { name: string } | null };

async function loadProjectOrg(
  projectId: string | null,
): Promise<{ orgId: string | null; projectName: string | null }> {
  if (!projectId) return { orgId: null, projectName: null };
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { name: true, orgId: true },
  });
  return { orgId: project?.orgId ?? null, projectName: project?.name ?? null };
}

async function orgTimeZone(orgId: string | null): Promise<string> {
  return orgId ? loadOrgTimezone(orgId) : AUTOMATION_TIMEZONE;
}

async function deliverAll(events: CollabEvent[]): Promise<void> {
  for (const event of events) await deliverCollabNotification(event);
}

/** POST /api/tasks：负责人不是创建人时通知负责人 */
export async function notifyTaskCreated(input: { task: TaskWithAssignee; actor: Actor }): Promise<void> {
  const { task, actor } = input;
  try {
    if (
      !assignmentChanged({
        kind: "create",
        beforeAssigneeId: null,
        afterAssigneeId: task.assigneeId,
        creatorId: task.creatorId,
      })
    ) {
      return;
    }
    const { orgId, projectName } = await loadProjectOrg(task.projectId);
    const ctx: TaskEventContext = { actorId: actor.id, actorName: actor.name, orgId, projectName };
    await deliverAll(
      taskAssignedEvents({
        kind: "create",
        beforeAssigneeId: null,
        task,
        newAssigneeName: task.assignee?.name ?? null,
        ctx,
        timeZone: await orgTimeZone(orgId),
      }),
    );
  } catch (err) {
    console.error(`[collab-notify] 任务创建通知失败 task=${task.id}`, err);
  }
}

/** PATCH /api/tasks/[id]：负责人变化 → task_assigned；状态变化 → task_status */
export async function notifyTaskUpdated(input: {
  before: { status: string; assigneeId: string | null };
  task: TaskWithAssignee;
  actor: Actor;
}): Promise<void> {
  const { before, task, actor } = input;
  try {
    const assigned = assignmentChanged({
      kind: "update",
      beforeAssigneeId: before.assigneeId,
      afterAssigneeId: task.assigneeId,
      creatorId: task.creatorId,
    });
    const statusChanged = before.status !== task.status;
    if (!assigned && !statusChanged) return;

    const { orgId, projectName } = await loadProjectOrg(task.projectId);
    const ctx: TaskEventContext = { actorId: actor.id, actorName: actor.name, orgId, projectName };
    const events: CollabEvent[] = [];
    if (assigned) {
      events.push(
        ...taskAssignedEvents({
          kind: "update",
          beforeAssigneeId: before.assigneeId,
          task,
          newAssigneeName: task.assignee?.name ?? null,
          ctx,
          timeZone: await orgTimeZone(orgId),
        }),
      );
    }
    const status = taskStatusEvent({ beforeStatus: before.status, task, ctx, batch: false });
    if (status) events.push(status);
    await deliverAll(events);
  } catch (err) {
    console.error(`[collab-notify] 任务更新通知失败 task=${task.id}`, err);
  }
}

/** POST /api/tasks/batch 改状态之前：记下每个任务原来的状态。出错时返回空表（这一批不发通知） */
export async function loadTaskStatuses(ids: string[]): Promise<Map<string, string>> {
  try {
    const rows = await db.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
    return new Map(rows.map((r) => [r.id, r.status]));
  } catch (err) {
    console.error("[collab-notify] 读取批量改状态前的状态失败", err);
    return new Map();
  }
}

/** POST /api/tasks/batch 改状态之后：逐条比较，状态变了的通知各自的创建人 */
export async function notifyBatchStatusChanged(input: {
  before: Map<string, string>;
  actor: Actor;
}): Promise<void> {
  const { before, actor } = input;
  try {
    if (before.size === 0) return;
    const tasks = await db.task.findMany({
      where: { id: { in: [...before.keys()] } },
      select: {
        id: true,
        title: true,
        status: true,
        assigneeId: true,
        creatorId: true,
        projectId: true,
        dueDate: true,
        updatedAt: true,
        project: { select: { name: true, orgId: true } },
      },
    });
    for (const task of tasks) {
      const beforeStatus = before.get(task.id);
      if (beforeStatus === undefined) continue;
      const event = taskStatusEvent({
        beforeStatus,
        task,
        ctx: {
          actorId: actor.id,
          actorName: actor.name,
          orgId: task.project?.orgId ?? null,
          projectName: task.project?.name ?? null,
        },
        batch: true,
      });
      if (event) await deliverCollabNotification(event);
    }
  } catch (err) {
    console.error("[collab-notify] 批量改状态通知失败", err);
  }
}

/** POST /api/tasks/[id]/comments 创建成功之后：先通知被 @ 的人，再通知负责人与创建人（已被 @ 的除外） */
export async function notifyTaskCommented(input: {
  task: Pick<TaskEventTask, "id" | "title" | "assigneeId" | "creatorId" | "projectId" | "dueDate"> & {
    orgId: string | null;
  };
  comment: { id: string; content: string };
  mentionIds: string[];
  actor: Actor;
}): Promise<void> {
  const { task, comment, mentionIds, actor } = input;
  try {
    if (mentionIds.length > 0) {
      await deliverCollabNotification(
        taskCommentMentionEvent({
          commentId: comment.id,
          taskId: task.id,
          taskTitle: task.title,
          projectId: task.projectId,
          orgId: task.orgId,
          actorId: actor.id,
          actorName: actor.name,
          content: comment.content,
          mentionIds,
          dueAt: task.dueDate,
        }),
      );
    }
    await deliverCollabNotification(
      taskCommentEvent({
        commentId: comment.id,
        content: comment.content,
        task,
        mentionIds,
        ctx: { actorId: actor.id, actorName: actor.name, orgId: task.orgId, projectName: null },
      }),
    );
  } catch (err) {
    console.error(`[collab-notify] 任务评论通知失败 task=${task.id}`, err);
  }
}
