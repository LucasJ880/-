import { focusKeysForReminderSourceKey } from "@/lib/reminders/focus-keys";

export interface ReminderLayerBucket {
  immediate: { sourceKey: string }[];
  today: { sourceKey: string }[];
  upcoming: { sourceKey: string }[];
  unreadCount: number;
  suppressedFocusKeys?: string[];
}

/** 确认提醒后从前端三层列表立即移除，并抑制今日聚焦中的同源任务/日程（乐观更新） */
export function removeReminderFromLayers<T extends ReminderLayerBucket>(
  layers: T,
  sourceKey: string
): T {
  const filter = <I extends { sourceKey: string }>(items: I[]) =>
    items.filter((i) => i.sourceKey !== sourceKey);
  const immediate = filter(layers.immediate);
  const today = filter(layers.today);
  const upcoming = filter(layers.upcoming);
  const suppressed = new Set(layers.suppressedFocusKeys ?? []);
  for (const key of focusKeysForReminderSourceKey(sourceKey)) {
    suppressed.add(key);
  }
  return {
    ...layers,
    immediate,
    today,
    upcoming,
    unreadCount: immediate.length + today.length + upcoming.length,
    suppressedFocusKeys: [...suppressed],
  };
}
