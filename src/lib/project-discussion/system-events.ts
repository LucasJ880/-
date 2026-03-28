/**
 * 项目讨论 — 系统事件写入
 *
 * 所有系统消息使用严格的 SystemEventMetadata 类型。
 * emitProjectPatchEvents 接受 Prisma 事务客户端以保证原子性。
 * 仅当字段值真正变化时才写入消息（幂等保证）。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  SYSTEM_EVENT_TYPES,
  type SystemEventType,
  type SystemEventMetadata,
} from "./types";
import { getOrCreateMainConversation } from "./service";

interface SystemEventOptions {
  projectId: string;
  eventType: SystemEventType;
  body: string;
  metadata: SystemEventMetadata;
  actorId?: string;
  tx?: Prisma.TransactionClient;
}

/**
 * 写入一条系统消息到项目讨论流。
 * 支持传入事务客户端以保证原子性。
 */
export async function createProjectSystemMessage(opts: SystemEventOptions) {
  const client = opts.tx ?? db;
  const conv = await getOrCreateMainConversation(opts.projectId, opts.tx);
  return client.projectMessage.create({
    data: {
      conversationId: conv.id,
      projectId: opts.projectId,
      senderId: opts.actorId ?? null,
      type: "SYSTEM",
      body: opts.body,
      metadata: opts.metadata as unknown as Prisma.InputJsonValue,
    },
  });
}

// ─── 事件写入 helper ───

export async function onProjectCreated(
  projectId: string,
  projectName: string,
  actorId: string,
  actorName: string,
  tx?: Prisma.TransactionClient
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.PROJECT_CREATED,
    actorId,
    actorName,
    source: "system",
    projectName,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.PROJECT_CREATED,
    body: `${actorName} 创建了项目「${projectName}」，讨论流已开启`,
    metadata,
    actorId,
    tx,
  });
}

export async function onMemberJoined(
  projectId: string,
  memberName: string,
  role: string,
  actorId: string,
  memberId?: string,
  tx?: Prisma.TransactionClient
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.MEMBER_JOINED,
    actorId,
    source: "manual",
    memberId,
    memberName,
    memberRole: role,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.MEMBER_JOINED,
    body: `${memberName} 加入了项目（角色：${role}）`,
    metadata,
    actorId,
    tx,
  });
}

export async function onMemberRemoved(
  projectId: string,
  memberName: string,
  actorId: string,
  memberId?: string,
  tx?: Prisma.TransactionClient
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.MEMBER_REMOVED,
    actorId,
    source: "manual",
    memberId,
    memberName,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.MEMBER_REMOVED,
    body: `${memberName} 被移出了项目`,
    metadata,
    actorId,
    tx,
  });
}

export async function onStageChanged(
  projectId: string,
  oldStage: string,
  newStage: string,
  actorId: string,
  tx?: Prisma.TransactionClient
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.STAGE_CHANGED,
    actorId,
    source: "manual",
    stageBefore: oldStage,
    stageAfter: newStage,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.STAGE_CHANGED,
    body: `项目阶段从「${oldStage}」变更为「${newStage}」`,
    metadata,
    actorId,
    tx,
  });
}

export async function onDateChanged(
  projectId: string,
  field: string,
  fieldLabel: string,
  oldDate: string | null,
  newDate: string | null,
  actorId: string,
  tx?: Prisma.TransactionClient
) {
  const oldStr = oldDate ?? "未设定";
  const newStr = newDate ?? "已清除";
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.DATE_CHANGED,
    actorId,
    source: "manual",
    field,
    before: oldDate,
    after: newDate,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.DATE_CHANGED,
    body: `${fieldLabel}从 ${oldStr} 更新为 ${newStr}`,
    metadata,
    actorId,
    tx,
  });
}

export async function onProjectSubmitted(
  projectId: string,
  actorName: string,
  actorId: string,
  submittedAt: string,
  tx?: Prisma.TransactionClient
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.PROJECT_SUBMITTED,
    actorId,
    actorName,
    source: "manual",
    submittedAt,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.PROJECT_SUBMITTED,
    body: `${actorName} 提交了项目`,
    metadata,
    actorId,
    tx,
  });
}

export async function onStatusChanged(
  projectId: string,
  oldStatus: string,
  newStatus: string,
  actorId: string,
  tx?: Prisma.TransactionClient
) {
  const labels: Record<string, string> = {
    active: "进行中",
    completed: "已完成",
    archived: "已归档",
    overdue: "已逾期",
  };
  const oldLabel = labels[oldStatus] ?? oldStatus;
  const newLabel = labels[newStatus] ?? newStatus;
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.STATUS_CHANGED,
    actorId,
    source: "manual",
    statusBefore: oldStatus,
    statusAfter: newStatus,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.STATUS_CHANGED,
    body: `项目状态从「${oldLabel}」变更为「${newLabel}」`,
    metadata,
    actorId,
    tx,
  });
}

export async function onProjectAbandoned(
  projectId: string,
  actorName: string,
  actorId: string,
  abandonedStage: string,
  reason?: string,
  tx?: Prisma.TransactionClient
) {
  const stageLabels: Record<string, string> = {
    initiation: "立项",
    distribution: "项目分发",
    interpretation: "项目解读",
    supplier_inquiry: "供应商询价",
    supplier_quote: "供应商报价",
    submission: "项目提交",
  };
  const stageLabel = stageLabels[abandonedStage] || abandonedStage;
  const reasonText = reason ? `，原因：${reason}` : "";
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.PROJECT_ABANDONED,
    actorId,
    actorName,
    source: "manual",
    abandonedStage,
    reason,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.PROJECT_ABANDONED,
    body: `${actorName} 放弃了项目（当时阶段：${stageLabel}${reasonText}）`,
    metadata,
    actorId,
    tx,
  });
}

