import { db } from "@/lib/db";
import { DEFAULT_ENABLED_TYPES } from "./constants";

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

function parseEnabledTypes(json: string | null | undefined): string[] {
  if (!json) return [...DEFAULT_ENABLED_TYPES];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [...DEFAULT_ENABLED_TYPES];
    return arr.filter((x) => typeof x === "string");
  } catch {
    return [...DEFAULT_ENABLED_TYPES];
  }
}

export function rowToDTO(row: {
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
  enabledTypesJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UserNotificationPreferenceDTO {
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
    emailEnabled: row.emailEnabled,
    pushEnabled: row.pushEnabled,
    enabledTypes: parseEnabledTypes(row.enabledTypesJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureUserNotificationPreference(userId: string) {
  const existing = await db.userNotificationPreference.findUnique({
    where: { userId },
  });
  if (existing) return existing;
  return db.userNotificationPreference.create({
    data: {
      userId,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      enabledTypesJson: JSON.stringify(DEFAULT_ENABLED_TYPES),
    },
  });
}

export async function getUserNotificationPreferenceDTO(
  userId: string
): Promise<UserNotificationPreferenceDTO> {
  const row = await ensureUserNotificationPreference(userId);
  return rowToDTO(row);
}

export async function updateUserNotificationPreference(
  userId: string,
  patch: Partial<{
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
  }>
): Promise<UserNotificationPreferenceDTO> {
  await ensureUserNotificationPreference(userId);
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
  if (patch.enabledTypes !== undefined) {
    data.enabledTypesJson = JSON.stringify(patch.enabledTypes);
  }
  const row = await db.userNotificationPreference.update({
    where: { userId },
    data,
  });
  return rowToDTO(row);
}
