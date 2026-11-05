import { db } from "@/lib/db";
import { DEFAULT_ENABLED_TYPES } from "./constants";
import { effectiveEnabledTypes, parsePreferenceMetadata } from "./delivery-gate";

export interface UserNotificationPreferenceDTO {
  id: string;
  userId: string;
  orgId: string | null;
  enableInAppNotifications: boolean;
  onlyHighPriority: boolean;
  onlyMyItems: boolean;
  includeWatchedProjects: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  emailEnabled: boolean;
  pushEnabled: boolean;
  enabledTypes: string[];
  createdAt: string;
  updatedAt: string;
}

/** 物化类型清单所需的偏好行字段 */
interface TypePreferenceRow {
  enabledTypesJson: string | null;
  metadata?: string | null;
  updatedAt?: Date | null;
}

type PreferenceRow = TypePreferenceRow & {
  id: string;
  userId: string;
  orgId: string | null;
  enableInAppNotifications: boolean;
  onlyHighPriority: boolean;
  onlyMyItems: boolean;
  includeWatchedProjects: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  emailEnabled: boolean;
  pushEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UserNotificationPreferencePatch = Partial<{
  enableInAppNotifications: boolean;
  onlyHighPriority: boolean;
  onlyMyItems: boolean;
  includeWatchedProjects: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  emailEnabled: boolean;
  pushEnabled: boolean;
  enabledTypes: string[];
}>;

/**
 * 邮件偏好的生效值（COLLAB-2 D13）：用户在设置页明确选过（metadata.emailChoiceAt）
 * 就按这一列；没选过（偏好行是打开铃铛时自动建的，列默认 false）视为开启。
 */
export function effectiveEmailEnabled(row: {
  emailEnabled: boolean;
  metadata?: string | null;
}): boolean {
  const meta = parsePreferenceMetadata(row.metadata);
  return meta.emailChoiceAt != null ? row.emailEnabled : true;
}

/**
 * 偏好行的每一处写入都带上这两项（COLLAB-2 D12）：
 * - enabledTypesJson：用户提交的清单；没提交时写回写入前的生效清单（原本没有清单的行不凭空写）；
 * - metadata：传入的 metadata（缺省为原值），并记下写入时的注册表 knownTypes。
 */
export function typePreferenceWriteFields(
  before: TypePreferenceRow,
  opts: { enabledTypes?: string[]; meta?: Record<string, unknown> } = {},
): { enabledTypesJson?: string; metadata: string } {
  const meta = opts.meta ?? parsePreferenceMetadata(before.metadata);
  const metadata = JSON.stringify({ ...meta, knownTypes: [...DEFAULT_ENABLED_TYPES] });
  if (opts.enabledTypes !== undefined) {
    return { enabledTypesJson: JSON.stringify(opts.enabledTypes), metadata };
  }
  if (!before.enabledTypesJson) return { metadata };
  return { enabledTypesJson: JSON.stringify(effectiveEnabledTypes(before)), metadata };
}

/** 自动建行的数据：清单为当前注册表，并记下 knownTypes */
export function initialPreferenceData(userId: string) {
  return {
    userId,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    enabledTypesJson: JSON.stringify(DEFAULT_ENABLED_TYPES),
    metadata: JSON.stringify({ knownTypes: [...DEFAULT_ENABLED_TYPES] }),
  };
}

/** 设置页修改 → 写入数据；带了 emailEnabled 时记下"明确选过" */
export function buildPreferenceUpdate(
  before: TypePreferenceRow,
  patch: UserNotificationPreferencePatch,
  now: Date = new Date(),
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.enableInAppNotifications !== undefined)
    data.enableInAppNotifications = patch.enableInAppNotifications;
  if (patch.onlyHighPriority !== undefined) data.onlyHighPriority = patch.onlyHighPriority;
  if (patch.onlyMyItems !== undefined) data.onlyMyItems = patch.onlyMyItems;
  if (patch.includeWatchedProjects !== undefined)
    data.includeWatchedProjects = patch.includeWatchedProjects;
  if (patch.quietHoursEnabled !== undefined) data.quietHoursEnabled = patch.quietHoursEnabled;
  if (patch.quietHoursStart !== undefined) data.quietHoursStart = patch.quietHoursStart;
  if (patch.quietHoursEnd !== undefined) data.quietHoursEnd = patch.quietHoursEnd;
  if (patch.emailEnabled !== undefined) data.emailEnabled = patch.emailEnabled;
  if (patch.pushEnabled !== undefined) data.pushEnabled = patch.pushEnabled;

  const meta = parsePreferenceMetadata(before.metadata);
  if (patch.emailEnabled !== undefined) meta.emailChoiceAt = now.toISOString();
  return {
    ...data,
    ...typePreferenceWriteFields(before, { enabledTypes: patch.enabledTypes, meta }),
  };
}

export function rowToDTO(row: PreferenceRow): UserNotificationPreferenceDTO {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    enableInAppNotifications: row.enableInAppNotifications,
    onlyHighPriority: row.onlyHighPriority,
    onlyMyItems: row.onlyMyItems,
    includeWatchedProjects: row.includeWatchedProjects,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    emailEnabled: effectiveEmailEnabled(row),
    pushEnabled: row.pushEnabled,
    enabledTypes: effectiveEnabledTypes(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureUserNotificationPreference(userId: string) {
  const existing = await db.userNotificationPreference.findUnique({
    where: { userId },
  });
  if (existing) return existing;
  return db.userNotificationPreference.create({ data: initialPreferenceData(userId) });
}

export async function getUserNotificationPreferenceDTO(
  userId: string
): Promise<UserNotificationPreferenceDTO> {
  const row = await ensureUserNotificationPreference(userId);
  return rowToDTO(row);
}

export async function updateUserNotificationPreference(
  userId: string,
  patch: UserNotificationPreferencePatch
): Promise<UserNotificationPreferenceDTO> {
  const before = await ensureUserNotificationPreference(userId);
  const row = await db.userNotificationPreference.update({
    where: { userId },
    data: buildPreferenceUpdate(before, patch),
  });
  return rowToDTO(row);
}
