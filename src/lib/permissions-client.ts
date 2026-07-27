/**
 * 前端权限判断 helpers
 *
 * SYNC: isSuperAdmin / isAdmin 逻辑必须与 src/lib/rbac/roles.ts 保持一致。
 * 参数类型放宽为 string | null | undefined 以适配客户端未加载状态。
 */

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * 平台管理员（调试面）。与 isSuperAdmin 同义。
 * SYNC: src/lib/rbac/platform-admin.ts
 * 注意：org_owner / org_admin / 企业负责人 ≠ 平台管理员
 */
export function isPlatformAdmin(role: string | null | undefined): boolean {
  return isSuperAdmin(role);
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
 * 用户账号管理（用户管理页 / 删除账号）— 平台 admin + 老板 boss。
 * SYNC: 与 src/lib/rbac/roles.ts canManageUsers 保持一致。
 */
export function canManageUsers(platformRole: string | null | undefined): boolean {
  return isAdmin(platformRole) || platformRole === "boss";
}

/**
 * 检查前端模块可见性
 * SYNC: MODULE_ROLES 映射与 src/lib/rbac/role-access.ts MODULE_VISIBILITY 同源。
 */
export function canAccessModule(role: string | null | undefined, modulePath: string): boolean {
  if (!role) return false;
  const normalizedRole = role === "super_admin" ? "admin" : role;

  const MODULE_ROLES: Record<string, string[] | undefined> = {
    "/":              undefined,
    "/notifications": undefined,
    "/tasks":         undefined,
    "/sales":           ["admin", "boss", "manager", "sales"],
    "/sales/quote-sheet": ["admin", "boss", "manager", "sales"],
    "/sales/quotes":    ["admin", "boss", "manager", "sales"],
    "/sales/calendar":  ["admin", "boss", "manager", "sales"],
    "/sales/measure":   ["admin", "boss", "manager", "sales"],
    "/settings/email":  ["admin", "boss", "manager", "sales"],
    "/inventory":       ["admin", "boss", "manager", "operations"],
    "/sales/cockpit":   ["admin", "boss", "manager", "sales"],
    "/sales/knowledge": ["admin", "boss", "manager", "sales"],
    "/blinds-orders":   ["admin", "boss", "manager", "sales", "operations"],
    "/trade":           ["admin", "boss", "manager", "trade"],
    "/trade/knowledge": ["admin", "boss", "manager", "trade"],
    "/organizations":   ["admin", "boss", "manager", "operations", "user"],
    "/projects":        ["admin", "boss", "manager", "operations", "user"],
    "/suppliers":       ["admin", "boss", "manager", "operations", "user"],
    "/assistant":       undefined,
    "/wechat":          ["admin", "boss", "manager", "operations", "trade", "user"],
    "/agent-trace":     undefined,
    "/ai-activity":     undefined,
    "/reports":         ["admin", "boss", "manager", "operations", "user"],
    "/settings/wechat": ["admin", "boss", "manager", "operations"],
    "/admin":           ["admin", "boss"],
  };

  const roles = MODULE_ROLES[modulePath];
  if (!roles) return true;
  return roles.includes(normalizedRole);
}

const ORG_ROLE_LABELS: Record<string, string> = {
  org_owner: "企业负责人",
  org_admin: "企业管理员",
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
  admin: "平台管理员",
  boss: "老板",
  manager: "总经理",
  operations: "运营",
  sales: "销售",
  trade: "外贸助手",
  user: "普通用户",
  super_admin: "超级管理员",
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
  deleted: { label: "已删除", className: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" },
};

export function statusInfo(status: string) {
  return STATUS_MAP[status] ?? { label: status, className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" };
}
