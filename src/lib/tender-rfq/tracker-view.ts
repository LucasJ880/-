/**
 * T-2 询价追踪页里浏览器端也要用的部分（页签、过滤、「全部批准」、汇总卡文案）
 *
 * 这里不能引用 chase-pure（它用 node:crypto 等服务端模块）：客户端组件只从本文件取；
 * tracker-pure.ts 原样转出这些名字，服务端与测试照旧从 tracker-pure 取。
 */

export type TrackerSummary = {
  needsAction: number;
  waiting: number;
  quoted: number;
  noResponse: number;
  pendingCards: number;
  quotedThisWeek: number;
};

/** /bids 顶部汇总卡：只有计数，不出现金额 */
export function summaryCardText(s: TrackerSummary): string {
  const parts: string[] = [];
  if (s.waiting) parts.push(`${s.waiting} 家等回复`);
  if (s.pendingCards) parts.push(`${s.pendingCards} 张催单待批`);
  if (s.quotedThisWeek) parts.push(`本周 ${s.quotedThisWeek} 家已报价`);
  if (parts.length) return `询价追踪：${parts.join(" · ")}`;
  // 上面三项都为 0 时，用其余计数说清楚，别和「需要我处理 N」自相矛盾（审查 L1）
  if (s.needsAction) return `询价追踪：${s.needsAction} 项需要我处理`;
  if (s.quoted) return `询价追踪：${s.quoted} 家已报价`;
  if (s.noResponse) return `询价追踪：${s.noResponse} 家未响应`;
  return "询价追踪：没有在途询价";
}

export const EMPTY_TRACKER_ZH = "没有在途询价。去项目里点「问供应商要价」。";

export type TrackerTab = "needs" | "waiting" | "quoted" | "no_response";

export const TRACKER_TABS: Array<{ key: TrackerTab; label: string; count: (s: TrackerSummary) => number }> = [
  { key: "needs", label: "需要我处理", count: (s) => s.needsAction },
  { key: "waiting", label: "等回复", count: (s) => s.waiting },
  { key: "quoted", label: "已报价", count: (s) => s.quoted },
  { key: "no_response", label: "未响应", count: (s) => s.noResponse },
];

type TabRow = { status: string; needsAction: string | null };

export function rowInTab(r: TabRow, tab: TrackerTab): boolean {
  if (tab === "needs") return r.needsAction != null;
  if (tab === "waiting") return r.status === "sent";
  if (tab === "quoted") return r.status === "quoted";
  return r.status === "no_response";
}

/** 按页签过滤分组：没有行的轮次、没有轮次的项目都去掉 */
export function filterTrackerGroups<R extends TabRow, G extends { rounds: Array<{ rows: R[] }> }>(groups: G[], tab: TrackerTab): G[] {
  return groups
    .map((g) => ({ ...g, rounds: g.rounds.map((r) => ({ ...r, rows: r.rows.filter((x) => rowInTab(x, tab)) })).filter((r) => r.rows.length > 0) }))
    .filter((g) => g.rounds.length > 0);
}

/** 一轮里能原地批准的催单卡（「全部批准」只在 ≥ 2 张时出现） */
export function approvableCards<C extends { approval: { canApprove: boolean; status: string } }>(rows: Array<{ cards: C[] }>): C[] {
  return rows.flatMap((r) => r.cards).filter((c) => c.approval.canApprove && c.approval.status === "PENDING");
}

/** 按项目进来时默认停的页签：第一个有行的（都没有就「需要我处理」） */
export function firstTabWithRows<R extends TabRow>(groups: Array<{ rounds: Array<{ rows: R[] }> }>): TrackerTab {
  for (const t of TRACKER_TABS) if (filterTrackerGroups(groups, t.key).length > 0) return t.key;
  return "needs";
}
