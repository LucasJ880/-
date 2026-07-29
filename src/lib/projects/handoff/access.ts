/**
 * 中标交接权限
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
import { canManageDeliveryProjects } from "@/lib/operations/projects/access";

export const HANDOFF_PERMISSIONS = {
  PREVIEW: "bids.handoff.preview",
  EXECUTE: "bids.handoff.execute",
  OVERRIDE: "bids.handoff.override",
  OPS_CREATE: "operations.projects.create",
} as const;

export type HandoffAccessContext = WorkspacePolicyContext & {
  userId: string;
};

function hasKey(ctx: HandoffAccessContext, key: string): boolean {
  return Boolean(ctx.permissionKeys?.includes(key));
}

function isManager(ctx: HandoffAccessContext): boolean {
  if (isManagementWorkspaceUser(ctx)) return true;
  if (isSuperAdmin(ctx.platformRole)) return true;
  if (canManageUsers(ctx.platformRole)) return true;
  if (isOrgSystemAdmin(ctx.orgRole)) return true;
  return false;
}

export function canPreviewHandoff(
  ctx: HandoffAccessContext,
  opts: { canReadTender: boolean },
): boolean {
  if (!opts.canReadTender) return false;
  if (isManager(ctx)) return true;
  if (hasKey(ctx, HANDOFF_PERMISSIONS.PREVIEW)) return true;
  if (hasKey(ctx, HANDOFF_PERMISSIONS.EXECUTE)) return true;
  if (hasKey(ctx, "project.update")) return true;
  return false;
}

export function canExecuteHandoff(
  ctx: HandoffAccessContext,
  opts: { canManageTender: boolean },
): boolean {
  if (!opts.canManageTender && !isManager(ctx)) {
    // 显式 execute capability 也可
    if (!hasKey(ctx, HANDOFF_PERMISSIONS.EXECUTE)) return false;
  }
  if (isManager(ctx)) return true;
  if (hasKey(ctx, HANDOFF_PERMISSIONS.EXECUTE)) return true;
  // 可管理投标 + 可创建执行项目
  if (
    opts.canManageTender &&
    (hasKey(ctx, HANDOFF_PERMISSIONS.OPS_CREATE) ||
      hasKey(ctx, "project.create") ||
      canManageDeliveryProjects(ctx))
  ) {
    return true;
  }
  return false;
}

export function canOverrideHandoff(ctx: HandoffAccessContext): boolean {
  if (isManager(ctx)) return true;
  if (hasKey(ctx, HANDOFF_PERMISSIONS.OVERRIDE)) return true;
  return false;
}

/** 普通 operations / 裸 user 不得仅凭角色交接 */
export function isBareOpsOrUser(ctx: HandoffAccessContext): boolean {
  const role = ctx.platformRole ?? "";
  if (isManager(ctx)) return false;
  if (hasKey(ctx, HANDOFF_PERMISSIONS.EXECUTE)) return false;
  return role === "operations" || role === "user" || role === "sales";
}
