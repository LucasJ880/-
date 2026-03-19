// ============================================================
// RBAC 角色定义与权限检查工具
// ============================================================

// --- 平台级角色 ---

export const PLATFORM_ROLES = ["super_admin", "user"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// --- 组织级角色 ---

export const ORG_ROLES = [
  "org_admin",
  "org_member",
  "org_viewer",
] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ORG_ROLE_LEVEL: Record<OrgRole, number> = {
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
  return role === "super_admin";
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
