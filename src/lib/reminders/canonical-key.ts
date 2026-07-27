/**
 * Reminder 稳定身份
 *
 * 展示层可用 today / tomorrow / overdue，但唯一 Key 不含日期相对词：
 * - deadline:{taskId}
 * - event:{eventId}
 *
 * 兼容旧 sourceKey：deadline:today|tomorrow|overdue:*、event:today:*
 */

const LEGACY_DEADLINE =
  /^deadline:(?:today|tomorrow|overdue):(.+)$/;
const LEGACY_EVENT = /^event:(?:today|tomorrow):(.+)$/;

export function canonicalReminderKey(sourceKey: string): string {
  const deadline = sourceKey.match(LEGACY_DEADLINE);
  if (deadline?.[1]) return `deadline:${deadline[1]}`;

  const event = sourceKey.match(LEGACY_EVENT);
  if (event?.[1]) return `event:${event[1]}`;

  return sourceKey;
}

export function deadlineReminderKey(taskId: string): string {
  return `deadline:${taskId}`;
}

export function eventReminderKey(eventId: string): string {
  return `event:${eventId}`;
}

/** 将已读 sourceKey 集合扩展为 canonical，便于新旧 key 互相命中 */
export function buildReadKeySet(sourceKeys: string[]): Set<string> {
  const set = new Set<string>();
  for (const key of sourceKeys) {
    set.add(key);
    set.add(canonicalReminderKey(key));
  }
  return set;
}

export function isReminderRead(
  sourceKey: string,
  readSet: Set<string>
): boolean {
  if (readSet.has(sourceKey)) return true;
  return readSet.has(canonicalReminderKey(sourceKey));
}
