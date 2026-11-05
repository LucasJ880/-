/**
 * 用户自动化偏好管理
 *
 * 存储在 UserNotificationPreference.metadata JSON 中的
 * "automation" 字段，避免 schema 变更。
 */

import { db } from "@/lib/db";
import { DEFAULT_ENABLED_TYPES } from "@/lib/notifications/constants";
import { typePreferenceWriteFields } from "@/lib/notifications/preferences";

export interface AutomationPrefs {
  enabled: boolean;
  autoCreateTasks: boolean;
  autoOverdueFollowup: boolean;
}

const DEFAULT_PREFS: AutomationPrefs = {
  enabled: false,
  autoCreateTasks: false,
  autoOverdueFollowup: false,
};

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getUserAutomationPrefs(
  userId: string
): Promise<AutomationPrefs> {
  const pref = await db.userNotificationPreference.findUnique({
    where: { userId },
    select: { metadata: true },
  });

  const meta = parseMetadata(pref?.metadata ?? null);
  const automation = meta.automation as Partial<AutomationPrefs> | undefined;
  if (!automation) return DEFAULT_PREFS;

  return {
    enabled: automation.enabled ?? DEFAULT_PREFS.enabled,
    autoCreateTasks: automation.autoCreateTasks ?? DEFAULT_PREFS.autoCreateTasks,
    autoOverdueFollowup:
      automation.autoOverdueFollowup ?? DEFAULT_PREFS.autoOverdueFollowup,
  };
}

/**
 * 快捷查询：用户是否开启了任何自动化
 */
export async function getUserAutomationEnabled(
  userId: string
): Promise<boolean> {
  const prefs = await getUserAutomationPrefs(userId);
  return prefs.enabled;
}

export async function updateUserAutomationPrefs(
  userId: string,
  update: Partial<AutomationPrefs>
): Promise<AutomationPrefs> {
  // COLLAB-2：先读出原行——这次写入会刷新 updatedAt，要先把生效的类型清单物化、记下 knownTypes
  let before = await db.userNotificationPreference.findUnique({
    where: { userId },
  });
  if (!before) {
    before = await db.userNotificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        metadata: JSON.stringify({ knownTypes: [...DEFAULT_ENABLED_TYPES] }),
      },
      update: {},
    });
  }

  const meta = parseMetadata(before.metadata);
  const current = (meta.automation as Partial<AutomationPrefs>) ?? DEFAULT_PREFS;
  const merged = { ...DEFAULT_PREFS, ...current, ...update };

  await db.userNotificationPreference.update({
    where: { userId },
    data: typePreferenceWriteFields(before, {
      meta: { ...meta, automation: merged },
    }),
  });

  return merged;
}
