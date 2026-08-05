/**
 * 权限 + 模块过滤 + 排序 + 折叠态
 */

import { navHrefAllowedByModules } from "@/lib/tenancy/modules";
import {
  isNavGroupHiddenForRole,
  isNavItemHiddenForRole,
} from "@/lib/rbac/nav-role-policy";
import {
  canAccessBidWorkspace,
  canAccessManagementWorkspace,
  canAccessOperationsWorkspace,
  canAccessSalesWorkspace,
  workspaceContextFromNav,
} from "@/lib/rbac/workspace-policy";
import {
  pathMatches,
  isCapabilitiesPath,
  pickActiveNavKey,
  type ActiveCandidate,
} from "./active";
import type {
  NavigationFilterContext,
  NavigationItem,
  ResolvedNavItem,
} from "./types";

function workspaceAccessOk(
  item: NavigationItem,
  ctx: NavigationFilterContext,
): boolean {
  if (!item.workspaceAccess) return true;
  const ws = workspaceContextFromNav({
    platformRole: ctx.platformRole,
    orgRole: ctx.orgRole,
    modules: ctx.modules,
    hasMembership: ctx.hasMembership,
    hasBidCapability: ctx.hasBidCapability,
  });
  switch (item.workspaceAccess) {
    case "management":
      return canAccessManagementWorkspace(ws);
    case "operations":
      return canAccessOperationsWorkspace(ws);
    case "bids":
      return canAccessBidWorkspace(ws);
    case "sales":
      return canAccessSalesWorkspace(ws);
    default:
      return true;
  }
}

function modulesOk(
  item: NavigationItem,
  ctx: NavigationFilterContext,
): boolean {
  if (item.moduleKey) {
    const keys = Array.isArray(item.moduleKey)
      ? item.moduleKey
      : [item.moduleKey];
    // 有企业 membership 时必须等 modules 就绪；未加载/空配置 fail-closed，避免双租户串菜单
    if (ctx.hasMembership && !ctx.modules?.enabled?.length) return false;
    // 无 membership 的兼容路径：未配置 modules 时不按模块拦截
    if (!ctx.modules?.enabled?.length) return true;
    if (!keys.some((k) => ctx.modules!.enabled.includes(k))) return false;
  }
  if (
    item.href &&
    ctx.modules?.enabled?.length &&
    !navHrefAllowedByModules(item.href, ctx.modules)
  ) {
    return false;
  }
  return true;
}

function platformRoleOk(
  item: NavigationItem,
  ctx: NavigationFilterContext,
): boolean {
  if (item.platformAdminOnly) {
    return ctx.isPlatformAdmin;
  }
  if (!item.requiredPlatformRoles?.length) return true;
  const role = ctx.platformRole ?? "";
  return item.requiredPlatformRoles.includes(role);
}

function orgRoleOk(
  item: NavigationItem,
  ctx: NavigationFilterContext,
): boolean {
  if (item.requireMembership && !ctx.hasMembership) return false;
  if (!item.requiredOrgRoles?.length) return true;
  if (!ctx.orgRole) return false;
  return item.requiredOrgRoles.includes(ctx.orgRole);
}

function capabilitiesOk(
  item: NavigationItem,
  ctx: NavigationFilterContext,
): boolean {
  if (!item.capabilitiesAccess) return true;
  if (!ctx.hasMembership) return false;
  if (item.capabilitiesAccess === "any_member") return true;
  if (item.capabilitiesAccess === "org_admin") {
    return ctx.orgRole === "org_admin";
  }
  // operator：org_admin / manager / 有 workspace
  if (ctx.orgRole === "org_admin") return true;
  if (ctx.orgRole === "org_member" || ctx.orgRole === "manager") return true;
  // 兼容 orgRole 字符串
  if (ctx.orgRole === "manager") return true;
  return ctx.workspaceIds.length > 0;
}

export function isNavItemVisible(
  item: NavigationItem,
  ctx: NavigationFilterContext,
): boolean {
  // 无企业 membership：不展示企业业务 / 中台 / 增长 / 企业管理
  // （平台运营 PLATFORM 与系统 SYSTEM、个人工作台 WORK 仍可按角色显示）
  if (
    !ctx.hasMembership &&
    (item.group === "BUSINESS" ||
      item.group === "PROJECTS" ||
      item.group === "PROJECT_INTEL" ||
      item.group === "SUPPLIERS" ||
      item.group === "OPERATIONS" ||
      item.group === "GROWTH" ||
      item.group === "MANAGEMENT" ||
      item.group === "CAPABILITIES")
  ) {
    return false;
  }
  if (isNavGroupHiddenForRole(item.group, ctx.platformRole)) return false;
  if (isNavItemHiddenForRole(item.key, ctx.platformRole)) return false;
  // 销售工作区：仅展示显式标记项 + SYSTEM（不复制第二份侧栏）
  if (
    ctx.platformRole === "sales" &&
    item.group !== "SYSTEM" &&
    !item.salesWorkspaceVisible
  ) {
    return false;
  }
  if (!platformRoleOk(item, ctx)) return false;
  if (!orgRoleOk(item, ctx)) return false;
  if (!workspaceAccessOk(item, ctx)) return false;
  if (!capabilitiesOk(item, ctx)) return false;
  if (!modulesOk(item, ctx)) return false;
  return true;
}

