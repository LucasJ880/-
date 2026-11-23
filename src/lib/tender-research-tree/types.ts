/**
 * 情报调研树（TREE-2）的对外类型：交接单 research-handoff/v1、树干摘要。
 *
 * 交接单放在分支步骤业务输出的 `researchHandoff` 键里（运行时把它与自己的 workforceHandoff 一起写进
 * outputJson，下游步骤经 priorEvidence 读到全文）。树干摘要写进情报室 summaryJson.researchTree，
 * 只放状态、条数、原因与用量，不放金额、摘录、正文与网址。
 */

export const RESEARCH_HANDOFF_VERSION = "research-handoff/v1" as const;
export const RESEARCH_TREE_SUMMARY_VERSION = 1 as const;

/** 分支类别：① 条款、② 往期同标、③ 同类项目（限量）、第二波甲（全量）、第二波乙（放宽） */
export type BranchKind = "clauses" | "prior_awards" | "similar" | "similar_full" | "similar_relaxed";

/**
 * 分支状态：查到 / 没查到 / 被挡（整支没查到且读过被挡的页）/ 到上限（整支没查到且额度用完）/ 未接通 /
 * 无需追查（第二波按分叉规则不跑）/ 开关已关
 */
export type BranchStatus = "found" | "none" | "blocked" | "limit" | "unavailable" | "not_needed" | "flag_off";

/** 未查到的原因（任务书四种）：没有 / 未接通 / 被挡 / 到上限 */
export type NotFoundReason = "none" | "unavailable" | "blocked" | "limit";

export type NotFoundEntry = { reason: NotFoundReason; messageZh: string };

/**
 * 一条收下的事实：网址是本支实际读到正文的那一页（有跳转时是跳转后的网址，另记请求的网址）；摘录 12–200 字且
 * 逐字出现在那页正文里；值逐字出现在摘录里；值里的数都在摘录里
 */
export type FoundFact = {
  factType: string;
  value: string;
  url: string;
  /** 跳转过时：本支请求的那个网址（在本支搜索结果里） */
  requestedUrl?: string;
  excerpt: string;
  fetchedAt: string;
  source: "web";
};

/** 被挡明细：站与读页层给的原因句 */
export type BlockedSiteDetail = { site: string; messageZh: string };

export type SuggestedBranch = { kind: string; reasonZh: string };

export type BranchUsage = {
  searches: number;
  reads: number;
  modelCalls: number;
  blockedSites: number;
  elapsedMs: number;
};

export type ResearchHandoffV1 = {
  version: typeof RESEARCH_HANDOFF_VERSION;
  branchKey: string;
  kind: BranchKind;
  /** 这一支的中文名 */
  labelZh: string;
  status: BranchStatus;
  /** 状态短标签：查到 N 条 / 没查到 / 被挡 / 到上限 / 未接通 / 无需追查 / 未开启 */
  statusZh: string;
  /** 第二波为什么跑或为什么不跑（分叉规则给的理由）；第一波为 null */
  reasonZh: string | null;
  found: FoundFact[];
  notFound: NotFoundEntry[];
  suggestedBranches: SuggestedBranch[];
  usage: BranchUsage;
  /** 明细：这一支被挡过的站与原因（只在分支里，树干不列） */
  blockedSites: BlockedSiteDetail[];
  /** 模型交回、没过核对被丢弃的事实条数 */
  rejectedFacts: number;
};

/** 树干摘要里的用量：不列被挡站数（查到了的支在树干里不提被挡；被挡明细只在分支的交接单里） */
export type TrunkUsage = Omit<BranchUsage, "blockedSites">;

export type TrunkBranchSummary = {
  key: string;
  kind: BranchKind;
  labelZh: string;
  status: BranchStatus;
  statusZh: string;
  reasonZh: string | null;
  foundCount: number;
  notFound: NotFoundEntry[];
  usage: TrunkUsage;
};

/** summaryJson.researchTree：只放摘要（不放金额、摘录、正文与网址） */
export type ResearchTreeSummaryV1 = {
  version: typeof RESEARCH_TREE_SUMMARY_VERSION;
  jobId: string;
  status: "done";
  startedAt: string | null;
  finishedAt: string;
  branches: TrunkBranchSummary[];
  /** 往期同标查到的中标方名（第三批才长反查分支，本批只列出） */
  pendingReverse: string[];
  /** 子代理建议、不在分叉规则表里的分支类别（不自动长；只存类别，不存模型写的理由） */
  unchasedLeads: Array<{ kind: string }>;
  usage: TrunkUsage;
};
