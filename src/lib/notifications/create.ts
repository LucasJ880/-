/**
 * 统一创建站内通知助手
 *
 * 所有代码路径如果要发站内通知，应通过此函数，方便后续加邮件推送。
 */

import { db } from "@/lib/db";

export interface CreateNotificationInput {
  userId: string;
  type: string;
  category?: string;
  title: string;
  summary?: string;
  orgId?: string | null;
  projectId?: string;
  entityType?: string;
  entityId?: string;
  priority?: string;
  sourceKey?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 创建一条站内通知。`sourceKey` 存在时做幂等去重。
 */
export async function createNotification(input: CreateNotificationInput) {
  const {
    userId,
    type,
    category = type,
    title,
    summary,
    orgId,
    projectId,
    entityType,
    entityId,
    priority = "medium",
    sourceKey,
    metadata,
  } = input;

  if (sourceKey) {
    const existing = await db.notification.findUnique({ where: { sourceKey } });
    if (existing) return existing;
  }

  return db.notification.create({
    data: {
      userId,
      orgId: orgId ?? null,
      type,
      category,
      title,
      summary: summary ?? null,
      projectId: projectId ?? null,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      priority,
      sourceKey: sourceKey ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      status: "unread",
    },
  });
}

/**
 * 批量通知用户；sourceKey = `${sourceKeyPrefix}:${userId}` 幂等去重。
 * @returns 新建条数
 */
export async function createNotificationsForUsers(
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId" | "sourceKey"> & {
    sourceKeyPrefix: string;
  },
): Promise<number> {
  let created = 0;
  const { sourceKeyPrefix, ...rest } = input;
  for (const uid of userIds) {
    const before = await db.notification.findUnique({
      where: { sourceKey: `${sourceKeyPrefix}:${uid}` },
      select: { id: true },
    });
    if (before) continue;
    await createNotification({
      ...rest,
      userId: uid,
      sourceKey: `${sourceKeyPrefix}:${uid}`,
    });
    created += 1;
  }
  return created;
}

/**
 * 批量通知项目所有活跃成员（排除指定用户，通常排除操作者自己）
 */
export async function notifyProjectMembers(
  projectId: string,
  excludeUserId: string,
  input: Omit<CreateNotificationInput, "userId" | "projectId">
) {
  const members = await db.projectMember.findMany({
    where: { projectId, status: "active", userId: { not: excludeUserId } },
    select: { userId: true },
  });

  const owner = await db.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  const userIds = new Set(members.map((m) => m.userId));
  if (owner && owner.ownerId !== excludeUserId) {
    userIds.add(owner.ownerId);
  }

  const results = [];
  for (const uid of userIds) {
    const sourceKey = input.sourceKey ? `${input.sourceKey}:${uid}` : undefined;
    results.push(
      createNotification({ ...input, userId: uid, projectId, sourceKey })
    );
  }
  await Promise.allSettled(results);
}
