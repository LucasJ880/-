/**
 * NAV-1a：入口名称的唯一取法（spec navigation/entry-naming「侧栏、手机抽屉与使用说明显示同一个名称」）。
 *
 * 桌面侧栏、手机导航抽屉、/help 功能地图都调它，不要在别处再拼名称。
 * 中文名的事实源是导航注册表的 label；翻译表与它不一致由 entry-naming.test.ts 拦住。
 * 纯函数、不依赖 React，服务端与测试可直接引用。
 */

export type NavEntryLabelSource = { label: string; labelKey?: string | null };

/**
 * @param messages 当前界面语言的文案表（useLocale().m，或 zh / en）
 * @returns 有翻译键且文案表里有非空值 → 该值；否则注册表名称
 */
export function navEntryLabel(item: NavEntryLabelSource, messages: object): string {
  if (!item.labelKey) return item.label;
  const translated = (messages as Readonly<Record<string, unknown>>)[item.labelKey];
  return typeof translated === "string" && translated.trim().length > 0 ? translated : item.label;
}
