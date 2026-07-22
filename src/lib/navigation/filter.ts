/**
 * 权限 + 模块过滤 + 排序 + 折叠态
 */

import { navHrefAllowedByModules } from "@/lib/tenancy/modules";
import { pathMatches, isCapabilitiesPath } from "./active";
import type {
  NavigationFilterContext,
  NavigationItem,
  ResolvedNavItem,
} from "./types";

function modulesOk(
  item: NavigationItem,
  ctx: NavigationFilterContext,
): boolean {
  if (item.moduleKey) {
    const keys = Array.isArray(item.moduleKey)
      ? item.moduleKey
      : [item.moduleKey];
    if (!ctx.modules?.enabled?.length) return true;
    if (!keys.some((k) => ctx.modules!.enabled.includes(k))) return false;
  }
  if (item.href && !navHrefAllowedByModules(item.href, ctx.modules)) {
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
      item.group === "OPERATIONS" ||
      item.group === "GROWTH" ||
      item.group === "MANAGEMENT" ||
      item.group === "CAPABILITIES")
  ) {
    return false;
  }
  if (!platformRoleOk(item, ctx)) return false;
  if (!orgRoleOk(item, ctx)) return false;
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

  const selfActive = pathMatches(ctx.pathname, item.href, {
    exact: item.exact,
    matchPaths: item.matchPaths,
  });
  const childActive = childResolved.some((c) => c.active || c.expanded);
  const active = selfActive || (childActive && !item.children?.length);
  const inCapabilities =
    item.group === "CAPABILITIES" && isCapabilitiesPath(ctx.pathname);
  const expanded = Boolean(
    forceExpand ||
      !item.collapsible ||
      childActive ||
      selfActive ||
      (item.collapsible && inCapabilities && item.key === "capabilities"),
  );

  return {
    ...item,
    children: childResolved.length ? childResolved : undefined,
    active: selfActive || (item.collapsible && childActive && !childResolved.some((c) => c.active) ? false : selfActive),
    expanded,
  };
}

/** 修正父/子 active：父轻度、子明确 */
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

  return tree.map((item): ResolvedNavItem => {
    if (!item.children?.length) {
      return {
        ...item,
        children: undefined,
        active: pathMatches(ctx.pathname, item.href, {
          exact: item.exact,
          matchPaths: item.matchPaths,
        }),
        expanded: false,
      };
    }
    const children: ResolvedNavItem[] = item.children.map((c) => ({
      ...c,
      children: undefined,
      active: pathMatches(ctx.pathname, c.href, {
        exact: c.exact,
        matchPaths: c.matchPaths,
      }),
      expanded: false,
    }));
    const childActive = children.some((c) => c.active);
    const selfExact = pathMatches(ctx.pathname, item.href, {
      exact: true,
      matchPaths:
        item.href === "/capabilities" ? ["/capabilities"] : item.matchPaths,
    });
    return {
      ...item,
      children,
      // 父级：仅在自身总览页时标记；子级 active 由 children 承担
      active: selfExact && !childActive,
      expanded:
        item.expanded ||
        childActive ||
        Boolean(item.collapsible && isCapabilitiesPath(ctx.pathname)),
    };
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
