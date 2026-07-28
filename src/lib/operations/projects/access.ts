/**
 * 运营执行项目 / 团队任务 集中权限
 * 不新增持久化 ops_manager 角色；复用管理层 + capability 键。
 */

import {
  canManageUsers,
  isOrgSystemAdmin,
  isSuperAdmin,
} from "@/lib/rbac/roles";
import {
  isManagementWorkspaceUser,
  type WorkspacePolicyContext,
} from "@/lib/rbac/workspace-policy";

/** 与 Permission Registry 对齐的运营团队能力键 */
export const OPS_TEAM_PERMISSIONS = {
  TASKS_TEAM_READ: "operations.tasks.team.read",
  TASKS_TEAM_MANAGE: "operations.tasks.team.manage",
  PROJECTS_TEAM_READ: "operations.projects.team.read",
  PROJECTS_MANAGE: "operations.projects.manage",
} as const;

export type OpsAccessContext = WorkspacePolicyContext & {
  userId?: string;
};

function hasPermission(
  ctx: OpsAccessContext,
  key: string,
): boolean {
  const keys = ctx.permissionKeys;
  if (!keys?.length) return false;
  return keys.includes(key);
}

function isPlatformOrOrgManager(ctx: OpsAccessContext): boolean {
  if (isManagementWorkspaceUser(ctx)) return true;
  if (isSuperAdmin(ctx.platformRole)) return true;
  if (canManageUsers(ctx.platformRole)) return true;
  if (isOrgSystemAdmin(ctx.orgRole)) return true;
  return false;
}

/** 查看团队任务（非普通 operations 自动放行） */
export function canViewTeamTasks(ctx: OpsAccessContext): boolean {
  if (isPlatformOrOrgManager(ctx)) return true;
  if (hasPermission(ctx, OPS_TEAM_PERMISSIONS.TASKS_TEAM_READ)) return true;
  if (hasPermission(ctx, OPS_TEAM_PERMISSIONS.TASKS_TEAM_MANAGE)) return true;
  if (hasPermission(ctx, "operations.manage")) return true;
  return false;
}

export function canManageTeamTasks(ctx: OpsAccessContext): boolean {
  if (isPlatformOrOrgManager(ctx)) return true;
  if (hasPermission(ctx, OPS_TEAM_PERMISSIONS.TASKS_TEAM_MANAGE)) return true;
  if (hasPermission(ctx, "operations.manage")) return true;
  return false;
}

/** 查看组织内全部执行项目 */
export function canViewAllDeliveryProjects(ctx: OpsAccessContext): boolean {
  if (isPlatformOrOrgManager(ctx)) return true;
  if (hasPermission(ctx, OPS_TEAM_PERMISSIONS.PROJECTS_TEAM_READ)) return true;
  if (hasPermission(ctx, OPS_TEAM_PERMISSIONS.PROJECTS_MANAGE)) return true;
  if (hasPermission(ctx, "operations.manage")) return true;
  return false;
}

export function canManageDeliveryProjects(ctx: OpsAccessContext): boolean {
  if (isPlatformOrOrgManager(ctx)) return true;
  if (hasPermission(ctx, OPS_TEAM_PERMISSIONS.PROJECTS_MANAGE)) return true;
  if (hasPermission(ctx, "operations.manage")) return true;
  return false;
}

/** 从 completed 恢复阶段 */
export function canReopenCompletedDelivery(ctx: OpsAccessContext): boolean {
  return canManageDeliveryProjects(ctx);
}

/** 取消 / 暂停执行项目 */
export function canCancelOrHoldDelivery(ctx: OpsAccessContext): boolean {
  return canManageDeliveryProjects(ctx);
}

/** 普通用户可编辑自己负责的基础信息 */
export function canEditOwnedDeliveryProject(
  ctx: OpsAccessContext,
  project: { ownerId: string; memberUserIds?: readonly string[] },
): boolean {
  if (canManageDeliveryProjects(ctx)) return true;
  if (ctx.userId && project.ownerId === ctx.userId) return true;
  if (ctx.userId && project.memberUserIds?.includes(ctx.userId)) return true;
  return false;
}

export function canViewDeliveryProject(
  ctx: OpsAccessContext,
  project: { ownerId: string; memberUserIds?: readonly string[] },
): boolean {
  if (canViewAllDeliveryProjects(ctx)) return true;
  if (ctx.userId && project.ownerId === ctx.userId) return true;
  if (ctx.userId && project.memberUserIds?.includes(ctx.userId)) return true;
  return false;
}
