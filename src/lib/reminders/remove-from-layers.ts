export interface ReminderLayerBucket {
  immediate: { sourceKey: string }[];
  today: { sourceKey: string }[];
  upcoming: { sourceKey: string }[];
  unreadCount: number;
}

/** 确认提醒后从前端三层列表立即移除（乐观更新） */
export function removeReminderFromLayers<T extends ReminderLayerBucket>(
  layers: T,
  sourceKey: string
): T {
  const filter = <I extends { sourceKey: string }>(items: I[]) =>
    items.filter((i) => i.sourceKey !== sourceKey);
  const immediate = filter(layers.immediate);
  const today = filter(layers.today);
  const upcoming = filter(layers.upcoming);
  return {
    ...layers,
    immediate,
    today,
    upcoming,
    unreadCount: immediate.length + today.length + upcoming.length,
  };
}
