/**
 * Tender Detail 五个一级业务 Tab（T1A UX Consolidation）
 * 工作台 / 招标要求 / 标书与报价 / 情报 / 提交
 *
 * 旧 4-tab 深链与 sessionStorage 值（overview/files/quotes/ai）作为永久别名解析：
 * 详情页此前从不读取 ?tab= 参数（T0 审计 B4 断链），本模块是修复后的唯一解析入口。
 */

export const TENDER_DETAIL_TAB_KEYS = [
  "workbench",
  "requirements",
  "bid",
  "intel",
  "submission",
] as const;

export type TenderDetailTab = (typeof TENDER_DETAIL_TAB_KEYS)[number];

export const TENDER_DETAIL_TAB_LABELS: Record<
  TenderDetailTab,
  { label: string; shortLabel: string }
> = {
  workbench: { label: "工作台", shortLabel: "工作台" },
  requirements: { label: "招标要求", shortLabel: "要求" },
  bid: { label: "标书与报价", shortLabel: "标书" },
  intel: { label: "情报", shortLabel: "情报" },
  submission: { label: "提交", shortLabel: "提交" },
};

export function isTenderDetailTab(value: unknown): value is TenderDetailTab {
  return (
    typeof value === "string" &&
    (TENDER_DETAIL_TAB_KEYS as readonly string[]).includes(value)
  );
}

export interface ResolvedTenderDetailTab {
  tab: TenderDetailTab;
  /** 旧「文件」入口 → 工作台 + 打开资料抽屉 */
  openFiles?: boolean;
  /** 旧「AI 工作台」入口 → 工作台 + 打开问青砚抽屉 */
  openChat?: boolean;
}

/** 旧 tab 值不再是一级入口，但既有书签 / 站内链接必须继续可用（SAFE REDIRECT 语义）。 */
const LEGACY_TAB_ALIASES: Record<string, ResolvedTenderDetailTab> = {
  overview: { tab: "workbench" },
  files: { tab: "workbench", openFiles: true },
  quotes: { tab: "bid" },
  ai: { tab: "workbench", openChat: true },
};

export function resolveTenderDetailTab(
  raw: string | null | undefined,
): ResolvedTenderDetailTab | null {
  if (!raw) return null;
  if (isTenderDetailTab(raw)) return { tab: raw };
  return LEGACY_TAB_ALIASES[raw] ?? null;
}

export function tenderDetailTabHref(
  projectId: string,
  tab: TenderDetailTab,
): string {
  return `/projects/${projectId}?tab=${tab}`;
}
