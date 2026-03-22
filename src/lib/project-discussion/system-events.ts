/**
 * 项目讨论 — 系统事件写入
 *
 * 将项目关键变更写入讨论流（type=SYSTEM），
 * 实现人工消息与系统事件共存的项目协作时间流。
 */

import { db } from "@/lib/db";
import { SYSTEM_EVENT_TYPES, type SystemEventType } from "./types";
import { getOrCreateMainConversation } from "./service";

interface SystemEventOptions {
  projectId: string;
  eventType: SystemEventType;
  body: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
}

/**
 * 写入一条系统消息到项目讨论流。
 * 如果项目尚无讨论会话则自动创建。
 */
export async function createProjectSystemMessage(opts: SystemEventOptions) {
  const conv = await getOrCreateMainConversation(opts.projectId);
  return db.projectMessage.create({
    data: {
      conversationId: conv.id,
      projectId: opts.projectId,
      senderId: opts.actorId ?? null,
      type: "SYSTEM",
      body: opts.body,
      metadata: {
        eventType: opts.eventType,
        ...(opts.metadata ?? {}),
      },
    },
  });
}

/**
 * 项目创建时写入系统消息
 */
export async function onProjectCreated(
  projectId: string,
  projectName: string,
  creatorName: string
) {
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.PROJECT_CREATED,
    body: `${creatorName} 创建了项目「${projectName}」`,
    metadata: { projectName, creatorName },
  });
}

/**
 * 成员加入项目时写入系统消息
 */
export async function onMemberJoined(
  projectId: string,
  memberName: string,
  role: string,
  actorId?: string
) {
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.MEMBER_JOINED,
    body: `${memberName} 加入了项目（角色：${role}）`,
    metadata: { memberName, role },
    actorId,
  });
}

/**
 * 成员被移除时写入系统消息
 */
export async function onMemberRemoved(
  projectId: string,
  memberName: string,
  actorId?: string
) {
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.MEMBER_REMOVED,
    body: `${memberName} 被移出了项目`,
    metadata: { memberName },
    actorId,
  });
}

/**
 * 项目阶段变更时写入系统消息
 */
export async function onStageChanged(
  projectId: string,
  oldStage: string,
  newStage: string,
  actorId?: string
) {
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.STAGE_CHANGED,
    body: `项目阶段从「${oldStage}」变更为「${newStage}」`,
    metadata: { oldStage, newStage },
    actorId,
  });
}

/**
 * 关键日期变更时写入系统消息
 */
export async function onDateChanged(
  projectId: string,
  fieldLabel: string,
  oldDate: string | null,
  newDate: string | null,
  actorId?: string
) {
  const oldStr = oldDate ?? "未设定";
  const newStr = newDate ?? "已清除";
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.DATE_CHANGED,
    body: `${fieldLabel}从 ${oldStr} 更新为 ${newStr}`,
    metadata: { fieldLabel, oldDate, newDate },
    actorId,
  });
}

/**
 * 项目提交时写入系统消息
 */
export async function onProjectSubmitted(
  projectId: string,
  actorName: string,
  actorId?: string
) {
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.PROJECT_SUBMITTED,
    body: `${actorName} 提交了项目`,
    metadata: { actorName },
    actorId,
  });
}

/**
 * 项目状态变更时写入系统消息
 */
export async function onStatusChanged(
  projectId: string,
  oldStatus: string,
  newStatus: string,
  actorId?: string
) {
  const labels: Record<string, string> = {
    active: "进行中",
    completed: "已完成",
    archived: "已归档",
    overdue: "已逾期",
  };
  const oldLabel = labels[oldStatus] ?? oldStatus;
  const newLabel = labels[newStatus] ?? newStatus;
  return createProjectSystemMessage({
    projectId,
    eventType: SYSTEM_EVENT_TYPES.STATUS_CHANGED,
    body: `项目状态从「${oldLabel}」变更为「${newLabel}」`,
    metadata: { oldStatus, newStatus },
    actorId,
  });
}

/**
 * 在项目 PATCH 中检测关键变更并批量写入系统消息。
 * 调用方传入 before/after 对象和操作人信息。
 */
export async function emitProjectPatchEvents(
  projectId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actor: { id: string; name: string }
) {
  const promises: Promise<unknown>[] = [];

  if (before.status !== after.status && after.status) {
    promises.push(
      onStatusChanged(
        projectId,
        String(before.status ?? ""),
        String(after.status),
        actor.id
      )
    );
  }

  if (before.tenderStatus !== after.tenderStatus && after.tenderStatus) {
    promises.push(
      onStageChanged(
        projectId,
        String(before.tenderStatus ?? "未设定"),
        String(after.tenderStatus),
        actor.id
      )
    );
  }

  const dateFieldLabels: Record<string, string> = {
    publicDate: "发布时间",
    questionCloseDate: "提问截止时间",
    closeDate: "截标时间",
    submittedAt: "提交时间",
    awardDate: "结果公布时间",
    distributedAt: "分发时间",
    interpretedAt: "解读时间",
    supplierQuotedAt: "供应商报价时间",
  };

  for (const [field, label] of Object.entries(dateFieldLabels)) {
    const oldVal = before[field];
    const newVal = after[field];
    if (String(oldVal ?? "") !== String(newVal ?? "")) {
      const fmt = (v: unknown) => {
        if (!v) return null;
        try {
          return new Date(v as string).toLocaleString("zh-CN", {
            timeZone: "America/Toronto",
          });
        } catch {
          return String(v);
        }
      };
      promises.push(
        onDateChanged(projectId, label, fmt(oldVal), fmt(newVal), actor.id)
      );
    }
  }

  if (
    after.submittedAt &&
    !before.submittedAt
  ) {
    promises.push(onProjectSubmitted(projectId, actor.name, actor.id));
  }

  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
}
