/**
 * 外贸员（platformRole=trade）侧栏布局：核心项直出，其余收进可折叠「更多」。
 *
 * 纯函数：输入 resolveNavigationTree 的结果，输出 primary / secondary 两段。
 * primary 按 TRADE_PRIMARY_KEYS 顺序排列（缺项跳过）；其余保持原顺序。
 */

import type { ResolvedNavItem } from "./types";

/** 外贸员的核心动作面：询盘 → 线索 → 报价 → AI 对话 → 总台 → 知识库 */
export const TRADE_PRIMARY_KEYS: readonly string[] = [
  "biz-inbox",
  "biz-prospects",
  "biz-trade-quotes",
  "biz-trade-chat",
  "biz-trade",
  "mgmt-knowledge",
];

export interface TradeNavPartition {
  primary: ResolvedNavItem[];
  secondary: ResolvedNavItem[];
}

export function partitionTradeNav(items: ResolvedNavItem[]): TradeNavPartition {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const primary: ResolvedNavItem[] = [];
  for (const key of TRADE_PRIMARY_KEYS) {
    const it = byKey.get(key);
    if (it) primary.push(it);
  }
  const primarySet = new Set(primary.map((i) => i.key));
  const secondary = items.filter((i) => !primarySet.has(i.key));
  return { primary, secondary };
}

/** 是否对该角色启用「核心 + 更多」两段式侧栏 */
export function usesTradeLayout(platformRole: string | null | undefined): boolean {
  return platformRole === "trade";
}
