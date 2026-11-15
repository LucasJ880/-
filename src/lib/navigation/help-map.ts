/**
 * /help 的数据（VIS-1b 功能地图；NAV-1b 起与侧栏同分段同顺序，并在顶部加「我想做什么」）
 * spec navigation/entry-visibility「/help 功能地图从可见导航生成」「/help 顶部的『我想做什么』」
 *
 * 纯函数：用与侧栏同一个 resolveNavigationTree、同一份判定输入、同一条两段式判定（trade-layout.ts）。
 *   - 侧栏为两段式的用户：先「常用」，再「更多」里的各分组，最后系统组；
 *   - 其余用户：按侧栏分组与顺序。
 * 侧栏不可见的入口不出现。
 */

import { resolveNavigationTree } from "./filter";
import { NAVIGATION_REGISTRY, SYSTEM_NAV_ITEMS } from "./registry";
import { groupNavItems, navGroupLabel, partitionFocusedNav, usesFocusedLayout } from "./trade-layout";
import { visibleHelpTasks, type HelpTask } from "./help-tasks";
import type { RouteGateContext } from "./filter-context";
import type { NavigationGroup, ResolvedNavItem } from "./types";

/** label 是注册表名称（中文）；显示时用 navEntryLabel({ label, labelKey }, 当前界面语言文案表)，与侧栏同名（NAV-1a） */
export type HelpMapEntry = { key: string; label: string; labelKey: string | null; description: string; href: string | null; depth: number };
/**
 * section：这一组在侧栏的哪一段——primary = 两段式的「常用」；more = 两段式「更多」里的一个分组；null = 全量布局的分组或系统组。
 * group：常用段没有对应的导航分组，记为 "PRIMARY"。
 */
export type HelpMapGroup = { group: NavigationGroup | "PRIMARY"; label: string; section: "primary" | "more" | null; entries: HelpMapEntry[] };
export type HelpTaskRow = HelpTask & { entry: HelpMapEntry };

const PRIMARY_LABEL = "常用";

function toEntries(items: readonly ResolvedNavItem[], depth = 0): HelpMapEntry[] {
  return items.flatMap((item) => [
    { key: item.key, label: item.label, labelKey: item.labelKey ?? null, description: item.description ?? "", href: item.href ?? null, depth },
    ...(item.children?.length ? toEntries(item.children, depth + 1) : []),
  ]);
}

export function buildHelpMap(ctx: RouteGateContext): HelpMapGroup[] {
  const tree = resolveNavigationTree([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS], { ...ctx, pathname: "/help" });
  const main = tree.filter((i) => i.group !== "SYSTEM");
  const system = tree.filter((i) => i.group === "SYSTEM");
  const focused = usesFocusedLayout(ctx);
  // 全量布局 = 不取常用段，全部入口按分组；两种情况的分组排法都与侧栏相同
  const { primary, moreGroups: groups } = focused ? partitionFocusedNav(main) : { primary: [], moreGroups: groupNavItems(main) };
  return [
    ...(primary.length ? [{ group: "PRIMARY" as const, label: PRIMARY_LABEL, section: "primary" as const, entries: toEntries(primary) }] : []),
    ...groups.map((g) => ({ group: g.group, label: g.label, section: focused ? ("more" as const) : null, entries: toEntries(g.items) })),
    ...(system.length ? [{ group: "SYSTEM" as const, label: navGroupLabel("SYSTEM"), section: null, entries: toEntries(system) }] : []),
  ];
}

/** 「我想做什么」对当前用户出现的行，带上绑定入口的名称与链接；一行都没有时返回空数组（页面不渲染这一节） */
export function buildHelpTasks(ctx: RouteGateContext): HelpTaskRow[] {
  const entries = new Map(buildHelpMap(ctx).flatMap((g) => g.entries).map((e) => [e.key, e]));
  return visibleHelpTasks(new Set(entries.keys()), ctx.modules).map((t) => ({ ...t, entry: entries.get(t.entryKey)! }));
}
