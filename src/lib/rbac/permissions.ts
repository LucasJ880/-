import type { OrgRole, ProjectRole } from "./roles";

// ============================================================
// 细粒度权限定义
//
// 设计原则：
//   - 权限 = resource:action 格式
//   - 每个角色映射到一组权限
//   - 通过 hasPermission 检查用户是否有某个权限
//   - 后续可扩展为数据库动态权限
// ============================================================

export const PERMISSIONS = {
  // 组织管理
  ORG_READ: "org:read",
  ORG_UPDATE: "org:update",
  ORG_DELETE: "org:delete",
  ORG_MEMBER_LIST: "org:member:list",
  ORG_MEMBER_INVITE: "org:member:invite",
  ORG_MEMBER_REMOVE: "org:member:remove",
  ORG_MEMBER_ROLE_CHANGE: "org:member:role_change",
  ORG_BILLING: "org:billing",

  // 项目管理
  PROJECT_CREATE: "project:create",
  PROJECT_READ: "project:read",
  PROJECT_UPDATE: "project:update",
  PROJECT_DELETE: "project:delete",
  PROJECT_MEMBER_LIST: "project:member:list",
  PROJECT_MEMBER_INVITE: "project:member:invite",
  PROJECT_MEMBER_REMOVE: "project:member:remove",
  PROJECT_MEMBER_ROLE_CHANGE: "project:member:role_change",

  // 环境管理
  ENV_CREATE: "env:create",
  ENV_READ: "env:read",
  ENV_UPDATE: "env:update",
  ENV_ARCHIVE: "env:archive",

  // Prompt 管理
  PROMPT_CREATE: "prompt:create",
  PROMPT_READ: "prompt:read",
  PROMPT_UPDATE: "prompt:update",
  PROMPT_DELETE: "prompt:delete",
  PROMPT_PUBLISH: "prompt:publish",

  // 知识库管理
  KB_CREATE: "kb:create",
  KB_READ: "kb:read",
  KB_UPDATE: "kb:update",
  KB_DELETE: "kb:delete",
  KB_PUBLISH: "kb:publish",

  // 审计日志
  AUDIT_LOG_READ: "audit_log:read",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// --- 组织角色 → 权限映射 ---

const ORG_ADMIN_PERMISSIONS: Permission[] = [
  PERMISSIONS.ORG_READ,
  PERMISSIONS.ORG_UPDATE,
  PERMISSIONS.ORG_DELETE,
  PERMISSIONS.ORG_MEMBER_LIST,
  PERMISSIONS.ORG_MEMBER_INVITE,
  PERMISSIONS.ORG_MEMBER_REMOVE,
  PERMISSIONS.ORG_MEMBER_ROLE_CHANGE,
  PERMISSIONS.ORG_BILLING,
  PERMISSIONS.PROJECT_CREATE,
  PERMISSIONS.AUDIT_LOG_READ,
];

const ORG_MEMBER_PERMISSIONS: Permission[] = [
  PERMISSIONS.ORG_READ,
  PERMISSIONS.ORG_MEMBER_LIST,
  PERMISSIONS.PROJECT_CREATE,
];

const ORG_VIEWER_PERMISSIONS: Permission[] = [
  PERMISSIONS.ORG_READ,
  PERMISSIONS.ORG_MEMBER_LIST,
];

const ORG_ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  org_admin: ORG_ADMIN_PERMISSIONS,
  org_member: ORG_MEMBER_PERMISSIONS,
  org_viewer: ORG_VIEWER_PERMISSIONS,
};

// --- 项目角色 → 权限映射 ---

const PROJECT_ADMIN_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_UPDATE,
  PERMISSIONS.PROJECT_DELETE,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.PROJECT_MEMBER_INVITE,
  PERMISSIONS.PROJECT_MEMBER_REMOVE,
  PERMISSIONS.PROJECT_MEMBER_ROLE_CHANGE,
  PERMISSIONS.ENV_CREATE,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.ENV_UPDATE,
  PERMISSIONS.ENV_ARCHIVE,
  PERMISSIONS.PROMPT_CREATE,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.PROMPT_UPDATE,
  PERMISSIONS.PROMPT_DELETE,
  PERMISSIONS.PROMPT_PUBLISH,
  PERMISSIONS.KB_CREATE,
  PERMISSIONS.KB_READ,
  PERMISSIONS.KB_UPDATE,
  PERMISSIONS.KB_DELETE,
  PERMISSIONS.KB_PUBLISH,
];

const OPERATOR_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.PROMPT_CREATE,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.PROMPT_UPDATE,
  PERMISSIONS.PROMPT_PUBLISH,
  PERMISSIONS.KB_CREATE,
  PERMISSIONS.KB_READ,
  PERMISSIONS.KB_UPDATE,
  PERMISSIONS.KB_PUBLISH,
];

const TESTER_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.PROMPT_UPDATE,
  PERMISSIONS.KB_READ,
  PERMISSIONS.KB_UPDATE,
];

const VIEWER_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.KB_READ,
];

const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  project_admin: PROJECT_ADMIN_PERMISSIONS,
  operator: OPERATOR_PERMISSIONS,
  tester: TESTER_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

// --- 权限检查 ---

/** 检查组织角色是否拥有某个权限 */
export function hasOrgPermission(role: string, permission: Permission): boolean {
  const perms = ORG_ROLE_PERMISSIONS[role as OrgRole];
  if (!perms) return false;
  return perms.includes(permission);
}

/** 检查项目角色是否拥有某个权限 */
export function hasProjectPermission(role: string, permission: Permission): boolean {
  const perms = PROJECT_ROLE_PERMISSIONS[role as ProjectRole];
  if (!perms) return false;
  return perms.includes(permission);
}

/** 获取组织角色的所有权限 */
export function getOrgRolePermissions(role: string): Permission[] {
  return ORG_ROLE_PERMISSIONS[role as OrgRole] ?? [];
}

/** 获取项目角色的所有权限 */
export function getProjectRolePermissions(role: string): Permission[] {
  return PROJECT_ROLE_PERMISSIONS[role as ProjectRole] ?? [];
}
