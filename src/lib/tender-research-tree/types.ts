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
  /** 模型给的组名：同一页上属于同一笔授标的事实同组（TREE-3）；没给就按页成一组 */
  group?: string;
};

/* ───────────────────────────── 授标记录（TREE-3） ───────────────────────────── */

export type Tri = "yes" | "no" | "unknown";

/** 口径标签：含安装 / 含运费 / 多年期 / 多品项（一个都没有 = 不明） */
export type ScopeBasisTag = "installation" | "freight" | "multi_year" | "multi_item";

/** 币种怎么定的：写明的 / 按网站推断的 / 数据集口径 / 不明 */
export type CurrencyBasis = "stated" | "site" | "dataset" | "unknown";

export type RecordFieldKey = "priorTender" | "winner" | "buyer" | "item" | "amount" | "quantity" | "year" | "currency";

/** 记录的一个字段：原值与它的摘录（网页：逐字在页上；联邦数据：代码按原始字段拼的一行） */
export type AwardRecordField = { value: string; excerpt: string };

/** 可比度四项（每项 是 / 否 / 不明）与分数（「是」的个数，0–4） */
export type AwardComparability = {
  sameBuyer: Tri;
  sameSpec: Tri;
  quantityInRange: Tri;
  recent: Tri;
  score: number;
};

/** 一条授标记录：由代码从已核对的事实（或联邦数据的一行）组装；解析值、币种、单价、可比度都由代码算 */
export type ResearchAwardRecordV1 = {
  /** 记录号：来源 + 网址 + 组的哈希（16 位） */
  recordId: string;
  kind: "prior_award" | "comparable_award";
  source: "web" | "open_data";
  url: string;
  requestedUrl?: string;
  fetchedAt: string;
  /** 联邦数据的合同编号（网页记录为 null） */
  referenceNumber: string | null;
  fields: Partial<Record<RecordFieldKey, AwardRecordField>>;
  basisEvidence: Array<{ tag: ScopeBasisTag; excerpt: string }>;
  /** 解析后的合同额 / 数量（十进制写法，金额两位小数）；解析不出为 null */
  amount: string | null;
  quantity: string | null;
  year: number | null;
  currency: "CAD" | "USD" | null;
  currencyBasis: CurrencyBasis;
  /** 口径标签；空 = 不明 */
  basis: ScopeBasisTag[];
  /** 单价 = 合同额 ÷ 数量（原币，两位小数）；算不了为 null */
  unitPrice: string | null;
  comparability: AwardComparability;
};

/* ───────────────────────────── 条款结论（TREE-3） ───────────────────────────── */

export const RESEARCH_CLAUSES_VERSION = "research-clauses/v1" as const;

export type ClauseQuestionKey = "local_content" | "brand" | "equivalents";

/** 一条引文：页码与文件名由代码按段号填，摘录逐字在那一段里 */
export type ClauseCitation = {
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  /** 第 N 页 / 工作表「…」/ 第 N 段 */
  pageLabelZh: string;
  excerpt: string;
};

export type ClauseQuestionResult = {
  key: ClauseQuestionKey;
  /** 答案枚举（见 clauses.ts 的 CLAUSE_ANSWERS） */
  answer: string;
  answerZh: string;
  citations: ClauseCitation[];
  /** 模型的答案不是「未写明」，但出处对不上，改成了「未写明」 */
  downgraded: boolean;
  /** 未写明时的澄清问题草稿（固定模板）；写明了为 null */
  clarification: { en: string; zh: string } | null;
};

export type ClauseFindingsV1 = {
  version: typeof RESEARCH_CLAUSES_VERSION;
  documentCount: number;
  pagesWithText: number;
  /** 扫描件页（没有文字） */
  scannedPages: number;
  /** 规则命中的段数（交给模型的段数） */
  snippetCount: number;
  modelCalled: boolean;
  questions: ClauseQuestionResult[];
  /** 等效品要什么证明（摘录）；没有为 null */
  proof: ClauseCitation | null;
  /** 「限定品牌，不接受替代」与「接受等效品」同时成立（两问互相打架，请人看原文） */
  conflict?: boolean;
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
  /** 状态短标签：查到 N 条 / 写明了 N 项 / 都未写明 / 没查到 / 被挡 / 到上限 / 未接通 / 无需追查 / 未开启 */
  statusZh: string;
  /** 第二波为什么跑或为什么不跑（分叉规则给的理由）；第一波为 null */
  reasonZh: string | null;
  found: FoundFact[];
  /** 授标记录（授标支；TREE-2 交的旧单没有这一项，按空处理） */
  records?: ResearchAwardRecordV1[];
  /** 条款结论（条款支；别的支为 null；旧单没有这一项，按 null 处理） */
  clauses?: ClauseFindingsV1 | null;
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
  /** 授标记录数（条款支与旧单为 0） */
  recordCount: number;
  notFound: NotFoundEntry[];
  usage: TrunkUsage;
};

/** 树干摘要里的条款三问（只放答案枚举，不放摘录与页码） */
export type TrunkClausesSummary = Record<ClauseQuestionKey, string>;

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
  /** 条款三问的答案（没有条款结论为 null） */
  clauses: TrunkClausesSummary | null;
  usage: TrunkUsage;
};
