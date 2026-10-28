/**
 * PERM-4c4：岗位派生平台角色（AI / 智能体一侧专用，不写库）
 *
 * 岗位模式企业（行业包有岗位模板）里，AI 一侧凡按平台角色判定的地方改用本函数的结果：
 * 按有效权限键映射回今天的平台角色词汇，下游（工具策略表、能力矩阵、提示词、晨报、Muse、开关白名单）不改，
 * 平台角色压扁（4c3）前后行为一致。旧模式企业（梦馨）与 super_admin / admin / trade 原样。
 */

import { loadPermissionKeys, loadPositionMode } from "@/lib/rbac/permission-keys";

/** 平台管理口径与外贸（PERM-6）不派生 */
const RESERVED_PLATFORM_ROLES = ["super_admin", "admin", "trade"] as const;

const MANAGEMENT_KEYS = ["organization.dashboard.read"] as const;
const SALES_WORK_KEYS = ["sales.quote.create", "sales.quote.pricing_close"] as const;
const OPERATIONS_KEYS = ["operations.read", "operations.manage"] as const;
/** PERM-6a：外贸业务员（岗位模式企业的 trade_rep） */
const TRADE_KEYS = ["trade.read"] as const;

function hasAny(keys: readonly string[] | null | undefined, wanted: readonly string[]): boolean {
  return Boolean(keys?.length) && wanted.some((k) => keys!.includes(k));
}

/** 纯函数：派生规则（D1 / D2）——多岗取最高一项：管理层 > 销售 > 运营 > 外贸（PERM-6a）> user */
export function deriveEffectivePlatformRole(input: {
  platformRole: string | null | undefined;
  positionMode: boolean;
  permissionKeys: readonly string[] | null | undefined;
}): string {
  const role = input.platformRole ?? "user";
  if (!input.positionMode) return role;
  if ((RESERVED_PLATFORM_ROLES as readonly string[]).includes(role)) return role;
  if (hasAny(input.permissionKeys, MANAGEMENT_KEYS)) return "boss";
  if (hasAny(input.permissionKeys, SALES_WORK_KEYS)) return "sales";
  if (hasAny(input.permissionKeys, OPERATIONS_KEYS)) return "operations";
  if (hasAny(input.permissionKeys, TRADE_KEYS)) return "trade";
  return "user";
}

/** 是否需要按岗位派生（旧模式 / 保留角色不查权限键） */
export function isReservedPlatformRole(role: string | null | undefined): boolean {
  return (RESERVED_PLATFORM_ROLES as readonly string[]).includes(role ?? "");
}

/**
 * 异步：先判岗位模式；旧模式或保留角色直接返回原角色，否则读有效权限键派生。
 * orgId 为空时视为旧模式（原角色）。权限键解析失败按无键处理（派生为 user）。
 */
export async function resolveEffectivePlatformRole(input: {
  userId: string;
  orgId: string | null | undefined;
  platformRole: string | null | undefined;
}): Promise<string> {
  const role = input.platformRole ?? "user";
  if (!input.orgId || isReservedPlatformRole(role)) return role;
  const positionMode = await loadPositionMode(input.orgId);
  if (!positionMode) return role;
  const permissionKeys = await loadPermissionKeys(input.userId, input.orgId);
  return deriveEffectivePlatformRole({ platformRole: role, positionMode, permissionKeys });
}
