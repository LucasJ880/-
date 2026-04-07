/**
 * 主动触发 → 通知系统桥接
 *
 * 将扫描结果中的 urgent/warning 建议写入 Notification 表。
 * 使用 dedupeKey 作为 sourceKey 确保幂等。
 */

import { db } from "@/lib/db";
import type { ProactiveSuggestion } from "./types";

export async function syncSuggestionsToNotifications(
  userId: string,
  suggestions: ProactiveSuggestion[]
): Promise<number> {
  const candidates = suggestions.filter(
    (s) => s.severity === "urgent" || s.severity === "warning"
  );

  if (candidates.length === 0) return 0;

  const sourceKeys = candidates.map((s) => `proactive:${s.dedupeKey}`);
  const existing = await db.notification.findMany({
    where: { userId, sourceKey: { in: sourceKeys } },
    select: { sourceKey: true },
  });
  const existingSet = new Set(existing.map((e) => e.sourceKey));

  const toCreate = candidates
    .filter((s) => !existingSet.has(`proactive:${s.dedupeKey}`))
    .map((s) => {
      const isSales = !!s.customerId;
      return {
        userId,
        projectId: s.projectId ?? null,
        type: `proactive_${s.kind}` as string,
        category: s.severity === "urgent" ? "alert" : "reminder",
        title: s.title,
        summary: s.description,
        entityType: isSales ? "customer" : "project",
        entityId: isSales ? s.customerId : s.projectId,
        status: "unread",
        priority: s.severity === "urgent" ? "high" : "medium",
        sourceKey: `proactive:${s.dedupeKey}`,
      };
    });

  if (toCreate.length === 0) return 0;

  await db.notification.createMany({ data: toCreate, skipDuplicates: true });
  return toCreate.length;
}
