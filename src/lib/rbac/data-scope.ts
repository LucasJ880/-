// ============================================================
// data-scope helper — 把"角色 + userId"翻译成 Prisma where 片段
// ============================================================
//
// 约定：
// - admin / super_admin：dataScope = "all"，返回 null（调用方不加过滤）
// - 其他角色：dataScope = "own"，按资源类型返回对应的 where 片段
//
// 为什么返回 null 而不是 {}：
// - 显式区分"不加条件"（admin）与"没有条件"（空对象容易和别的 where 合并出歧义）
// - 调用方用 `if (clause) where = { ...where, ...clause }` 一眼可读
// ============================================================

import { getCapabilities, type DataScope } from "./capabilities";

export function getDataScope(role: string | null | undefined): DataScope {
  return getCapabilities(role).dataScope;
}

export function isGlobalScope(role: string | null | undefined): boolean {
  return getDataScope(role) === "all";
}

/**
 * 适用于 "被分配 + 创建者" 双 key 资源（SalesOpportunity / SalesAppointment）
 * admin 返回 null（不过滤），其他角色返回 OR 条件
 */
export function salesAssignableScope(
  userId: string,
  role: string | null | undefined,
): Record<string, unknown> | null {
  if (isGlobalScope(role)) return null;
  return {
    OR: [{ assignedToId: userId }, { createdById: userId }],
  };
}

/**
 * 适用于 "仅有创建者" 资源（SalesCustomer / SalesQuote 等）
 */
export function salesCreatedScope(
  userId: string,
  role: string | null | undefined,
): Record<string, unknown> | null {
  if (isGlobalScope(role)) return null;
  return { createdById: userId };
}

/**
 * 断言当前角色对某条资源拥有可见权限。
 * 用于 findUnique 后的二次校验（避免"查任意 id 都能命中"）
 */
export function canSeeResource(
  role: string | null | undefined,
  userId: string,
  resource: { createdById?: string | null; assignedToId?: string | null },
): boolean {
  if (isGlobalScope(role)) return true;
  if (resource.createdById === userId) return true;
  if (resource.assignedToId === userId) return true;
  return false;
}