// ─── 任务/日程/阶段推进 事件写入 ───

export async function onTaskCreated(
  projectId: string,
  taskId: string,
  taskTitle: string,
  actorId: string,
  actorName: string,
  taskPriority?: string
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.TASK_CREATED,
    actorId,
    actorName,
    source: "system",
    taskId,
    taskTitle,
    taskPriority,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.TASK_CREATED,
    body: `${actorName} 创建了任务「${taskTitle}」`,
    metadata,
    actorId,
  });
}

export async function onEventCreated(
  projectId: string,
  eventId: string,
  eventTitle: string,
  startTime: string,
  actorId: string,
  actorName: string
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.EVENT_CREATED,
    actorId,
    actorName,
    source: "system",
    eventId,
    eventTitle,
    startTime,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.EVENT_CREATED,
    body: `${actorName} 创建了日程「${eventTitle}」`,
    metadata,
    actorId,
  });
}

export async function onStageAdvanced(
  projectId: string,
  fromStage: string,
  toStage: string,
  actorId: string,
  actorName: string,
  advanceSource: "ai_suggestion" | "manual",
  confidence?: number,
  tx?: Prisma.TransactionClient
) {
  const stageLabels: Record<string, string> = {
    initiation: "立项",
    distribution: "项目分发",
    interpretation: "项目解读",
    supplier_inquiry: "供应商询价",
    supplier_quote: "供应商报价",
    submission: "项目提交",
  };
  const fromLabel = stageLabels[fromStage] || fromStage;
  const toLabel = stageLabels[toStage] || toStage;
  const sourceLabel = advanceSource === "ai_suggestion" ? "AI 建议" : "手动";

  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.STAGE_ADVANCED,
    actorId,
    actorName,
    source: advanceSource === "ai_suggestion" ? "system" : "manual",
    fromStage,
    toStage,
    advanceSource,
    confidence,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.STAGE_ADVANCED,
    body: `${actorName} 将项目从「${fromLabel}」推进到「${toLabel}」（来源：${sourceLabel}）`,
    metadata,
    actorId,
    tx,
  });
}

export async function onEmailSent(
  projectId: string,
  emailId: string,
  toEmail: string,
  toName: string | null,
  supplierName: string,
  subject: string,
  actorId: string,
  actorName: string
) {
  const metadata: SystemEventMetadata = {
    eventType: SYSTEM_EVENT_TYPES.EMAIL_SENT,
    actorId,
    actorName,
    source: "system",
    emailId,
    toEmail,
    toName,
    supplierName,
    subject,
  };
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.EMAIL_SENT,
    body: `${actorName} 向「${supplierName}」(${toEmail}) 发送了邮件：${subject}`,
    metadata,
    actorId,
  });
}

// ─── PATCH 事件批量写入（事务内） ───

const DATE_FIELD_LABELS: Record<string, string> = {
  publicDate: "发布时间",
  questionCloseDate: "提问截止时间",
  closeDate: "截标时间",
  submittedAt: "提交时间",
  awardDate: "结果公布时间",
  distributedAt: "分发时间",
  interpretedAt: "解读时间",
  supplierInquiredAt: "供应商询价时间",
  supplierQuotedAt: "供应商报价时间",
};

function normalizeDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function fmtDate(v: unknown): string | null {
  if (!v) return null;
  try {
    return new Date(v as string).toLocaleString("zh-CN", {
      timeZone: "America/Toronto",
    });
  } catch {
    return String(v);
  }
}

/**
 * 在事务内检测项目 PATCH 的关键变更并写入系统消息。
 * 仅当字段值真正变化时才写入（幂等保证）。
 */
export async function emitProjectPatchEvents(
  projectId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actor: { id: string; name: string },
  tx: Prisma.TransactionClient
) {
  const writes: Promise<unknown>[] = [];

  const beforeStatus = String(before.status ?? "");
  const afterStatus = String(after.status ?? "");
  if (beforeStatus !== afterStatus && afterStatus) {
    writes.push(onStatusChanged(projectId, beforeStatus, afterStatus, actor.id, tx));
  }

  const beforeStage = String(before.tenderStatus ?? "");
  const afterStage = String(after.tenderStatus ?? "");
  if (beforeStage !== afterStage && afterStage) {
    writes.push(
      onStageChanged(projectId, beforeStage || "未设定", afterStage, actor.id, tx)
    );
  }

  for (const [field, label] of Object.entries(DATE_FIELD_LABELS)) {
    const oldNorm = normalizeDate(before[field]);
    const newNorm = normalizeDate(after[field]);
    if (oldNorm !== newNorm) {
      writes.push(
        onDateChanged(projectId, field, label, fmtDate(before[field]), fmtDate(after[field]), actor.id, tx)
      );
    }
  }

  if (after.submittedAt && !before.submittedAt) {
    writes.push(
      onProjectSubmitted(projectId, actor.name, actor.id, normalizeDate(after.submittedAt) ?? "", tx)
    );
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
}
