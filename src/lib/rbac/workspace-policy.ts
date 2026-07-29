/**
 * Phase 1 工作区访问策略（零 DB 迁移 / 无持久化 bidder 角色）
 *
 * 综合 platformRole、organizationRole、modules、capabilities / permissionKeys
 * 判断管理总览、运营中心、招投标中心、销售中心的可见性与默认入口。
 *
 * 不单独用 operations 推断招投标权限；不单独用裸 user 放行招投标。
 */

import { isSuperAdmin } from "@/lib/rbac/roles";
import {
  isExecutiveRole,
  isOperationsStaff,
  isSalesStaff,
} from "@/lib/rbac/nav-role-policy";

export type WorkspacePolicyContext = {
  platformRole: string | null | undefined;
  orgRole?: string | null | undefined;
  /** Organization.modulesJson.enabled */
  enabledModules?: readonly string[] | null;
  /**
   * 可选：已解析的权限键（如 project.read / operations.read）。
   * Phase 1 客户端常为空，服务端可按需注入。
   */
  permissionKeys?: readonly string[] | null;
  /**
   * 可选：投标相关能力信号（项目成员 / tender / evidence 等）。
   * 有则加强招投标工作区放行，无则不单独据此拒绝管理层。
   */
  hasBidCapability?: boolean;
  hasMembership?: boolean;
};

export type WorkspaceId =
  | "management"
  | "operations"
  | "bids"
  | "sales"
  | "none";

const BID_MODULES = ["bids", "projects"] as const;
const OPS_PERMISSIONS = ["operations.read", "operations.manage"] as const;
const BID_PERMISSIONS = [
  "project.read",
  "project.create",
  "project.update",
] as const;

function roleOf(ctx: WorkspacePolicyContext): string {
  return ctx.platformRole ?? "";
}

function modulesOf(ctx: WorkspacePolicyContext): readonly string[] {
  return ctx.enabledModules ?? [];
}

function hasAnyPermission(
  ctx: WorkspacePolicyContext,
  keys: readonly string[],
): boolean {
  const perms = ctx.permissionKeys;
  if (!perms?.length) return false;
  return keys.some((k) => perms.includes(k));
}

function hasBidModule(ctx: WorkspacePolicyContext): boolean {
  const mods = modulesOf(ctx);
  if (!mods.length) return false;
  return BID_MODULES.some((m) => mods.includes(m));
}

/** 管理层：平台管理员 / 高管 / 组织管理员 */
export function isManagementWorkspaceUser(
  ctx: WorkspacePolicyContext,
): boolean {
  const role = roleOf(ctx);
  if (isSuperAdmin(role) || isExecutiveRole(role)) return true;
  const org = ctx.orgRole;
  return org === "org_admin" || org === "org_owner";
}

export function canAccessManagementWorkspace(
  ctx: WorkspacePolicyContext,
): boolean {
  return isManagementWorkspaceUser(ctx);
}

/**
 * 运营中心 /ops
 * — 管理层；或平台 operations；或持有 operations.* 权限
 * — 不以 bids/projects 模块单独放行（避免与招投标混淆）
 */
export function canAccessOperationsWorkspace(
  ctx: WorkspacePolicyContext,
): boolean {
  if (isManagementWorkspaceUser(ctx)) return true;
  if (isOperationsStaff(ctx.platformRole)) return true;
  if (hasAnyPermission(ctx, OPS_PERMISSIONS)) return true;
  return false;
}

/**
 * 招投标中心 /bids
 * — 管理层（且企业启用 bids/projects，或尚未配置 modules 时不因模块拦截管理层）
 * — 非管理层必须同时具备：bids|projects 模块（若已配置）+ 显式能力信号
 * — 显式能力：project.* 权限，或有效项目成员关系（hasBidCapability）
 * — 禁止仅凭普通 user / 组织模块开放
 */
export function canAccessBidWorkspace(ctx: WorkspacePolicyContext): boolean {
  const mods = modulesOf(ctx);
  const modulesConfigured = mods.length > 0;
  const bidModuleOk = !modulesConfigured || hasBidModule(ctx);

  if (isManagementWorkspaceUser(ctx)) {
    return bidModuleOk;
  }

  const explicitBid =
    hasAnyPermission(ctx, BID_PERMISSIONS) || Boolean(ctx.hasBidCapability);

  if (!explicitBid) return false;
  return bidModuleOk;
}

/** 销售中心 — 与现有 Sales Command Center 专职角色对齐 */
export function canAccessSalesWorkspace(
  ctx: WorkspacePolicyContext,
): boolean {
  if (isManagementWorkspaceUser(ctx)) return true;
  if (isSalesStaff(ctx.platformRole)) return true;
  return false;
}

/**
 * 默认工作区入口
 *
 * 优先级：
 * 1. 管理层 / 平台管理员 → /
 * 2. 销售专职 → /sales/home
 * 3. 运营专职 → /ops
 * 4. 招投标专职（可进 bids 且非运营专职）→ /bids
 * 5. 其余 → /（仅管理层应停留；非管理层请用 resolveHomeRedirect）
 */
export function getDefaultWorkspace(ctx: WorkspacePolicyContext): string {
  if (isManagementWorkspaceUser(ctx)) return "/";

  if (isSalesStaff(ctx.platformRole) && canAccessSalesWorkspace(ctx)) {
    return "/sales/home";
  }

  if (
    isOperationsStaff(ctx.platformRole) &&
    canAccessOperationsWorkspace(ctx)
  ) {
    return "/ops";
  }

  if (
    canAccessBidWorkspace(ctx) &&
    !isOperationsStaff(ctx.platformRole) &&
    !isSalesStaff(ctx.platformRole)
  ) {
    return "/bids";
  }

  return "/";
}

/**
 * 非管理层访问 `/` 时的服务端重定向目标。
 * 无明确工作区时回退 `/tasks`，避免停留在管理总览。
 */
export function resolveHomeRedirect(ctx: WorkspacePolicyContext): string | null {
  if (canAccessManagementWorkspace(ctx)) return null;
  const target = getDefaultWorkspace(ctx);
  if (target !== "/") return target;
  if (canAccessOperationsWorkspace(ctx)) return "/ops";
  if (canAccessBidWorkspace(ctx)) return "/bids";
  if (canAccessSalesWorkspace(ctx)) return "/sales/home";
  return "/tasks";
}

export function getAccessibleWorkspaces(
  ctx: WorkspacePolicyContext,
): WorkspaceId[] {
  const out: WorkspaceId[] = [];
  if (canAccessManagementWorkspace(ctx)) out.push("management");
  if (canAccessOperationsWorkspace(ctx)) out.push("operations");
  if (canAccessBidWorkspace(ctx)) out.push("bids");
  if (canAccessSalesWorkspace(ctx)) out.push("sales");
  return out.length ? out : ["none"];
}

/** 从导航 filter 上下文构造策略输入 */
export function workspaceContextFromNav(input: {
  platformRole: string | null | undefined;
  orgRole?: string | null | undefined;
  modules?: { enabled?: readonly string[] } | null;
  hasMembership?: boolean;
  permissionKeys?: readonly string[] | null;
  hasBidCapability?: boolean;
}): WorkspacePolicyContext {
  return {
    platformRole: input.platformRole,
    orgRole: input.orgRole,
    enabledModules: input.modules?.enabled ?? null,
    hasMembership: input.hasMembership,
    permissionKeys: input.permissionKeys ?? null,
    hasBidCapability: input.hasBidCapability,
  };
}
