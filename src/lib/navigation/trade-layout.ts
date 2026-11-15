/**
 * 侧栏「常用 + 更多」两段式布局（NAV-1b；spec navigation/focused-sidebar）。
 *
 * 全是纯函数：
 *   - usesFocusedLayout：谁用两段式。只吃判定输入，侧栏与 /help 共用，不读岗位派生的平台角色。
 *   - partitionFocusedNav：常用段按 FOCUSED_PRIMARY_KEYS 的顺序取（缺项跳过）；其余入口按全量布局的分组与组内顺序进「更多」。
 *   - resolveMoreExpanded：「更多」此刻是否展开。
 *
 * 只管布局，不管可见性：入口看不看得见仍由 filter.ts 决定，常用 ∪ 更多 = 传入的全部入口。
 */

import { isModuleEnabled, type OrgModulesConfig } from "@/lib/tenancy/modules";
import { NAV_GROUP_META, NAV_SECTION_LABEL } from "./registry";
import type { NavigationGroup } from "./types";

/**
 * 常用段：今日询盘 → 询盘收件箱 → 线索资产 → 外贸报价 → 寄样 → 货号 → 客户与商机 → 知识库。
 * 任务书 NAV-1「拍板结果」第 1 条（Lucas 2026-11-14）。要调整常用入口，只改这一处。
 */
export const FOCUSED_PRIMARY_KEYS: readonly string[] = [
  "biz-revenue-today",
  "biz-inbox",
  "biz-prospects",
  "biz-trade-quotes",
  "biz-trade-samples",
  "biz-trade-products",
  "sales-crm",
  "mgmt-knowledge",
];

export type FocusedLayoutInput = {
  positionMode?: boolean;
  platformRole?: string | null;
  modules?: OrgModulesConfig | null;
  permissionKeys?: readonly string[] | null;
};

/**
 * 是否使用两段式布局。
 *   岗位模式：外贸模块已开 ∧ 持 trade.read ∧ 窗饰模块未开 ∧ 非平台 super_admin
 *   旧模式：平台角色 trade
 * 模块判断与导航同口径（isModuleEnabled：企业未配置模块清单 = 全部已开，此时窗饰算已开，结果为全量布局）。
 */
export function usesFocusedLayout(input: FocusedLayoutInput): boolean {
  if (input.positionMode !== true) return input.platformRole === "trade";
  if (input.platformRole === "super_admin") return false;
  if (!isModuleEnabled(input.modules, "trade")) return false;
  if (isModuleEnabled(input.modules, "window_covering")) return false;
  return (input.permissionKeys ?? []).includes("trade.read");
}

export type FocusedNavGroup<T> = { group: NavigationGroup; label: string; items: T[] };
export type FocusedNavPartition<T> = { primary: T[]; moreGroups: FocusedNavGroup<T>[] };

/** 分组小标题（与全量布局的侧栏相同） */
export function navGroupLabel(group: NavigationGroup): string {
  return NAV_SECTION_LABEL[group] ?? NAV_GROUP_META[group].label;
}

/**
 * 把可见的一级入口分成「常用」与「更多」。
 * @param items resolveNavigationTree 的结果（一级入口，已按全量布局排好序）
 */
export function partitionFocusedNav<T extends { key: string; group: NavigationGroup }>(items: readonly T[]): FocusedNavPartition<T> {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const primary: T[] = [];
  for (const key of FOCUSED_PRIMARY_KEYS) {
    const item = byKey.get(key);
    if (item) primary.push(item);
  }
  const inPrimary = new Set(primary.map((i) => i.key));
  return { primary, moreGroups: groupNavItems(items.filter((i) => !inPrimary.has(i.key))) };
}

/** 按全量布局的分组顺序分组，组内保持传入顺序（与侧栏相同） */
export function groupNavItems<T extends { group: NavigationGroup }>(items: readonly T[]): FocusedNavGroup<T>[] {
  const groups = [...new Set(items.map((i) => i.group))].sort((a, b) => NAV_GROUP_META[a].order - NAV_GROUP_META[b].order);
  return groups.map((group) => ({ group, label: navGroupLabel(group), items: items.filter((i) => i.group === group) }));
}

/**
 * 「更多」此刻是否展开（spec「当前页面在更多里时自动展开」）。
 * @param remembered 浏览器里记住的状态
 * @param activeInMore 当前页面的入口（或其子项）在「更多」里
 * @param manualOnThisPage 用户在当前页面手动点过开关后的结果；没点过为 null。路径变化时由调用方清空。
 */
export function resolveMoreExpanded(input: { remembered: boolean; activeInMore: boolean; manualOnThisPage: boolean | null }): boolean {
  if (input.manualOnThisPage !== null) return input.manualOnThisPage;
  return input.remembered || input.activeInMore;
}
