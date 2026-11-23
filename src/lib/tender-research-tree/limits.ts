/**
 * 情报调研树的额度（任务书拍板第 5 项；config 第 7 条例外二）。
 *
 * 写成常量；组织设置 settingsJson.researchTree.limits 只能调低，比常量大、不是非负整数或读不出的值一律按常量。
 * 读页次数的硬上限另由读页层（TREE-1）按同一个数记账。
 */

import { WEB_READER_LIMITS } from "@/lib/web-reader";

export const RESEARCH_TREE_LIMITS = Object.freeze({
  /** 每支搜索次数上限（拍板） */
  SEARCHES_PER_BRANCH: 16,
  /** 每支读页次数上限（拍板；与读页层同一个数） */
  READS_PER_BRANCH: WEB_READER_LIMITS.MAX_READS_PER_BRANCH,
  /** 每支模型请求次数上限（实现者按授权定，config 例外二；同一次请求里的重试与换备用模型不另算） */
  MODEL_CALLS_PER_BRANCH: 30,
  /** 每棵树分支数上限（拍板；与读页层同一个数） */
  MAX_BRANCHES_PER_TREE: WEB_READER_LIMITS.MAX_BRANCHES_PER_TREE,
  /** 最深层数（拍板） */
  MAX_DEPTH: 5,
  /** 连续这么多轮模型请求失败，这一支以「未接通」收尾 */
  MAX_CONSECUTIVE_MODEL_FAILURES: 3,
  /** 每轮最多收下几条事实 */
  MAX_FACTS_PER_TURN: 5,
  /** 每支最多收下几条事实 */
  MAX_FACTS_PER_BRANCH: 40,
  /** 每轮最多几条建议的分支 */
  MAX_SUGGESTIONS_PER_TURN: 3,
  /** 摘录与值的长度上限（字） */
  MAX_EXCERPT_CHARS: 200,
  MAX_VALUE_CHARS: 200,
  /** 搜索词长度上限（字） */
  MAX_QUERY_CHARS: 200,
  /** 每次搜索取几条 */
  SEARCH_MAX_RESULTS: 5,
  /** 交给模型的正文上限（字） */
  PAGE_CHARS_FOR_MODEL: 12_000,
  /** 一棵树最多读这么多行 research.branch_step 审计；超过 → 这一支到上限收尾（不按部分历史放行） */
  CURSOR_MAX_ROWS: 1200,
  /** 待反查、未追的线索的条数上限 */
  MAX_PENDING_REVERSE: 10,
  MAX_UNCHASED_LEADS: 20,
});

/** 截止与让出（毫秒） */
export const RESEARCH_TREE_TIMING = Object.freeze({
  /** 每次模型请求与读页的截止 = 这一片的截止 − 这么多（同 FIX-12） */
  CALL_MARGIN_MS: 15_000,
  /** 离这一片的截止不足这么多，就不再开始新的一轮（让出） */
  MIN_TURN_MS: 45_000,
  /**
   * 要读页时离截止不足这么多就先让出。读页层的截止 = 这一片的截止 − MIN_TURN_MS（给读完之后的那次提取留一轮），
   * 所以读页本身最多用 MIN_READ_TURN_MS − MIN_TURN_MS = 45 秒
   */
  MIN_READ_TURN_MS: 90_000,
  /** 运行时没给执行预算时，这一片按这么长算 */
  DEFAULT_SLICE_MS: 120_000,
  /** 单次模型请求的超时 */
  MODEL_TIMEOUT_MS: 60_000,
  /** 单次搜索的超时上限 */
  SEARCH_TIMEOUT_MS: 25_000,
  /** 模型请求的输出上限（token） */
  MODEL_MAX_TOKENS: 1_500,
});

export type BranchLimits = { searches: number; reads: number; modelCalls: number };

/** 每支的常量额度；`half` 用于第一波 ③（限量） */
export function baseBranchLimits(scale: "full" | "half"): BranchLimits {
  const f = scale === "half" ? 0.5 : 1;
  return {
    searches: Math.floor(RESEARCH_TREE_LIMITS.SEARCHES_PER_BRANCH * f),
    reads: Math.floor(RESEARCH_TREE_LIMITS.READS_PER_BRANCH * f),
    modelCalls: Math.floor(RESEARCH_TREE_LIMITS.MODEL_CALLS_PER_BRANCH * f),
  };
}

function lowered(base: number, raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return base;
  return Math.min(base, raw);
}

/** 每棵树的分支数与深度（常量；组织设置 researchTree.limits.maxBranchesPerTree / maxDepth 只能调低） */
export type TreeLimits = { maxBranches: number; maxDepth: number };

export function effectiveTreeLimits(settingsJson: unknown): TreeLimits {
  const l = readLimitsObject(settingsJson);
  return {
    maxBranches: lowered(RESEARCH_TREE_LIMITS.MAX_BRANCHES_PER_TREE, l.maxBranchesPerTree),
    maxDepth: lowered(RESEARCH_TREE_LIMITS.MAX_DEPTH, l.maxDepth),
  };
}

function readLimitsObject(settingsJson: unknown): Record<string, unknown> {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) return {};
  const tree = (settingsJson as Record<string, unknown>).researchTree;
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) return {};
  const limits = (tree as Record<string, unknown>).limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) return {};
  return limits as Record<string, unknown>;
}

/** 组织设置里的额度覆盖：只能调低 */
export function readOrgLimitOverride(settingsJson: unknown): Partial<Record<keyof BranchLimits, unknown>> {
  const l = readLimitsObject(settingsJson);
  return { searches: l.searchesPerBranch, reads: l.readsPerBranch, modelCalls: l.modelCallsPerBranch };
}

/** 这一支实际可用的额度：常量（按限量缩放）与组织设置取小 */
export function effectiveBranchLimits(scale: "full" | "half", settingsJson: unknown): BranchLimits {
  const base = baseBranchLimits(scale);
  const o = readOrgLimitOverride(settingsJson);
  return {
    searches: lowered(base.searches, o.searches),
    reads: lowered(base.reads, o.reads),
    modelCalls: lowered(base.modelCalls, o.modelCalls),
  };
}
