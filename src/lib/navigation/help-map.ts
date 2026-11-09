/**
 * VIS-1b：/help 功能地图（spec navigation/entry-visibility「/help 功能地图从可见导航生成」；design D10）
 *
 * 纯函数：用与侧栏同一个 resolveNavigationTree 与同一份判定输入，按侧栏分组与顺序列出可见入口（名称 + 一句说明）。
 * 侧栏不可见的入口不出现。
 */

import { resolveNavigationTree } from "./filter";
import { NAV_GROUP_META, NAV_SECTION_LABEL, NAVIGATION_REGISTRY, SYSTEM_NAV_ITEMS } from "./registry";
import type { RouteGateContext } from "./filter-context";
import type { NavigationGroup, ResolvedNavItem } from "./types";

export type HelpMapEntry = { key: string; label: string; description: string; href: string | null; depth: number };
export type HelpMapGroup = { group: NavigationGroup; label: string; entries: HelpMapEntry[] };

export function buildHelpMap(ctx: RouteGateContext): HelpMapGroup[] {
  const tree = resolveNavigationTree([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS], { ...ctx, pathname: "/help" });
  const byGroup = new Map<NavigationGroup, HelpMapEntry[]>();
  const walk = (items: ResolvedNavItem[], depth: number) => {
    for (const item of items) {
      const list = byGroup.get(item.group) ?? [];
      list.push({ key: item.key, label: item.label, description: item.description ?? "", href: item.href ?? null, depth });
      byGroup.set(item.group, list);
      if (item.children?.length) walk(item.children, depth + 1);
    }
  };
  walk(tree, 0);
  return (Object.keys(NAV_GROUP_META) as NavigationGroup[])
    .sort((a, b) => NAV_GROUP_META[a].order - NAV_GROUP_META[b].order)
    .filter((g) => byGroup.has(g))
    .map((g) => ({ group: g, label: NAV_SECTION_LABEL[g] ?? NAV_GROUP_META[g].label, entries: byGroup.get(g)! }));
}
