/**
 * 前端权限判断 helpers
 * 复用后端 RBAC 角色常量逻辑，避免页面中手写字符串
 */

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "super_admin";
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
  return platformRole === "super_admin";
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
  super_admin: "超级管理员",
  user: "普通用户",
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
