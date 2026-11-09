/**
 * 站内通知投递门禁 —— 直发路径统一走这里
 *
 * 背景：扫描类通知（任务/审计）早已经 filter.ts 门禁，但业务直发路径
 * （客户签署、每日简报、销售行动提醒等）此前绕过偏好：用户在设置里
 * 关掉类型，通知照发。本模块补齐：enableInAppNotifications、类型开关、
 * 仅高优先级、静默时段（urgent/high 可打破）全部生效。
 *
 * Grandfather：quote_signed / sales_daily_briefing 两类是 2026-08-29 才（install_completed /
 * install_balance_confirmed 是 2026-10-28）
 * 进注册表的——在此之前保存过偏好清单的用户，清单里天然没有它们，
 * 不能当作"显式关闭"。判定：清单最后保存时间早于类型引入时间 → 视为开启。
 *
 * COLLAB-2：时间规则有个缺口——改自动化偏好、只改免打扰也会刷新 updatedAt，
 * 后加的类型随之被判为关。所以每次写偏好行都把写入前的生效清单写回
 * enabledTypesJson，并在 metadata.knownTypes 记下写入时的注册表；
 * 有 knownTypes 的行按"保存时是否已登记"判定，不再看时间。
 */

import { db } from "@/lib/db";
import { DEFAULT_ENABLED_TYPES } from "./constants";
import { buildPreferenceContext, isInQuietHours, breaksQuietHours } from "./filter";

/** 注册表后加类型的引入时间（ISO）；不在表里的类型无 grandfather 语义 */
export const TYPE_INTRODUCED_AT: Record<string, string> = {
  quote_signed: "2026-08-29T00:00:00Z",
  sales_daily_briefing: "2026-08-29T00:00:00Z",
  // INSTALL-2b：之前保存过偏好清单的用户没见过这两个开关，不算显式关闭
  install_completed: "2026-10-28T00:00:00Z",
  install_balance_confirmed: "2026-10-28T00:00:00Z",
  install_warranty_sent: "2026-10-28T00:00:00Z",
  install_warranty_failed: "2026-10-28T00:00:00Z",
  install_repair_submitted: "2026-10-28T00:00:00Z",
  install_repair_factory_issued: "2026-10-28T00:00:00Z",
  install_repair_scheduled: "2026-10-28T00:00:00Z",
  install_repair_closed: "2026-10-29T00:00:00Z",
  install_repair_overdue: "2026-10-29T00:00:00Z",
  // COLLAB-2：远未来的哨兵时间。上线后的写入都带 knownTypes，不走时间规则；
  // 时间规则只剩给上线前写入的行用，而这些行都没见过这五个开关 → 一律视为开启
  mention: "9999-12-31T00:00:00Z",
  task_assigned: "9999-12-31T00:00:00Z",
  task_status: "9999-12-31T00:00:00Z",
  task_comment: "9999-12-31T00:00:00Z",
  order_stage: "9999-12-31T00:00:00Z",
  // T-1：同 COLLAB-2 的哨兵——上线前保存的清单都没见过这四个开关，一律视为开启
  rfq_quote_received: "9999-12-31T00:00:00Z",
  rfq_reply_received: "9999-12-31T00:00:00Z",
  rfq_chase_ready: "9999-12-31T00:00:00Z",
  rfq_no_response: "9999-12-31T00:00:00Z",
};

const REGISTERED_TYPES = new Set(DEFAULT_ENABLED_TYPES);

/** 偏好行 metadata（JSON 字符串）→ 对象；空、坏 JSON、非对象一律当作 {} */
export function parsePreferenceMetadata(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 写入时记下的注册表；本次上线前写入的行没有这个键 → null */
export function knownTypesFromMetadata(
  meta: Record<string, unknown>,
): Set<string> | null {
  if (!Array.isArray(meta.knownTypes)) return null;
  return new Set(meta.knownTypes.filter((x): x is string => typeof x === "string"));
}

/** 与 buildPreferenceContext 同一读法：空数组、坏 JSON、非数组 → null（全部默认开启） */
function parseCustomTypeList(json: string | null | undefined): string[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

/** 纯函数：类型是否开启（含 grandfather 判定），供测试 */
export function isTypeEnabledForUser(args: {
  type: string;
  enabledTypes: Set<string>;
  hasCustomList: boolean;
  listUpdatedAt: Date | null;
  /** 写入时记下的注册表；null / 缺省 = 本次上线前写入的行，按时间规则 */
  knownTypes?: Set<string> | null;
}): boolean {
  if (!args.hasCustomList) return true; // 从未自定义 → 全部默认开启
  if (args.enabledTypes.has(args.type)) return true;
  if (args.knownTypes) {
    // 保存时已登记却不在清单里 → 用户自己关的；保存之后才登记的 → 没见过，视为开启。
    // 未登记的类型不适用：不在清单 → 关（与之前相同）
    return REGISTERED_TYPES.has(args.type) && !args.knownTypes.has(args.type);
  }
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
  knownTypes?: Set<string> | null;
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
      knownTypes: args.knownTypes,
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
 * 纯函数：生效的类型清单——清单本身，加上按上面规则视为开启的已登记类型。
 * 设置页显示它；每次写偏好行都把它物化回 enabledTypesJson。
 */
export function effectiveEnabledTypes(row: {
  enabledTypesJson: string | null;
  metadata?: string | null;
  updatedAt?: Date | null;
}): string[] {
  const list = parseCustomTypeList(row.enabledTypesJson);
  if (!list) return [...DEFAULT_ENABLED_TYPES];
  const enabledTypes = new Set(list);
  const knownTypes = knownTypesFromMetadata(parsePreferenceMetadata(row.metadata));
  const out = [...enabledTypes];
  for (const type of DEFAULT_ENABLED_TYPES) {
    if (enabledTypes.has(type)) continue;
    if (
      isTypeEnabledForUser({
        type,
        enabledTypes,
        hasCustomList: true,
        listUpdatedAt: row.updatedAt ?? null,
        knownTypes,
      })
    ) {
      out.push(type);
    }
  }
  return out;
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
      knownTypes: knownTypesFromMetadata(parsePreferenceMetadata(row.metadata)),
    });
  } catch {
    return true;
  }
}
