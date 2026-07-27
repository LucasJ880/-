import { canonicalReminderKey } from "@/lib/reminders/canonical-key";

/**
 * 「知道了」后，主页「今日聚焦」中应对齐隐藏的条目 id。
 * 与 dashboard-today-focus 的 FocusItem.id 约定一致。
 */
export function focusKeysForReminderSourceKey(sourceKey: string): string[] {
  const canonical = canonicalReminderKey(sourceKey);
  const keys = new Set<string>([`rem-${sourceKey}`, `rem-${canonical}`]);

  if (canonical.startsWith("deadline:")) {
    const taskId = canonical.slice("deadline:".length);
    if (taskId) keys.add(`task-${taskId}`);
  } else if (canonical.startsWith("event:")) {
    const eventId = canonical.slice("event:".length);
    if (eventId) {
      // schedule API 使用 cal_{id}，今日聚焦再包一层 evt-
      keys.add(`evt-cal_${eventId}`);
      keys.add(`evt-${eventId}`);
    }
  }

  return [...keys];
}

/** 由已读 sourceKey 集合推导聚焦区应抑制的条目 */
export function suppressedFocusKeysFromReadSet(readSet: Set<string>): string[] {
  const out = new Set<string>();
  for (const key of readSet) {
    for (const fk of focusKeysForReminderSourceKey(key)) out.add(fk);
  }
  return [...out];
}
