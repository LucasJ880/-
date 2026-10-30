/**
 * Muse Bridge — Pilot 证据导出（TASKFLOW S3，CEO 10 步验收）
 *
 * 按 workflowId 收集整条链：请求账本（AuditLog.traceId）、询问 Task 与回复、跟进 SalesAction、
 * 相关事件（Notification）与提醒扫描运行记录。只读；不输出金额字段与任何 Token。
 */

import { db } from "@/lib/db";
import { FOLLOWUP_SOURCE } from "./followup-pure";
import { INQUIRY_SOURCE_TYPE } from "./inquiry-pure";

const parse = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export async function collectWorkflowEvidence(workflowId: string) {
  const [ledgerRows, inquiryTasks, followups] = await Promise.all([
    db.auditLog.findMany({
      where: { traceId: workflowId, action: { startsWith: "muse:" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { targetId: true, action: true, userId: true, createdAt: true, beforeData: true, afterData: true },
    }),
    db.task.findMany({
      where: { sourceType: INQUIRY_SOURCE_TYPE, sourceBatchKey: workflowId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        sourceId: true,
        status: true,
        dueDate: true,
        createdAt: true,
        creatorId: true,
        assigneeId: true,
        comments: { orderBy: { createdAt: "asc" }, select: { authorId: true, createdAt: true, content: true } },
        activities: { orderBy: { createdAt: "asc" }, select: { action: true, actorId: true, createdAt: true, detail: true } },
      },
    }),
    db.salesAction.findMany({
      where: { source: FOLLOWUP_SOURCE, inputContext: { path: ["workflowId"], equals: workflowId } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        opportunityId: true,
        title: true,
        status: true,
        dueAt: true,
        createdAt: true,
        createdById: true,
        assignedToId: true,
        startedAt: true,
        completedAt: true,
        completedById: true,
        resolutionNote: true,
        dismissedAt: true,
        dismissedReason: true,
        inputContext: true,
      },
    }),
  ]);

  const objectIds = [...inquiryTasks.map((t) => t.id), ...followups.map((f) => f.id)];
  const startedAt = [ledgerRows[0]?.createdAt, inquiryTasks[0]?.createdAt, followups[0]?.createdAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const [events, reminderRuns] = await Promise.all([
    objectIds.length
      ? db.notification.findMany({
          where: { category: "muse_bridge", OR: objectIds.map((id) => ({ sourceKey: { contains: id } })) },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, sourceKey: true, userId: true, title: true, createdAt: true, readAt: true },
        })
      : Promise.resolve([]),
    startedAt
      ? db.automationRun.findMany({
          where: { automationKey: "muse-reminder-scan", startedAt: { gte: startedAt } },
          orderBy: { startedAt: "asc" },
          take: 200,
          select: { id: true, status: true, startedAt: true, completedAt: true, processedCount: true, succeededCount: true, failedCount: true, error: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    workflowId,
    ledger: ledgerRows.map((r) => {
      const before = parse(r.beforeData);
      const after = parse(r.afterData);
      return {
        requestId: r.targetId,
        intent: r.action.replace(/^muse:/, ""),
        userId: r.userId,
        at: r.createdAt.toISOString(),
        utterance: typeof before?.utterance === "string" ? before.utterance : null,
        ok: after?.ok === true,
        errorCode: typeof after?.errorCode === "string" ? after.errorCode : null,
      };
    }),
    inquiries: inquiryTasks.map((t) => ({
      inquiryId: t.id,
      opportunityId: t.sourceId,
      status: t.status,
      dueAt: t.dueDate?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      creatorId: t.creatorId,
      assigneeId: t.assigneeId,
      replies: t.comments.map((c) => ({ authorId: c.authorId, at: c.createdAt.toISOString(), text: c.content })),
      activities: t.activities.map((a) => ({
        action: a.action,
        actorId: a.actorId,
        at: a.createdAt.toISOString(),
        channel: (parse(a.detail)?.channel as string | undefined) ?? null,
      })),
    })),
    followups: followups.map((f) => ({
      followupId: f.id,
      opportunityId: f.opportunityId,
      title: f.title,
      status: f.status,
      dueAt: f.dueAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
      createdById: f.createdById,
      assigneeId: f.assignedToId,
      startedAt: f.startedAt?.toISOString() ?? null,
      completedAt: f.completedAt?.toISOString() ?? null,
      completedById: f.completedById,
      evidence: f.resolutionNote,
      dismissedAt: f.dismissedAt?.toISOString() ?? null,
      reason: f.dismissedReason,
      inquiryTaskId: (f.inputContext as { inquiryTaskId?: string | null } | null)?.inquiryTaskId ?? null,
    })),
    events: events.map((e) => ({
      notificationId: e.id,
      sourceKey: e.sourceKey,
      recipientId: e.userId,
      title: e.title,
      at: e.createdAt.toISOString(),
      readAt: e.readAt?.toISOString() ?? null,
    })),
    reminderRuns: reminderRuns.map((r) => ({
      runId: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      planned: r.processedCount,
      emitted: r.succeededCount,
      failed: r.failedCount,
      error: r.error,
    })),
  };
}
