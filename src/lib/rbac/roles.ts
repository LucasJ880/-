// ============================================================
// RBAC 角色定义与权限检查工具
// ============================================================

// --- 平台级角色 ---

export const PLATFORM_ROLES = ["admin", "manager", "sales", "trade", "user"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  manager: "总经理",
  sales: "销售",
  trade: "外贸助手",
  user: "普通用户",
  super_admin: "管理员（旧）",
};

// --- 组织级角色 ---

export const ORG_ROLES = [
  "org_owner",
  "org_admin",
  "org_member",
  "org_viewer",
] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ORG_ROLE_LEVEL: Record<OrgRole, number> = {
  org_owner: 40,
  org_admin: 30,
  org_member: 20,
  org_viewer: 10,
};

// --- 项目级角色 ---

export const PROJECT_ROLES = [
  "project_admin",
  "operator",
  "tester",
  "viewer",
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

const PROJECT_ROLE_LEVEL: Record<ProjectRole, number> = {
  project_admin: 40,
  operator: 30,
  tester: 20,
  viewer: 10,
};

// --- 状态枚举 ---

export const ENTITY_STATUS = ["active", "inactive", "suspended"] as const;
export type EntityStatus = (typeof ENTITY_STATUS)[number];

export const MEMBER_STATUS = ["active", "inactive"] as const;
export type MemberStatus = (typeof MEMBER_STATUS)[number];

export const ORG_PLAN_TYPES = ["free", "pro", "enterprise"] as const;
export type OrgPlanType = (typeof ORG_PLAN_TYPES)[number];

// --- 权限检查工具 ---

export function isSuperAdmin(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

export function isAdmin(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * 平台超级管理员（唯一可跨组织读取数据的角色）。
 *
 * 与 isAdmin / isSuperAdmin 的区别：
 * - isAdmin / isSuperAdmin：把平台 `admin` 也视为最高权限（用于功能开关、守卫），
 *   `admin` 在「当前组织内」拥有全部能力。
 * - isPlatformSuperAdmin：仅 `super_admin` 为 true。用于数据范围判定时区分
 *   「组织内全部」(admin) 与「跨组织全部」(super_admin)，防止普通组织 admin
 *   看到其它组织的数据。
 */
export function isPlatformSuperAdmin(role: string | null | undefined): boolean {
  return role === "super_admin";
}

/**
 * 平台用户管理（/api/users、全局软删）。
 * Security-1：仅平台 admin / super_admin；manager 不再拥有跨组织用户列表权限。
 * 企业内成员管理走 /organizations/[orgId]/members。
 */
export function canManageUsers(role: string | null | undefined): boolean {
  return isAdmin(role ?? "");
}

/**
 * 全局账号软删除：仅平台管理员。
 * 企业侧移除员工只能 inactive OrganizationMember，不能删全局 User。
 */
export function canDeleteUsers(role: string | null | undefined): boolean {
  return canManageUsers(role);
}

/** 企业系统管理角色（成员/配置）：owner 或 admin */
export function isOrgSystemAdmin(orgRole: string | null | undefined): boolean {
  return orgRole === "org_owner" || orgRole === "org_admin";
}

export function hasOrgRole(userRole: string, requiredRole: OrgRole): boolean {
  const userLevel = ORG_ROLE_LEVEL[userRole as OrgRole];
  const requiredLevel = ORG_ROLE_LEVEL[requiredRole];
  if (userLevel === undefined || requiredLevel === undefined) return false;
  return userLevel >= requiredLevel;
}

export function hasProjectRole(
  userRole: string,
  requiredRole: ProjectRole
): boolean {
  const userLevel = PROJECT_ROLE_LEVEL[userRole as ProjectRole];
  const requiredLevel = PROJECT_ROLE_LEVEL[requiredRole];
  if (userLevel === undefined || requiredLevel === undefined) return false;
  return userLevel >= requiredLevel;
}

/**
 * 检查用户是否有权访问某个组织
 * super_admin 始终有权限，否则检查 org membership
 */
export function canAccessOrg(
  platformRole: string,
  orgMemberRole: string | null
): boolean {
  if (isSuperAdmin(platformRole)) return true;
  return orgMemberRole !== null;
}

/**
 * 检查用户是否有权访问某个项目
 * super_admin / org_admin 始终有权限，否则检查 project membership
 */
export function canAccessProject(
  platformRole: string,
  orgMemberRole: string | null,
  projectMemberRole: string | null
): boolean {
  if (isSuperAdmin(platformRole)) return true;
  if (orgMemberRole && hasOrgRole(orgMemberRole, "org_admin")) return true;
  return projectMemberRole !== null;
}
