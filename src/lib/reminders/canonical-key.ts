/**
 * Reminder 稳定身份
 *
 * 界面业务 Key（不含相对日）：
 * - deadline:{taskId}
 * - event:{eventId}
 *
 * 数据库已读标记 Key（用户级，避开全局 sourceKey @unique 冲突）：
 * - read:{userId}:{canonicalKey}
 *
 * 兼容旧 sourceKey：deadline:today|tomorrow|overdue:*、event:today:*
 * 以及旧的全局 canonical 已读行（仅归属当前用户时计入）。
 */

const LEGACY_DEADLINE =
  /^deadline:(?:today|tomorrow|overdue):(.+)$/;
const LEGACY_EVENT = /^event:(?:today|tomorrow):(.+)$/;

export function canonicalReminderKey(sourceKey: string): string {
  const deadline = sourceKey.match(LEGACY_DEADLINE);
  if (deadline?.[1]) return `deadline:${deadline[1]}`;

  const event = sourceKey.match(LEGACY_EVENT);
  if (event?.[1]) return `event:${event[1]}`;

  // 若误传 read marker，剥到业务 Key
  const readMarker = sourceKey.match(/^read:[^:]+:(.+)$/);
  if (readMarker?.[1]) return canonicalReminderKey(readMarker[1]);

  return sourceKey;
}

export function deadlineReminderKey(taskId: string): string {
  return `deadline:${taskId}`;
}

export function eventReminderKey(eventId: string): string {
  return `event:${eventId}`;
}

/** 用户级已读标记，保证多用户确认同一 deadline/event 不冲突 */
export function reminderReadMarkerKey(
  userId: string,
  canonicalKey: string
): string {
  return `read:${userId}:${canonicalReminderKey(canonicalKey)}`;
}

export function businessKeyFromReadMarker(
  userId: string,
  sourceKey: string
): string | null {
  const prefix = `read:${userId}:`;
  if (!sourceKey.startsWith(prefix)) return null;
  return sourceKey.slice(prefix.length);
}

export function isReminderReadMarkerKey(sourceKey: string): boolean {
  return sourceKey.startsWith("read:");
}

/**
 * 将当前用户的已读 sourceKey 还原为可比较的业务 Key 集合。
 * A 的 marker 不会进入 B 的集合（调用方应只传入 userId=B 的记录）。
 */
export function buildReadKeySet(
  userId: string,
  sourceKeys: string[]
): Set<string> {
  const set = new Set<string>();
  for (const key of sourceKeys) {
    const fromMarker = businessKeyFromReadMarker(userId, key);
    if (fromMarker) {
      set.add(fromMarker);
      set.add(canonicalReminderKey(fromMarker));
      continue;
    }
    // 忽略其他用户的 read marker（防御）
    if (isReminderReadMarkerKey(key)) continue;

    // 兼容旧全局 canonical / legacy relative keys（仅当记录属本用户时由查询保证）
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

/** 判断确认写入应使用的存储 Key（followup 用原业务行；deadline/event 用用户 marker） */
export function resolveReminderReadStorageKey(
  userId: string,
  rawSourceKey: string
): { businessKey: string; storageKey: string; kind: "followup" | "marker" } {
  const businessKey = canonicalReminderKey(rawSourceKey);
  if (
    businessKey.startsWith("deadline:") ||
    businessKey.startsWith("event:")
  ) {
    return {
      businessKey,
      storageKey: reminderReadMarkerKey(userId, businessKey),
      kind: "marker",
    };
  }
  return {
    businessKey,
    storageKey: businessKey,
    kind: "followup",
  };
}
