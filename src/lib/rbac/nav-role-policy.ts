/**
 * 侧栏 / 导航可见性 — 平台角色策略（MVP）
 *
 * 层级（高 → 低）：
 *   super_admin / admin（平台）
 *   → boss（老板，企业最高业务权限）
 *   → manager（总经理，兼容旧账号，导航视同 boss）
 *   → operations（运营）/ sales（销售）/ trade（外贸）/ user
 *
 * 销售、运营：不看「企业经营」「AI 能力」
 * 销售额外：不看「品牌增长」、企业知识、微信集成；聚焦业务完成
 * 运营：保留「业务运营」与「品牌增长」
 */

import type { NavigationGroup } from "@/lib/navigation/types";
import { isSuperAdmin } from "@/lib/rbac/roles";

/** 企业高管：老板 / 总经理（兼容） */
export function isExecutiveRole(role: string | null | undefined): boolean {
  return role === "boss" || role === "manager";
}

export function isOperationsStaff(role: string | null | undefined): boolean {
  return role === "operations";
}

export function isSalesStaff(role: string | null | undefined): boolean {
  return role === "sales";
}

/** 平台或企业高管 — 默认可见经营中心 / AI 能力等 */
export function isNavFullCompanyRole(role: string | null | undefined): boolean {
  return isSuperAdmin(role) || isExecutiveRole(role);
}

/**
 * 整组隐藏（在存在 requiredPlatformRoles 之前先按角色挡掉）
 */
export function isNavGroupHiddenForRole(
  group: NavigationGroup,
  role: string | null | undefined,
): boolean {
  if (!role) return false;
  // 销售 / 运营 / 外贸：不看企业经营、AI 能力
  if (group === "OPERATIONS" || group === "CAPABILITIES") {
    return (
      isSalesStaff(role) ||
      isOperationsStaff(role) ||
      role === "trade"
    );
  }
  // 销售：不看品牌增长
  if (group === "GROWTH") {
    return isSalesStaff(role);
  }
  return false;
}

/** 单条目隐藏（企业管理内细分） */
export function isNavItemHiddenForRole(
  itemKey: string,
  role: string | null | undefined,
): boolean {
  if (!role) return false;
  if (isSalesStaff(role)) {
    return itemKey === "mgmt-knowledge" || itemKey === "mgmt-wechat";
  }
  return false;
}

/** 业务入口常用角色列表（含老板） */
export const NAV_ROLES_EXEC = [
  "admin",
  "super_admin",
  "boss",
  "manager",
] as const;

export const NAV_ROLES_SALES = [...NAV_ROLES_EXEC, "sales"] as const;

export const NAV_ROLES_OPERATIONS = [
  ...NAV_ROLES_EXEC,
  "operations",
] as const;

export const NAV_ROLES_TRADE = [...NAV_ROLES_EXEC, "trade"] as const;

export const NAV_ROLES_PROJECTS = [
  ...NAV_ROLES_EXEC,
  "operations",
  "user",
] as const;