function resolveItem(
  item: NavigationItem,
  ctx: NavigationFilterContext,
  forceExpand?: boolean,
): ResolvedNavItem | null {
  if (!isNavItemVisible(item, ctx)) return null;

  const childResolved =
    item.children
      ?.map((c) => resolveItem(c, ctx, forceExpand))
      .filter((c): c is ResolvedNavItem => c != null) ?? [];

  // 有 children 定义但全部被过滤 → 不显示空父级（除非自身有 href）
  if (item.children?.length && childResolved.length === 0 && !item.href) {
    return null;
  }

  // 初值；最终 active 由 resolveNavigationTree 最长匹配统一裁定
  const selfActive = pathMatches(ctx.pathname, item.href, {
    exact: item.exact,
    matchPaths: item.matchPaths,
    search: ctx.search,
  });
  const childActive = childResolved.some((c) => c.active);
  const inCapabilities =
    item.group === "CAPABILITIES" && isCapabilitiesPath(ctx.pathname);
  const expanded = item.collapsible
    ? Boolean(
        forceExpand === true ||
          childActive ||
          (item.key === "capabilities" && inCapabilities) ||
          (forceExpand !== false && selfActive && !item.children?.length),
      )
    : false;

  return {
    ...item,
    children: childResolved.length ? childResolved : undefined,
    active: selfActive,
    expanded,
  };
}

/** 仅叶子参与最长匹配（可折叠父级不抢 active） */
function flattenLeafCandidates(items: ResolvedNavItem[]): ActiveCandidate[] {
  const out: ActiveCandidate[] = [];
  for (const item of items) {
    if (item.children?.length) {
      out.push(...flattenLeafCandidates(item.children));
    } else if (item.href || item.matchPaths?.length) {
      out.push({
        key: item.key,
        href: item.href,
        exact: item.exact,
        matchPaths: item.matchPaths,
      });
    }
  }
  return out;
}

function hasActiveDescendant(item: ResolvedNavItem): boolean {
  if (item.active) return true;
  return item.children?.some((c) => hasActiveDescendant(c)) ?? false;
}

function applyActiveKey(
  items: ResolvedNavItem[],
  activeKey: string | null,
  opts?: { expandCapabilities?: boolean; pathname?: string },
): ResolvedNavItem[] {
  return items.map((item): ResolvedNavItem => {
    const children = item.children?.length
      ? applyActiveKey(item.children, activeKey, opts)
      : undefined;
    const descendantActive =
      children?.some((c) => hasActiveDescendant(c)) ?? false;
    const isParent = Boolean(children?.length);
    const selfActive = !isParent && activeKey != null && item.key === activeKey;
    // 父级：永不强 active；仅用 descendant 控制展开
    const active = selfActive;
    const autoExpandCapabilities =
      item.key === "capabilities" &&
      (opts?.expandCapabilities === true ||
        descendantActive ||
        (opts?.pathname != null && isCapabilitiesPath(opts.pathname)));
    const expanded = Boolean(
      item.collapsible &&
        (opts?.expandCapabilities === true ||
          descendantActive ||
          autoExpandCapabilities),
    );
    return {
      ...item,
      children,
      active,
      expanded,
    };
  });
}

/** 修正父/子 active：全局最长匹配唯一叶子；父级只展开 */
export function resolveNavigationTree(
  items: NavigationItem[],
  ctx: NavigationFilterContext,
  opts?: { expandCapabilities?: boolean },
): ResolvedNavItem[] {
  const tree = items
    .map((item) =>
      resolveItem(
        item,
        ctx,
        item.key === "capabilities" ? opts?.expandCapabilities : undefined,
      ),
    )
    .filter((i): i is ResolvedNavItem => i != null)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const activeKey = pickActiveNavKey(
    ctx.pathname,
    flattenLeafCandidates(tree),
    ctx.search,
  );

  return applyActiveKey(tree, activeKey, {
    ...opts,
    pathname: ctx.pathname,
  });
}

export function flattenVisibleHrefs(items: ResolvedNavItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.href) out.push(item.href);
    if (item.children) out.push(...flattenVisibleHrefs(item.children));
  }
  return out;
}

export function findDuplicateHrefs(items: ResolvedNavItem[]): string[] {
  const all = flattenVisibleHrefs(items);
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const h of all) {
    if (seen.has(h)) dups.add(h);
    seen.add(h);
  }
  return [...dups];
}
