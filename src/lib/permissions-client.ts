/**
 * 前端权限判断 helpers
 * 复用后端 RBAC 角色常量逻辑，避免页面中手写字符串
 */

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "admin";
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export function canManageOrg(orgRole: string | null | undefined): boolean {
  return orgRole === "org_admin";
}

export function canCreateProject(orgRole: string | null | undefined): boolean {
  return orgRole === "org_admin" || orgRole === "org_member";
}

export function canManageProject(projectRole: string | null | undefined): boolean {
  return projectRole === "project_admin";
}

export function canViewAdminPages(platformRole: string | null | undefined): boolean {
  return platformRole === "super_admin" || platformRole === "admin";
}

/**
 * 检查前端模块可见性（与 role-access.ts 同步）
 */
export function canAccessModule(role: string | null | undefined, modulePath: string): boolean {
  if (!role) return false;
  const normalizedRole = role === "super_admin" ? "admin" : role;

  const MODULE_ROLES: Record<string, string[] | undefined> = {
    "/":              undefined,
    "/notifications": undefined,
    "/tasks":         undefined,
    "/sales":           ["admin", "sales"],
    "/sales/knowledge": ["admin", "sales"],
    "/trade":           ["admin", "trade"],
    "/trade/knowledge": ["admin", "trade"],
    "/organizations":   ["admin", "user"],
    "/projects":        ["admin", "user"],
    "/suppliers":       ["admin", "user"],
    "/assistant":       undefined,
    "/ai-activity":     undefined,
    "/reports":         ["admin", "user"],
    "/admin":           ["admin"],
  };

  const roles = MODULE_ROLES[modulePath];
  if (!roles) return true;
  return roles.includes(normalizedRole);
}

const ORG_ROLE_LABELS: Record<string, string> = {
  org_admin: "管理员",
  org_member: "成员",
  org_viewer: "观察者",
};

const PROJECT_ROLE_LABELS: Record<string, string> = {
  project_admin: "项目管理员",
  operator: "操作员",
  tester: "测试员",
  viewer: "观察者",
};

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  sales: "销售",
  trade: "外贸助手",
  user: "普通用户",
  super_admin: "管理员",
};

export function orgRoleLabel(role: string): string {
  return ORG_ROLE_LABELS[role] ?? role;
}

export function projectRoleLabel(role: string): string {
  return PROJECT_ROLE_LABELS[role] ?? role;
}

export function platformRoleLabel(role: string): string {
  return PLATFORM_ROLE_LABELS[role] ?? role;
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  active: { label: "正常", className: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" },
  inactive: { label: "已停用", className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
  suspended: { label: "已封禁", className: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" },
  archived: { label: "已归档", className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
};

export function statusInfo(status: string) {
  return STATUS_MAP[status] ?? { label: status, className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" };
}
