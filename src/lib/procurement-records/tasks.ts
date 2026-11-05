/**
 * PROC-1 站内待办（复用 Task：sourceType=records_request，sourceId=申请 id，
 * sourceTemplateKey=<种类>:<来源事件 id>，@@unique([sourceId, sourceTemplateKey]) 保证同一事件同一种类只一条）。
 * 标题与描述不含提交编号、案件编号、申请人地址或附件内容。
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { TASK_TITLES, type TaskKind } from "./case-pure";
import { isUniqueViolation } from "./instruments";

export const TASK_SOURCE_TYPE = "records_request";

export async function ensureRequestTask(input: {
  request: { id: string; orgId: string; projectId: string | null; createdById: string; title: string };
  kind: TaskKind;
  sourceEventId: string;
  actorUserId: string;
  dueDate?: Date | null;
}): Promise<{ created: boolean; taskId: string | null }> {
  const key = `${input.kind}:${input.sourceEventId}`;
  const existing = await db.task.findUnique({ where: { sourceId_sourceTemplateKey: { sourceId: input.request.id, sourceTemplateKey: key } }, select: { id: true } });
  if (existing) return { created: false, taskId: existing.id };
  let projectId: string | null = null;
  if (input.request.projectId) {
    const p = await db.project.findUnique({ where: { id: input.request.projectId }, select: { id: true, orgId: true } });
    if (p && p.orgId === input.request.orgId) projectId = p.id;
  }
  const title = `${TASK_TITLES[input.kind]}——${input.request.title.slice(0, 60)}`;
  try {
    const t = await db.task.create({
      data: {
        title,
        description: `打开青砚「资料申请」详情处理：/projects/intelligence/records/${input.request.id}`,
        status: "todo",
        priority: input.kind === "USER_DECISION" || input.kind === "RESOLVE_UNKNOWN" ? "high" : "medium",
        dueDate: input.dueDate ?? null,
        needReminder: Boolean(input.dueDate),
        projectId,
        assigneeId: input.request.createdById,
        creatorId: input.actorUserId,
        sourceType: TASK_SOURCE_TYPE,
        sourceId: input.request.id,
        sourceTemplateKey: key,
      },
      select: { id: true },
    });
    await createNotification({
      userId: input.request.createdById,
      orgId: input.request.orgId,
      projectId: projectId ?? undefined,
      type: "task_assigned",
      category: "procurement_records",
      priority: input.kind === "USER_DECISION" || input.kind === "RESOLVE_UNKNOWN" ? "high" : "medium",
      title: TASK_TITLES[input.kind],
      summary: `「${input.request.title.slice(0, 40)}」有一条待办`,
      entityType: "records_request",
      entityId: input.request.id,
      sourceKey: `records-task:${input.request.id}:${key}`,
    });
    return { created: true, taskId: t.id };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const again = await db.task.findUnique({ where: { sourceId_sourceTemplateKey: { sourceId: input.request.id, sourceTemplateKey: key } }, select: { id: true } });
    return { created: false, taskId: again?.id ?? null };
  }
}

export async function listRequestTasks(requestId: string) {
  return db.task.findMany({
    where: { sourceType: TASK_SOURCE_TYPE, sourceId: requestId },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, createdAt: true, sourceTemplateKey: true },
    orderBy: { createdAt: "desc" },
  });
}
