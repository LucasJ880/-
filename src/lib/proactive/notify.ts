/**
 * 主动触发 → 通知系统桥接
 *
 * 将扫描结果中的 urgent/warning 建议写入 Notification 表。
 * sourceKey = `proactive:{userId}:{dedupeKey}`（Notification.sourceKey 全局唯一；dedupeKey 不含用户，
 * 不带 userId 时同一条提醒全平台只能写给第一个被扫到的人）。本人名下已有旧格式 `proactive:{dedupeKey}` 的视为已发，不重发。
 */

import type { ProactiveSuggestion } from "./types";

export function proactiveSourceKey(userId: string, dedupeKey: string): string {
  return `proactive:${userId}:${dedupeKey}`;
}

/** A-3b 之前的格式（不含 userId），只用于识别本人已收到过的提醒 */
export function legacyProactiveSourceKey(dedupeKey: string): string {
  return `proactive:${dedupeKey}`;
}

export interface ProactiveNotificationRow {
  userId: string;
  projectId: string | null;
  type: string;
  category: string;
  title: string;
  summary: string;
  entityType: string;
  entityId: string | null | undefined;
  status: string;
  priority: string;
  sourceKey: string;
}

/** 纯函数：本人还没收到过（新旧两种 key 都没有）的 urgent / warning 建议 → 待写入的通知行 */
export function planProactiveNotifications(
  userId: string,
  suggestions: readonly ProactiveSuggestion[],
  existingKeys: ReadonlySet<string>,
): ProactiveNotificationRow[] {
  const seen = new Set<string>();
  const rows: ProactiveNotificationRow[] = [];
  for (const s of suggestions) {
    if (s.severity !== "urgent" && s.severity !== "warning") continue;
    const sourceKey = proactiveSourceKey(userId, s.dedupeKey);
    if (seen.has(sourceKey) || existingKeys.has(sourceKey) || existingKeys.has(legacyProactiveSourceKey(s.dedupeKey))) continue;
    seen.add(sourceKey);
    const isSales = !!s.customerId;
    rows.push({
      userId,
      projectId: s.projectId ?? null,
      type: `proactive_${s.kind}`,
      category: s.severity === "urgent" ? "alert" : "reminder",
      title: s.title,
      summary: s.description,
      entityType: isSales ? "customer" : "project",
      entityId: isSales ? s.customerId : s.projectId,
      status: "unread",
      priority: s.severity === "urgent" ? "high" : "medium",
      sourceKey,
    });
  }
  return rows;
}

export interface ProactiveNotifyDeps {
  /** 本人名下已存在的 sourceKey（只查本人） */
  existingKeys(userId: string, keys: string[]): Promise<string[]>;
  /** 写入并返回实际新建条数（冲突跳过的不算） */
  createMany(rows: ProactiveNotificationRow[]): Promise<number>;
}

export async function syncSuggestionsToNotifications(
  userId: string,
  suggestions: ProactiveSuggestion[],
  deps: ProactiveNotifyDeps = defaultProactiveNotifyDeps(),
): Promise<number> {
  const candidates = suggestions.filter((s) => s.severity === "urgent" || s.severity === "warning");
  if (candidates.length === 0) return 0;

  const keys = candidates.flatMap((s) => [proactiveSourceKey(userId, s.dedupeKey), legacyProactiveSourceKey(s.dedupeKey)]);
  const existing = new Set(await deps.existingKeys(userId, [...new Set(keys)]));
  const toCreate = planProactiveNotifications(userId, candidates, existing);
  if (toCreate.length === 0) return 0;
  return deps.createMany(toCreate);
}

export function defaultProactiveNotifyDeps(): ProactiveNotifyDeps {
  return {
    existingKeys: async (userId, keys) => {
      const { db } = await import("@/lib/db");
      const rows = await db.notification.findMany({ where: { userId, sourceKey: { in: keys } }, select: { sourceKey: true } });
      return rows.map((r) => r.sourceKey).filter((k): k is string => Boolean(k));
    },
    createMany: async (rows) => {
      const { db } = await import("@/lib/db");
      const { count } = await db.notification.createMany({ data: rows, skipDuplicates: true });
      return count;
    },
  };
}
