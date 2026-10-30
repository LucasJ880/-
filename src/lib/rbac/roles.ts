// ============================================================
// RBAC 角色定义与权限检查工具
// ============================================================

// --- 平台级角色 ---

export const PLATFORM_ROLES = [
  "admin",
  "boss",
  "manager",
  "operations",
  "sales",
  "trade",
  "user",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<string, string> = {
  admin: "平台管理员",
  boss: "老板",
  manager: "总经理",
  operations: "运营",
  sales: "销售",
  trade: "外贸助手",
  user: "普通用户",
  super_admin: "超级管理员",
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
  // T2-P1.5：财务审核角色。刻意置于低 level（review 能力经细粒度 project:cost:review 授予，
  // 不经 hasProjectRole 单调阶梯，避免误授无关管理权）。
  "accounting",
  "tester",
  "viewer",
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

const PROJECT_ROLE_LEVEL: Record<ProjectRole, number> = {
  project_admin: 40,
  operator: 30,
  tester: 20,
  accounting: 15,
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

/**
 * 平台管理员（PERM-7b：只认 super_admin；平台 `admin` 不带任何平台特权，等同 user，能力全看岗位）。
 * isSuperAdmin / isAdmin / isPlatformSuperAdmin 同义，保留旧名以免改动全部调用方。
 */
export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "super_admin";
}

/** PERM-7b：同 isSuperAdmin */
export function isAdmin(role: string | null | undefined): boolean {
  return isSuperAdmin(role);
}

/** 平台超级管理员（唯一可跨组织读取数据的角色）。PERM-7b 起与 isSuperAdmin 同义。 */
export function isPlatformSuperAdmin(role: string | null | undefined): boolean {
  return isSuperAdmin(role);
}

/**
 * PERM-7b：按平台角色名单比对时（旧模式导航等），退役的平台 `admin` 视同 `user`；其余原样（super_admin 不变）。
 */
export function normalizeRetiredPlatformRole(role: string | null | undefined): string | null | undefined {
  return role === "admin" ? "user" : role;
}

/**
 * PERM-7b：平台角色归一到工具策略 / 模块映射使用的档位词汇。
 * super_admin → "admin"（平台管理员档）；平台 `admin` → "user"（不再进入平台管理员档）；其余原样。
 * SYNC: src/lib/permissions-client.ts platformTier
 */
export function platformTier(role: string | null | undefined): string {
  if (role === "super_admin") return "admin";
  if (role === "admin") return "user";
  return role ?? "user";
}

/** 老板：super_admin 之下的企业最高业务权限 */
export function isBoss(role: string | null | undefined): boolean {
  return role === "boss";
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
