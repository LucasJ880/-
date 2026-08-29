/**
 * 站内通知投递门禁 —— 直发路径统一走这里
 *
 * 背景：扫描类通知（任务/审计）早已经 filter.ts 门禁，但业务直发路径
 * （客户签署、每日简报、销售行动提醒等）此前绕过偏好：用户在设置里
 * 关掉类型，通知照发。本模块补齐：enableInAppNotifications、类型开关、
 * 仅高优先级、静默时段（urgent/high 可打破）全部生效。
 *
 * Grandfather：quote_signed / sales_daily_briefing 两类是 2026-08-29 才
 * 进注册表的——在此之前保存过偏好清单的用户，清单里天然没有它们，
 * 不能当作"显式关闭"。判定：清单最后保存时间早于类型引入时间 → 视为开启。
 */

import { db } from "@/lib/db";
import { buildPreferenceContext, isInQuietHours, breaksQuietHours } from "./filter";

/** 注册表后加类型的引入时间（ISO）；不在表里的类型无 grandfather 语义 */
export const TYPE_INTRODUCED_AT: Record<string, string> = {
  quote_signed: "2026-08-29T00:00:00Z",
  sales_daily_briefing: "2026-08-29T00:00:00Z",
};

/** 纯函数：类型是否开启（含 grandfather 判定），供测试 */
export function isTypeEnabledForUser(args: {
  type: string;
  enabledTypes: Set<string>;
  hasCustomList: boolean;
  listUpdatedAt: Date | null;
}): boolean {
  if (!args.hasCustomList) return true; // 从未自定义 → 全部默认开启
  if (args.enabledTypes.has(args.type)) return true;
  const introducedAt = TYPE_INTRODUCED_AT[args.type];
  if (
    introducedAt &&
    args.listUpdatedAt &&
    args.listUpdatedAt.getTime() < Date.parse(introducedAt)
  ) {
    // 清单保存于该类型存在之前——用户没见过这个开关，不算显式关闭
    return true;
  }
  return false;
}

/** 纯函数：完整门禁判定（偏好行 → 是否投递），供测试 */
export function evaluateDeliveryGate(args: {
  type: string;
  priority: string;
  pref: {
    enableInAppNotifications: boolean;
    onlyHighPriority: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    enabledTypes: Set<string>;
  };
  hasCustomList: boolean;
  listUpdatedAt: Date | null;
  now?: Date;
}): boolean {
  const { pref } = args;
  if (!pref.enableInAppNotifications) return false;
  if (
    !isTypeEnabledForUser({
      type: args.type,
      enabledTypes: pref.enabledTypes,
      hasCustomList: args.hasCustomList,
      listUpdatedAt: args.listUpdatedAt,
    })
  ) {
    return false;
  }
  if (
    pref.onlyHighPriority &&
    args.priority !== "high" &&
    args.priority !== "urgent"
  ) {
    return false;
  }
  if (
    pref.quietHoursEnabled &&
    isInQuietHours(pref.quietHoursStart, pref.quietHoursEnd, true, args.now) &&
    !breaksQuietHours(args.priority)
  ) {
    return false;
  }
  return true;
}

/**
 * 直发路径入口：该用户此刻是否应收到这条站内通知。
 * 偏好行不存在 / 查询失败 → 默认投递（fail-open，提醒漏发比多发更伤）。
 */
export async function shouldDeliverInApp(
  userId: string,
  args: { type: string; priority?: string },
): Promise<boolean> {
  try {
    const row = await db.userNotificationPreference.findUnique({
      where: { userId },
    });
    if (!row) return true;
    const pref = buildPreferenceContext(row);
    return evaluateDeliveryGate({
      type: args.type,
      priority: args.priority ?? "medium",
      pref,
      hasCustomList: !!row.enabledTypesJson,
      listUpdatedAt: row.updatedAt ?? null,
    });
  } catch {
    return true;
  }
}
