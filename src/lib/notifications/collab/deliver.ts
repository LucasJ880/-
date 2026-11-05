/**
 * 协作通知 COLLAB-2：统一投递入口（design D1、D2）
 *
 * 对每个事件依次：
 * 1. 收件人过滤（recipients.ts）：在职、对象所属组织的 active 成员、排除操作人、去重；
 * 2. 逐人判门禁：shouldDeliverInApp（站内总开关、类型开关、只看高优先级、免打扰）；
 * 3. 写入：去重键 `<类型>:<对象 id>:<事件区分键>:<收件人 id>` 已存在时不再写；
 *    唯一约束冲突（P2002，并发或重试）当作已存在。
 *
 * 整个调用不向外抛错：任何一步出错只记 console.error，业务请求照常完成。
 * 一个人出错不影响同批其他人。业务路由在写库成功之后 await 这个入口。
 */

import { db } from "@/lib/db";
import { shouldDeliverInApp } from "@/lib/notifications/delivery-gate";
import { defaultRecipientDeps, filterCollabRecipients, type RecipientDeps } from "./recipients";

export interface CollabEvent {
  type: string;
  priority: string;
  /** 已脱敏的标题与摘要（events.ts 算好） */
  title: string;
  summary: string | null;
  entityType: string;
  entityId: string;
  /** 事件区分键（D2）；给了 sourceKeyPrefix 时不用 */
  eventKey?: string;
  /** 去重键前缀（不含收件人 id），缺省为 `<类型>:<对象 id>:<事件区分键>`；提及通知用 `mention:<消息或评论 id>` */
  sourceKeyPrefix?: string;
  /** 对象所属组织；为 null 时不查组织成员 */
  orgId: string | null;
  projectId?: string | null;
  /** 触发这次事件的人；不收这次事件的通知 */
  actorId: string | null;
  recipientIds: ReadonlyArray<string | null | undefined>;
  metadata?: Record<string, unknown>;
}

export interface CollabNotificationRow {
  userId: string;
  orgId: string | null;
  projectId: string | null;
  type: string;
  category: string;
  title: string;
  summary: string | null;
  entityType: string;
  entityId: string;
  priority: string;
  status: "unread";
  sourceKey: string;
  metadata: string | null;
}

export interface CollabDeliverDeps extends RecipientDeps {
  shouldDeliver(userId: string, args: { type: string; priority: string }): Promise<boolean>;
  findBySourceKey(sourceKey: string): Promise<{ id: string } | null>;
  createNotification(row: CollabNotificationRow): Promise<{ id: string }>;
  logError(message: string, err: unknown): void;
}

export interface CollabDeliverResult {
  created: string[];
  existing: string[];
  gated: string[];
  failed: string[];
}

export const defaultCollabDeliverDeps: CollabDeliverDeps = {
  ...defaultRecipientDeps,
  shouldDeliver: (userId, args) => shouldDeliverInApp(userId, args),
  findBySourceKey: (sourceKey) =>
    db.notification.findUnique({ where: { sourceKey }, select: { id: true } }),
  createNotification: (row) => db.notification.create({ data: row, select: { id: true } }),
  logError: (message, err) => console.error(message, err),
};

export function collabSourceKey(
  type: string,
  entityId: string,
  eventKey: string,
  recipientId: string,
): string {
  return `${type}:${entityId}:${eventKey}:${recipientId}`;
}

/** 这次事件发给某个收件人的去重键 */
export function eventSourceKey(
  event: Pick<CollabEvent, "type" | "entityId" | "eventKey" | "sourceKeyPrefix">,
  recipientId: string,
): string {
  if (event.sourceKeyPrefix) return `${event.sourceKeyPrefix}:${recipientId}`;
  return collabSourceKey(event.type, event.entityId, event.eventKey ?? "", recipientId);
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === "P2002"
  );
}

export async function deliverCollabNotification(
  event: CollabEvent,
  deps: CollabDeliverDeps = defaultCollabDeliverDeps,
): Promise<CollabDeliverResult> {
  const result: CollabDeliverResult = { created: [], existing: [], gated: [], failed: [] };
  const where = event.sourceKeyPrefix ?? `${event.type}:${event.entityId}:${event.eventKey ?? ""}`;
  let recipients: string[];
  try {
    recipients = await filterCollabRecipients(
      event.recipientIds,
      { orgId: event.orgId, actorId: event.actorId },
      deps,
    );
  } catch (err) {
    deps.logError(`[collab-notify] 查收件人失败 ${where}`, err);
    return result;
  }

  const metadata = event.metadata ? JSON.stringify(event.metadata) : null;
  for (const userId of recipients) {
    const sourceKey = eventSourceKey(event, userId);
    try {
      if (!(await deps.shouldDeliver(userId, { type: event.type, priority: event.priority }))) {
        result.gated.push(userId);
        continue;
      }
      if (await deps.findBySourceKey(sourceKey)) {
        result.existing.push(userId);
        continue;
      }
      try {
        await deps.createNotification({
          userId,
          orgId: event.orgId,
          projectId: event.projectId ?? null,
          type: event.type,
          category: event.type,
          title: event.title,
          summary: event.summary,
          entityType: event.entityType,
          entityId: event.entityId,
          priority: event.priority,
          status: "unread",
          sourceKey,
          metadata,
        });
        result.created.push(userId);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // 并发或重试已写了同一去重键：那一条就是本事件的通知，当作已存在
        result.existing.push(userId);
      }
    } catch (err) {
      deps.logError(`[collab-notify] 写通知失败 ${sourceKey}`, err);
      result.failed.push(userId);
    }
  }
  return result;
}
