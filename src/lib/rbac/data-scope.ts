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
import { isPlatformSuperAdmin } from "./roles";

export function getDataScope(role: string | null | undefined): DataScope {
  return getCapabilities(role).dataScope;
}

export function isGlobalScope(role: string | null | undefined): boolean {
  return getDataScope(role) === "all";
}

/**
 * 组织边界子句（P0-1）。
 *
 * A2-3 收紧：Sales 四表 missingOrgId=0 且关系一致性核查通过后，移除历史 orgId:null 容忍，
 * 改为严格 { orgId }。orgId 为空的行不再可见（生产库已无此类行）。
 */
function orgBoundaryClause(orgId: string): Record<string, unknown> {
  return { orgId };
}

/**
 * 适用于 "被分配 + 创建者" 双 key 资源（SalesOpportunity / SalesAppointment）
 *
 * - super_admin：返回 null（跨组织，不过滤）
 * - admin / org_admin（dataScope=all）：仅按 orgId 限定本组织全部
 * - 普通成员（dataScope=own）：本人（被分配 / 创建）+ orgId 限定
 */
export function salesAssignableScope(
  userId: string,
  role: string | null | undefined,
  orgId: string,
): Record<string, unknown> | null {
  if (isPlatformSuperAdmin(role)) return null;
  if (isGlobalScope(role)) {
    return { AND: [orgBoundaryClause(orgId)] };
  }
  return {
    AND: [
      { OR: [{ assignedToId: userId }, { createdById: userId }] },
      orgBoundaryClause(orgId),
    ],
  };
}

/**
 * 适用于 "仅有创建者" 资源（SalesCustomer / SalesQuote 等）
 *
 * - super_admin：返回 null（跨组织，不过滤）
 * - admin / org_admin：仅按 orgId 限定本组织全部
 * - 普通成员：本人创建 + orgId 限定
 */
export function salesCreatedScope(
  userId: string,
  role: string | null | undefined,
  orgId: string,
): Record<string, unknown> | null {
  if (isPlatformSuperAdmin(role)) return null;
  if (isGlobalScope(role)) {
    return { AND: [orgBoundaryClause(orgId)] };
  }
  return {
    AND: [{ createdById: userId }, orgBoundaryClause(orgId)],
  };
}

/**
 * 断言当前角色对某条资源拥有可见权限。
 * 用于 findUnique 后的二次校验（避免"查任意 id 都能命中"）
 *
 * @param orgId 可选。传入时启用跨组织硬隔离：资源 orgId 必须严格等于当前 orgId
 *   （A2-3 起 orgId:null 不再容忍，资源 orgId 为空一律拒绝）。
 *   未传 orgId 时维持旧行为（向后兼容 pending-actions executor 等暂未透传 orgId 的调用方）。
 */
export function canSeeResource(
  role: string | null | undefined,
  userId: string,
  resource: {
    orgId?: string | null;
    createdById?: string | null;
    assignedToId?: string | null;
  },
  orgId?: string,
): boolean {
  if (isPlatformSuperAdmin(role)) return true;
  // 跨组织硬隔离：传入 orgId 时，资源 orgId 必须严格相等（null 不再容忍）
  if (orgId && resource.orgId !== orgId) return false;
  if (isGlobalScope(role)) return true;
  if (resource.createdById === userId) return true;
  if (resource.assignedToId === userId) return true;
  return false;
}
